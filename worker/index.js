/* ==================================================================
   The Worker. It serves the built app, and it is the only way to the
   audio: every recording lives in a private R2 bucket, and nothing
   leaves it without a session whose grants cover that course.

   User records live in KV — there are a handful of people, so a table
   would have been ceremony. Shape:  user:<email> -> { grants, ... }
   ================================================================== */

import { TRACK_BY_ID, effectiveCourses, r2Key, COURSE_IDS, courseName } from "../shared/catalog.js";
import {
  verifyGoogleIdToken, signSession, readSession, sessionCookie, clearedCookie,
} from "./auth.js";

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

const userKey = (email) => `user:${email.toLowerCase()}`;

/* Emails in ADMIN_EMAILS are admins whatever KV says — that is what
   stops a fresh deployment locking its owner out. */
const isBootstrapAdmin = (env, email) =>
  String(env.ADMIN_EMAILS || "").toLowerCase().split(",")
    .map((e) => e.trim()).filter(Boolean).includes(String(email).toLowerCase());

async function getUser(env, email) {
  const rec = await env.ACCESS.get(userKey(email), "json");
  const base = rec || {
    email: String(email).toLowerCase(), name: "", picture: "",
    grants: [], createdAt: new Date().toISOString(),
  };
  /* The bootstrap list is read fresh on every request rather than baked
     into the stored record: being on it means admin and every course, on
     the spot. Otherwise a record written before the list changed strands
     its owner on the waiting screen, unable to reach their own People
     list to fix it. */
  if (isBootstrapAdmin(env, email))
    return { ...base, isAdmin: true, grants: COURSE_IDS.slice() };
  return { ...base, isAdmin: Boolean(base.isAdmin) };
}

const putUser = (env, user) => env.ACCESS.put(userKey(user.email), JSON.stringify(user));

/* Whoever is asking, or null. Every guarded route starts here. */
async function currentUser(request, env) {
  if (!env.SESSION_SECRET) return null;
  const email = await readSession(request.headers.get("Cookie"), env.SESSION_SECRET);
  return email ? await getUser(env, email) : null;
}

const publicUser = (u) => ({
  email: u.email, name: u.name, picture: u.picture,
  grants: u.grants || [], isAdmin: Boolean(u.isAdmin),
  request: u.request || null,
});

/* ------------------------- asking to be let in -------------------- */

const adminList = (env) =>
  String(env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);

/* Sends, and says what happened. The caller decides whether a failure
   matters — an access request must survive a dead mail provider, but the
   test button exists precisely to show you the failure. */
async function sendMail(env, { subject, text }) {
  const to = adminList(env);
  if (!env.RESEND_API_KEY) return { ok: false, why: "RESEND_API_KEY is not set on the Worker." };
  if (!to.length) return { ok: false, why: "ADMIN_EMAILS is empty, so there is nobody to write to." };

  const from = env.EMAIL_FROM || "Kriya <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    const body = await r.text();
    if (!r.ok) return { ok: false, why: `Resend refused it (${r.status}): ${body.slice(0, 300)}` };
    return { ok: true, to, from };
  } catch (e) {
    return { ok: false, why: `Could not reach Resend: ${e.message}` };
  }
}

async function emailAccessRequest(env, user, req, origin) {
  const asked = req.courses.length
    ? req.courses.map(courseName).join(", ")
    : "nothing in particular";
  const lines = [
    `${user.name || user.email} asked for access to Kriya.`,
    ``,
    `Email: ${user.email}`,
    `Says they have done: ${asked}`,
    req.note ? `Note: ${req.note}` : null,
    ``,
    `Approve, change or decline it here:`,
    `${origin}/`,
    ``,
    `Whatever you tick in People is what they get — their answer above`,
    `is a claim, not a grant.`,
  ].filter((l) => l !== null);

  const result = await sendMail(env, {
    subject: `Kriya access request — ${user.name || user.email}`,
    text: lines.join("\n"),
  });
  /* Logged rather than thrown: the request is already saved, and losing
     it because the mail failed would be the worse outcome. `wrangler
     tail` is where this shows up. */
  if (!result.ok) console.error("access request email failed:", result.why);
  return result;
}

async function handleAccessRequest(request, env, url) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in first." }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Expected a course list." }, { status: 400 });
  }

  const courses = (Array.isArray(body.courses) ? body.courses : [])
    .filter((c) => COURSE_IDS.includes(c));
  const note = String(body.note || "").slice(0, 500);

  const updated = {
    ...user,
    request: { courses, note, at: new Date().toISOString() },
  };
  await putUser(env, updated);
  await emailAccessRequest(env, updated, updated.request, url.origin);

  return json({ user: publicUser(updated) });
}

/* ------------------------------ routes ---------------------------- */

async function handleGoogleSignIn(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: "Sign-in is not configured yet." }, { status: 500 });
  if (!env.SESSION_SECRET) return json({ error: "SESSION_SECRET is not set." }, { status: 500 });

  let credential;
  try {
    ({ credential } = await request.json());
  } catch (e) {
    return json({ error: "Expected a credential." }, { status: 400 });
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return json({ error: `Google sign-in failed: ${e.message}` }, { status: 401 });
  }

  /* First sign-in creates the record with nothing granted: they land on
     the waiting screen, and show up in the admin list to be let in. */
  const existing = await getUser(env, identity.email);
  const user = {
    ...existing,
    name: identity.name || existing.name,
    picture: identity.picture || existing.picture,
    lastSeenAt: new Date().toISOString(),
  };
  await putUser(env, user);

  return json({ user: publicUser(user) }, {
    headers: { "set-cookie": sessionCookie(await signSession(user.email, env.SESSION_SECRET)) },
  });
}

async function handleAudio(request, env, trackId) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in first." }, { status: 401 });

  const track = TRACK_BY_ID.get(trackId);
  if (!track) return json({ error: "No such recording." }, { status: 404 });

  /* The check that actually matters. A 404 rather than a 403: someone
     who has not done the course learns nothing about what exists. */
  if (!effectiveCourses(user.grants).has(track.course))
    return json({ error: "No such recording." }, { status: 404 });

  const range = request.headers.get("Range");
  const object = await env.MEDIA.get(r2Key(track.file), range ? { range: request.headers } : {});
  if (!object) return json({ error: "That recording has not been uploaded." }, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!headers.has("content-type")) headers.set("content-type", "audio/mpeg");
  /* private: a shared cache must not keep a copy of gated audio, but
     the listener's own browser is welcome to. */
  headers.set("cache-control", "private, max-age=604800");

  if (range && object.range) {
    const offset = object.range.offset || 0;
    const length = object.range.length != null ? object.range.length : object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function handleTestEmail(request, env) {
  const me = await currentUser(request, env);
  if (!me || !me.isAdmin) return json({ error: "Not your screen." }, { status: 403 });

  const result = await sendMail(env, {
    subject: "Kriya — test",
    text: "This is the notification you get when someone asks for access.\n\nIf this arrived, the wiring works.",
  });
  return result.ok
    ? json({ ok: true, to: result.to, from: result.from })
    : json({ ok: false, error: result.why }, { status: 502 });
}

async function handleAdmin(request, env, url) {
  const me = await currentUser(request, env);
  if (!me) return json({ error: "Sign in first." }, { status: 401 });
  if (!me.isAdmin) return json({ error: "Not your screen." }, { status: 403 });

  if (request.method === "GET") {
    const list = await env.ACCESS.list({ prefix: "user:" });
    const users = await Promise.all(list.keys.map(async (k) => {
      const rec = await env.ACCESS.get(k.name, "json");
      if (!rec) return null;
      return publicUser({ ...rec, isAdmin: Boolean(rec.isAdmin) || isBootstrapAdmin(env, rec.email) });
    }));
    return json({ users: users.filter(Boolean).sort((a, b) => a.email.localeCompare(b.email)) });
  }

  const email = decodeURIComponent(url.pathname.split("/").pop() || "");

  if (request.method === "PUT") {
    if (!email || email === "users") return json({ error: "Which person?" }, { status: 400 });

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Expected grants." }, { status: 400 });
    }

    const user = await getUser(env, email);
    user.grants = (Array.isArray(body.grants) ? body.grants : []).filter((g) => COURSE_IDS.includes(g));
    /* Answering the request closes it, whether you gave them what they
       asked for, more, less, or nothing. */
    user.request = null;
    /* Nobody can strip their own admin rights and lock the door behind
       them; the bootstrap list is the only way back in. */
    if (typeof body.isAdmin === "boolean" && email.toLowerCase() !== me.email.toLowerCase())
      user.isAdmin = body.isAdmin;
    await putUser(env, user);
    return json({ user: publicUser(user) });
  }

  if (request.method === "DELETE") {
    if (email.toLowerCase() === me.email.toLowerCase())
      return json({ error: "You cannot remove yourself." }, { status: 400 });
    await env.ACCESS.delete(userKey(email));
    return json({ ok: true });
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (path === "/api/me") {
        const user = await currentUser(request, env);
        return json({
          signedIn: Boolean(user),
          user: user ? publicUser(user) : null,
          googleClientId: env.GOOGLE_CLIENT_ID || "",
        });
      }

      if (path === "/api/auth/google" && request.method === "POST")
        return handleGoogleSignIn(request, env);

      if (path === "/api/auth/logout" && request.method === "POST")
        return json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });

      if (path === "/api/admin/test-email" && request.method === "POST")
        return handleTestEmail(request, env);

      if (path === "/api/access-request" && request.method === "POST")
        return handleAccessRequest(request, env, url);

      if (path.startsWith("/api/audio/"))
        return handleAudio(request, env, decodeURIComponent(path.slice("/api/audio/".length)));

      if (path === "/api/admin/users" || path.startsWith("/api/admin/users/"))
        return handleAdmin(request, env, url);

      return json({ error: "No such endpoint." }, { status: 404 });
    } catch (e) {
      return json({ error: "Something went wrong on our side." }, { status: 500 });
    }
  },
};
