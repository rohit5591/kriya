import React, { useState, useEffect, useRef, useCallback } from "react";

import {
  COURSES, COURSE_IDS, GENERAL_FILES, buildCatalog, apiAudioUrl, courseName,
} from "../shared/catalog.js";

/* ==================================================================
   Two ways to run. Gated (the Cloudflare build) puts every recording
   behind a sign-in and hands out only what someone has been taught.
   Ungated (the plain static build) is the app as it was: the audio sits
   in public/audio and everything is on show.
   ================================================================== */

const GATED = import.meta.env.VITE_GATED === "true";
const PUBLIC_AUDIO = `${import.meta.env.BASE_URL}audio/`;
const publicAudioUrl = (t) => PUBLIC_AUDIO + encodeURIComponent(t.file);
const trackUrl = GATED ? apiAudioUrl : publicAudioUrl;

/* Backdrop — one of these is picked at random each time the app loads. */
const PHOTOS = [
  "images1.jpg", "images2.jpg", "images3.jpg", "images4.jpg", "images5.jpg",
  "images6.jpg", "images7.jpg", "images8.jpg", "images9.jpg",
];
const photoUrl = (f) => `${import.meta.env.BASE_URL}gurudev/${encodeURIComponent(f)}`;
const LOGO_URL = `${import.meta.env.BASE_URL}aol-logo.webp`;

/* Pre-built kriyas, backfilled into "My kriyas" if missing by id
   (won't duplicate or reappear-fight a deliberate edit to the same id). */
const DEFAULT_SEQUENCES = [
  {
    id: "advanced-kriya-with-yoga",
    name: "Advanced Kriya with Yoga",
    locked: true,
    steps: [
      { t: "mayur-karthik-padmasadhana-mp3", k: "s1" },
      { t: "3-stage-dinesh-mp3",             k: "s2" },
      { t: "bhastrika-dinesh-mp3",           k: "s3" },
      { t: "mudra-pranayams-mp3",            k: "s4" },
      { t: "kriya-empty-audio-mp3",          k: "s5" },
      { t: "bhanudisahaj-mp3",               k: "s6" },
    ],
  },
  {
    id: "advanced-kriya-no-yoga",
    name: "Advanced Kriya no Yoga",
    locked: true,
    steps: [
      { t: "3-stage-dinesh-mp3",    k: "s1" },
      { t: "bhastrika-dinesh-mp3",  k: "s2" },
      { t: "mudra-pranayams-mp3",   k: "s3" },
      { t: "kriya-empty-audio-mp3", k: "s4" },
      { t: "bhanudisahaj-mp3",      k: "s5" },
    ],
  },
];

const STORE_KEY = "kriya-store";
const PAUSE_CHOICES = [5, 10, 15, 30, 60, 120, 300];

/* true when you host this yourself; localStorage is blocked in Claude */
const USE_LOCAL_STORAGE = true;

/* ---------------------------- storage ----------------------------- */
/* { sequences: [...], teacher: "Vishal", durations: { id: seconds } } */

async function loadStore() {
  try {
    if (USE_LOCAL_STORAGE) {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    if (!window.storage) return null;
    const r = await window.storage.get(STORE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch (e) { return null; }
}

async function saveStore(data) {
  try {
    if (USE_LOCAL_STORAGE) {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    }
    if (!window.storage) return false;
    await window.storage.set(STORE_KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

/* ---------------------------- helpers ----------------------------- */

const uid = () => Math.random().toString(36).slice(2, 9);

function fmt(sec) {
  if (sec == null || !isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function fmtLong(sec) {
  if (!sec) return "";
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
const tagOf = (t) => [t.variant, t.teacher].filter(Boolean).join(" · ");

/* ------------------------------ app ------------------------------- */

export default function App() {
  /* Who is signed in, and what they were granted. Ungated, there is no
     such thing: everyone gets everything, exactly as before. */
  const [auth, setAuth] = useState(
    GATED ? { state: "checking" } : { state: "open", grants: COURSE_IDS });

  useEffect(() => {
    if (!GATED) return;
    let alive = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setAuth(d.signedIn
          ? { state: "in", user: d.user, grants: d.user.grants, clientId: d.googleClientId }
          : { state: "out", clientId: d.googleClientId });
      })
      .catch(() => alive && setAuth({ state: "offline" }));
    return () => { alive = false; };
  }, []);

  const grants = auth.grants || [];
  const grantsKey = grants.join(",");
  /* Rebuilt whenever the grants change, so nothing they have not been
     taught is ever in the list to begin with. */
  const cat = React.useMemo(
    () => buildCatalog(grantsKey ? grantsKey.split(",") : [], trackUrl), [grantsKey]);

  const [teacher, setTeacher] = useState("General");
  const [sequences, setSequences] = useState([]);
  const [durations, setDurations] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [canSave, setCanSave] = useState(true);

  const [view, setView] = useState("home");
  const [editing, setEditing] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [toast, setToast] = useState(null);

  /* lazy initialiser, so the backdrop is drawn once per load and then
     stays put — re-rolling it on every render would flicker */
  const [photo] = useState(() => PHOTOS[Math.floor(Math.random() * PHOTOS.length)]);

  const audioA = useRef(null);
  const audioB = useRef(null);
  const trackById = (id) => cat.byId.get(id);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await loadStore();
      if (!alive) return;
      let seq = d && Array.isArray(d.sequences) ? d.sequences : [];
      /* re-sync any saved copy back to the canonical preset (covers users who
         got these backfilled before "locked" existed, and keeps presets
         un-editable even if a saved copy somehow drifted) */
      seq = seq.map((s) => DEFAULT_SEQUENCES.find((ds) => ds.id === s.id) || s);
      const missing = DEFAULT_SEQUENCES.filter((ds) => !seq.some((s) => s.id === ds.id));
      if (missing.length) seq = [...seq, ...missing];
      setSequences(seq);
      if (d) {
        setDurations(d.durations || {});
        /* teacher tab is intentionally NOT restored — General is always
           the tab you land on, regardless of what you last picked */
      }
      if (!USE_LOCAL_STORAGE && !window.storage) setCanSave(false);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      saveStore({ sequences, teacher, durations }).then((ok) => { if (!ok) setCanSave(false); });
    }, 400);
    return () => clearTimeout(id);
  }, [sequences, teacher, durations, loaded]);

  /* Read lengths once, cache them. Probed a few at a time rather than all
     at once — opening ~20 <audio> elements simultaneously is enough for
     mobile Safari to quietly drop some of them, which is what leaves a
     dash where a length should be. */
  useEffect(() => {
    if (!loaded) return;
    let alive = true;

    /* one recording can back several entries (Fast Kriya is both a practice
       and a full kriya), so fetch per unique file and fan the answer out */
    const byUrl = new Map();
    cat.all.forEach((t) => {
      if (durations[t.id]) return;
      if (!byUrl.has(t.url)) byUrl.set(t.url, []);
      byUrl.get(t.url).push(t.id);
    });
    const queue = [...byUrl.entries()];

    const probeOne = (url) => new Promise((resolve) => {
      const probe = document.createElement("audio");
      let timer;
      const finish = (v) => {
        clearTimeout(timer);
        probe.onloadedmetadata = probe.onerror = null;
        probe.removeAttribute("src");
        probe.load(); /* let go of the connection instead of leaving it open */
        resolve(v);
      };
      probe.preload = "metadata";
      probe.onloadedmetadata = () => finish(isFinite(probe.duration) ? probe.duration : null);
      probe.onerror = () => finish(null);
      /* don't let one stuck file block the rest of the queue forever */
      timer = setTimeout(() => finish(null), 20000);
      probe.src = url;
    });

    const worker = async () => {
      while (alive) {
        const item = queue.shift();
        if (!item) return;
        const [url, ids] = item;
        const secs = await probeOne(url);
        if (!alive || secs == null) continue;
        setDurations((prev) => {
          const next = { ...prev };
          ids.forEach((id) => { next[id] = secs; });
          return next;
        });
      }
    };
    for (let i = 0; i < 3; i++) worker();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  /* A preset built from Mudra and Sahaj is meaningless to someone who
     has done neither, so it simply isn't shown. Their own kriyas are
     kept on the device untouched — they come back if access widens. */
  const visibleSequences = sequences.filter((s) =>
    s.steps.every((st) => st.p || cat.byId.has(st.t)));
  const seqDuration = (s) => s.steps.reduce((a, st) => a + (st.p ? st.p : durations[st.t] || 0), 0);
  const playOne = (t, name) => {
    setPlaying({ name: name || t.practice, steps: [{ t: t.id, k: "1" }] });
    setView("play");
  };

  const shell = (inner) => (
    <div className={view === "play" ? "k-root k-root-photo" : "k-root"}
         style={{ "--bg-photo": `url("${photoUrl(photo)}")` }}>
      <Styles />
      {inner}
      {toast && <div className="k-toast">{toast}</div>}
    </div>
  );

  if (auth.state === "checking") return shell(<div className="k-gate" />);
  if (auth.state === "offline")
    return shell(
      <Gate title="Can't reach the server">
        <p className="k-sub">
          Check your connection and reload. Nothing is lost — your kriyas
          are saved on this device.
        </p>
      </Gate>);
  if (auth.state === "out")
    return shell(<SignIn clientId={auth.clientId} onSignedIn={(user) =>
      setAuth({ state: "in", user, grants: user.grants, clientId: auth.clientId })} />);
  /* signed in, but nobody has let them in yet — admins excepted, since
     they are the ones who would have to do the letting in */
  if (auth.state === "in" && grants.length === 0 && !(auth.user && auth.user.isAdmin))
    return shell(
      <Waiting
        user={auth.user}
        onRequested={(user) => setAuth((a) => ({ ...a, user }))}
        onSignOut={() => signOut(setAuth, auth.clientId)} />);

  if (view === "admin")
    return shell(<Admin me={auth.user} onBack={() => setView("home")} />);

  return shell(
    <>
      <audio ref={audioA} preload="auto" />
      <audio ref={audioB} preload="auto" />

      {view === "home" && (
        <Home
          cat={cat} me={auth.user} onAdmin={() => setView("admin")}
          onSignOut={() => signOut(setAuth, auth.clientId)}
          teacher={teacher} setTeacher={setTeacher}
          sequences={visibleSequences} seqDuration={seqDuration} durations={durations} canSave={canSave}
          onPlayTrack={playOne}
          onPlaySeq={(s) => { setPlaying(s); setView("play"); }}
          onEdit={(s) => { setEditing(JSON.parse(JSON.stringify(s))); setView("build"); }}
          onNew={() => { setEditing({ id: uid(), name: "", steps: [] }); setView("build"); }}
          onLibrary={() => setView("library")}
        />
      )}

      {view === "build" && (
        <Builder
          cat={cat} seq={editing} teacher={teacher} durations={durations} trackById={trackById}
          onChange={setEditing}
          onSave={(s) => {
            const named = { ...s, name: s.name.trim() || "Untitled kriya" };
            setSequences((prev) => {
              const i = prev.findIndex((x) => x.id === named.id);
              if (i === -1) return [...prev, named];
              const c = [...prev]; c[i] = named; return c;
            });
            setView("home"); flash("Kriya saved");
          }}
          onDelete={(id) => { setSequences((p) => p.filter((s) => s.id !== id)); setView("home"); }}
          onCancel={() => setView("home")}
        />
      )}

      {view === "library" && <LibraryView cat={cat} durations={durations} onBack={() => setView("home")} />}

      {view === "play" && playing && (
        <Player
          audioA={audioA} audioB={audioB} seq={playing}
          trackById={trackById} durations={durations}
          onExit={() => { setView("home"); setPlaying(null); }}
        />
      )}
    </>
  );
}

/* ------------------------------ gate ------------------------------ */
/* Only ever rendered in the gated build. Three states: prove who you
   are, wait for someone to let you in, or manage who is let in. */

async function signOut(setAuth, clientId) {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch (e) { /* the cookie is the session; a failed call just leaves it */ }
  if (window.google && window.google.accounts && window.google.accounts.id)
    window.google.accounts.id.disableAutoSelect();
  setAuth({ state: "out", clientId });
}

function Gate({ title, children }) {
  return (
    <div className="k-fade k-gate">
      <img className="k-logo k-gate-logo" src={LOGO_URL} alt="The Art of Living" />
      <div className="k-eyebrow">Sadhana</div>
      <h1 className="k-display k-h1 k-gate-title">{title}</h1>
      {children}
    </div>
  );
}

function SignIn({ clientId, onSignedIn }) {
  const holder = useRef(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setError("Sign-in isn’t configured yet — GOOGLE_CLIENT_ID is missing.");
      return;
    }
    let alive = true;

    const send = async (credential) => {
      setBusy(true); setError(null);
      try {
        const r = await fetch("/api/auth/google", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Sign-in failed.");
        onSignedIn(d.user);
      } catch (e) {
        if (alive) { setError(e.message); setBusy(false); }
      }
    };

    const start = () => {
      if (!alive || !holder.current) return;
      const gsi = window.google && window.google.accounts && window.google.accounts.id;
      if (!gsi) { setError("Couldn’t load Google sign-in."); return; }
      gsi.initialize({ client_id: clientId, callback: (res) => send(res.credential) });
      gsi.renderButton(holder.current, {
        theme: "filled_black", size: "large", shape: "pill",
        text: "continue_with", width: 260,
      });
    };

    if (window.google && window.google.accounts) { start(); return () => { alive = false; }; }
    const tag = document.createElement("script");
    tag.src = "https://accounts.google.com/gsi/client";
    tag.async = true; tag.defer = true;
    tag.onload = start;
    tag.onerror = () => { if (alive) setError("Couldn’t load Google sign-in."); };
    document.head.appendChild(tag);
    return () => { alive = false; };
  }, [clientId, onSignedIn]);

  return (
    <Gate title="Sudarshan Kriya">
      <p className="k-sub k-gate-sub">
        These recordings are for people who have sat the courses. Sign in
        and you’ll see the practices you have been taught.
      </p>
      <div className="k-gsi" ref={holder} />
      {busy && <p className="k-sub">Signing you in…</p>}
      {error && <p className="k-warn k-gate-sub">{error}</p>}
    </Gate>
  );
}

function Waiting({ user, onSignOut, onRequested }) {
  const [courses, setCourses] = useState(() => (user.request ? user.request.courses : []));
  const [note, setNote] = useState(() => (user.request ? user.request.note : ""));
  const [editing, setEditing] = useState(!user.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (id) =>
    setCourses((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/access-request", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courses, note }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not send the request.");
      onRequested(d.user);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  /* Sent, and nobody has answered yet. */
  if (!editing && user.request) {
    const asked = user.request.courses.map(courseName);
    return (
      <Gate title="Request sent">
        <p className="k-sub k-gate-sub">
          You asked for {asked.length ? <b>{asked.join(", ")}</b> : "access"} as{" "}
          <span className="k-mono">{user.email}</span>. You will be let in once
          someone approves it — reload this page then.
        </p>
        <button className="k-btn k-wide k-gate-btn" onClick={() => window.location.reload()}>Reload</button>
        <button className="k-ghost" onClick={() => setEditing(true)}>Change my request</button>
        <button className="k-ghost" onClick={onSignOut}>Sign out</button>
      </Gate>
    );
  }

  return (
    <Gate title="Which courses have you done?">
      <p className="k-sub k-gate-sub">
        Signed in as <span className="k-mono">{user.email}</span>. Tell us what
        you have sat and your request goes off for approval. Only what is
        approved opens up.
      </p>

      <div className="k-chiprow k-gate-chips">
        {COURSES.map((c) => (
          <button key={c.id}
            className={"k-chip" + (courses.includes(c.id) ? " k-chip-on" : "")}
            onClick={() => toggle(c.id)}>
            {courses.includes(c.id) ? "✓ " : ""}{c.name}
          </button>
        ))}
      </div>

      <textarea
        className="k-note-input" rows={3} maxLength={500}
        placeholder="Anything worth adding — where you did the course, who taught it"
        value={note} onChange={(e) => setNote(e.target.value)} />

      <button className="k-btn k-primary k-wide k-gate-btn" disabled={busy} onClick={send}>
        {busy ? "Sending…" : "Send request"}
      </button>
      {error && <p className="k-warn k-gate-sub">{error}</p>}
      <button className="k-ghost" onClick={onSignOut}>Sign out</button>
    </Gate>
  );
}

/* --------------------------- who gets what ------------------------ */

function Admin({ me, onBack }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  /* What a pending request will be approved as. Starts at what they
     asked for; every chip you tick before approving overrides it. */
  const [draft, setDraft] = useState({});

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/users", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.users) setUsers(d.users); else setError(d.error || "Could not load the list.");
      })
      .catch(() => alive && setError("Could not load the list."));
    return () => { alive = false; };
  }, []);

  /* The server's copy of the row wins on success — it is the thing that
     knows the request is now closed. */
  const save = async (email, grants, isAdmin) => {
    setSaving(email); setError(null);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
        method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grants, isAdmin }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed.");
      setUsers((prev) => prev.map((u) => (u.email === email ? d.user : u)));
      setDraft((prev) => { const next = { ...prev }; delete next[email]; return next; });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  const remove = async (email) => {
    setSaving(email); setError(null);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
        method: "DELETE", credentials: "same-origin",
      });
      if (!r.ok) throw new Error((await r.json()).error || "Could not remove.");
      setUsers((prev) => prev.filter((u) => u.email !== email));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  };

  /* Proves the mail path in one click, and says exactly why when it
     fails — the access-request path deliberately stays quiet about mail
     failures, so without this you would be guessing. */
  const [mail, setMail] = useState(null);
  const testEmail = async () => {
    setMail({ state: "sending" });
    try {
      const r = await fetch("/api/admin/test-email", { method: "POST", credentials: "same-origin" });
      const d = await r.json();
      setMail(r.ok
        ? { state: "ok", to: (d.to || []).join(", ") }
        : { state: "fail", why: d.error || "Could not send." });
    } catch (e) {
      setMail({ state: "fail", why: e.message });
    }
  };

  const chosen = (u) => draft[u.email] || (u.request ? u.request.courses : u.grants);
  const setChosen = (u, courses) => setDraft((prev) => ({ ...prev, [u.email]: courses }));

  const tap = (u, courseId) => {
    const now = chosen(u);
    const next = now.includes(courseId)
      ? now.filter((g) => g !== courseId)
      : [...now, courseId];
    /* Someone waiting gets a draft you commit with Approve; someone
       already in is edited live, since there is nothing to answer. */
    if (u.request) setChosen(u, next);
    else save(u.email, next, u.isAdmin);
  };

  /* People waiting on you belong at the top. */
  const ordered = (users || []).slice().sort((a, b) =>
    Boolean(b.request) - Boolean(a.request) || a.email.localeCompare(b.email));
  const waiting = ordered.filter((u) => u.request).length;

  return (
    <div className="k-fade">
      <header className="k-head">
        <button className="k-ghost" onClick={onBack}>Back</button>
        <div className="k-eyebrow">People</div>
      </header>

      <p className="k-sub">
        Tick the courses someone has actually done. Part 2 and Sahaj each
        carry Part 1 with them; Sanyam 2 carries everything.
      </p>

      {waiting > 0 && (
        <p className="k-eyebrow k-mt-s k-waiting-count">
          {waiting} waiting for an answer
        </p>
      )}

      <div className="k-mailtest">
        <button className="k-ghost" onClick={testEmail}
          disabled={mail && mail.state === "sending"}>
          {mail && mail.state === "sending" ? "Sending…" : "Send test email"}
        </button>
        {mail && mail.state === "ok" && (
          <span className="k-sub k-small">Sent to {mail.to} — check spam too.</span>
        )}
        {mail && mail.state === "fail" && <span className="k-warn k-small">{mail.why}</span>}
      </div>

      {error && <p className="k-warn k-mt-s">{error}</p>}
      {!users && !error && <p className="k-sub k-mt">Loading…</p>}
      {users && users.length === 0 && <p className="k-sub k-mt">Nobody has signed in yet.</p>}

      <div className="k-list k-mt">
        {ordered.map((u) => {
          const picked = chosen(u);
          return (
            <div key={u.email}
              className={"k-card" + (u.request ? " k-card-pending" : "") + (saving === u.email ? " k-saving" : "")}>
              <div className="k-userhead">
                <span className="k-userwho">
                  <span className="k-display k-username">{u.name || u.email}</span>
                  <span className="k-sub k-mono k-small">{u.email}</span>
                </span>
                {u.isAdmin && <span className="k-tag">Admin</span>}
              </div>

              {u.request && (
                <div className="k-request">
                  <div className="k-eyebrow">Asked for</div>
                  <div className="k-request-courses">
                    {u.request.courses.length
                      ? u.request.courses.map(courseName).join(" · ")
                      : "nothing in particular"}
                  </div>
                  {u.request.note && <p className="k-request-note">“{u.request.note}”</p>}
                  <div className="k-sub k-mono k-small">
                    {new Date(u.request.at).toLocaleDateString()}
                  </div>
                </div>
              )}

              <div className="k-chiprow">
                {COURSES.map((c) => (
                  <button key={c.id}
                    className={"k-chip k-chip-sm" + (picked.includes(c.id) ? " k-chip-on" : "")}
                    onClick={() => tap(u, c.id)}>
                    {picked.includes(c.id) ? "✓ " : ""}{c.name}
                  </button>
                ))}
              </div>

              {u.request ? (
                <div className="k-approvebar">
                  <button className="k-btn k-primary" disabled={saving === u.email}
                    onClick={() => save(u.email, picked, u.isAdmin)}>
                    {picked.length ? `Approve ${picked.length === 1 ? courseName(picked[0]) : `${picked.length} courses`}` : "Approve with nothing"}
                  </button>
                  <button className="k-ghost" disabled={saving === u.email}
                    onClick={() => save(u.email, u.grants, u.isAdmin)}>Decline</button>
                </div>
              ) : (
                u.email !== me.email && (
                  <button className="k-danger" onClick={() => remove(u.email)}>Remove</button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ home ------------------------------ */

function Home({ cat, teacher, setTeacher, sequences, seqDuration, durations, canSave,
                onPlayTrack, onPlaySeq, onEdit, onNew, onLibrary, onAdmin, onSignOut, me }) {

  const theirFull = teacher === "General"
    ? cat.pathTracks.filter((t) => GENERAL_FILES.includes(t.file))
    : cat.pathTracks.filter((t) => t.teacher === teacher);
  const theirSolo = teacher === "General" ? [] : cat.library.filter((t) => t.teacher === teacher);
  const generalSequences = teacher === "General" ? sequences.filter((s) => s.locked) : [];
  /* The practices, one row per practice, on the General tab. Without
     this the teacher-less ones — Mudra, Bhogar, the bells, Samaveda —
     live only under Recordings, so being granted Part 2 or Sanyam 2
     changes nothing you can see from the home screen. */
  const generalPractices = teacher === "General"
    ? cat.practices.map((name) => cat.library.find((t) => t.practice === name)).filter(Boolean)
    : [];
  const myKriyas = sequences.filter((s) => !s.locked);

  const row = (t, label) => (
    <button key={t.id} className="k-card k-row" onClick={() => onPlayTrack(t, label || t.name)}>
      <span>
        <span className="k-display k-rowname">{label || t.name || t.practice}</span>
        {teacher === "General"
          ? (tagOf(t) && <span className="k-tag">{tagOf(t)}</span>)
          : (t.variant && <span className="k-tag">{t.variant}</span>)}
        <span className="k-sub k-mono k-small">{durations[t.id] ? fmtLong(durations[t.id]) : "—"}</span>
      </span>
      <span className="k-play" aria-hidden="true" />
    </button>
  );

  const seqRow = (s) => {
    const d = seqDuration(s);
    return (
      <button key={s.id} className="k-card k-row" onClick={() => onPlaySeq(s)}>
        <span>
          <span className="k-display k-rowname">{s.name}</span>
          <span className="k-sub k-mono k-small">{d ? fmtLong(d) : "—"}</span>
        </span>
        <span className="k-play" aria-hidden="true" />
      </button>
    );
  };

  return (
    <div className="k-fade">
      <header className="k-head">
        <div className="k-brand">
          <img className="k-logo" src={LOGO_URL} alt="The Art of Living" />
          <div>
            <div className="k-eyebrow">Sadhana</div>
            <h1 className="k-display k-h1">Sudarshan Kriya</h1>
          </div>
        </div>
        <span className="k-headbtns">
          {me && me.isAdmin && <button className="k-ghost" onClick={onAdmin}>People</button>}
          <button className="k-ghost" onClick={onLibrary}>Recordings</button>
        </span>
      </header>

      <div className="k-teacherbar">
        <span className="k-eyebrow">Guided by</span>
        <div className="k-teacherrow">
          {cat.teachers.map((t) => (
            <button key={t} className={"k-teacher" + (t === teacher ? " k-teacher-on" : "")}
              onClick={() => setTeacher(t)}>{t}</button>
          ))}
        </div>
      </div>

      {(theirFull.length > 0 || generalSequences.length > 0) && (
        <>
          <div className="k-eyebrow k-mt">Full kriyas</div>
          <div className="k-list k-mt-s">
            {theirFull.map((t) => row(t))}
            {generalSequences.map((s) => seqRow(s))}
          </div>
        </>
      )}

      {theirFull.length === 0 && theirSolo.length > 0 && (
        <>
          <div className="k-eyebrow k-mt">{teacher}</div>
          <div className="k-list k-mt-s">{theirSolo.map((t) => row(t, t.practice))}</div>
        </>
      )}

      {generalPractices.length > 0 && (
        <>
          <div className="k-eyebrow k-mt">Practices</div>
          <div className="k-list k-mt-s">
            {generalPractices.map((t) => row(t, t.practice))}
          </div>
        </>
      )}

      {cat.sharedFull.length > 0 && (
        <>
          <div className="k-eyebrow k-mt">Any teacher</div>
          <div className="k-list k-mt-s">{cat.sharedFull.map((t) => row(t))}</div>
        </>
      )}

      <div className="k-headrow k-mt">
        <span className="k-eyebrow">My kriyas</span>
        <button className="k-ghost" onClick={onNew}>+ New</button>
      </div>

      {myKriyas.length === 0 ? (
        <p className="k-sub">
          Nothing built yet. String the practices together — a short one for
          weekday mornings, a long one for Sundays.
        </p>
      ) : (
        <div className="k-list k-mt-s">
          {myKriyas.map((s) => {
            const d = seqDuration(s);
            return (
              <div key={s.id} className="k-card k-seqcard">
                <button className="k-seqmain" onClick={() => onPlaySeq(s)}>
                  <div>
                    <div className="k-display k-rowname">{s.name}</div>
                    <div className="k-sub k-mono k-small">
                      {s.steps.filter((x) => x.t).length} practices{d ? ` · ${fmtLong(d)}` : ""}
                    </div>
                    <div className="k-thread">
                      {s.steps.map((st, i) => (
                        <span key={st.k || i} className={st.p ? "k-bead k-bead-sm" : "k-bead"} />
                      ))}
                    </div>
                  </div>
                  <span className="k-play" aria-hidden="true" />
                </button>
                {s.locked
                  ? <div className="k-edit k-edit-locked">Preset</div>
                  : <button className="k-edit" onClick={() => onEdit(s)}>Edit</button>}
              </div>
            );
          })}
        </div>
      )}

      <p className="k-foot">
        {canSave
          ? "Your kriyas, your teacher and the track lengths are saved on this device."
          : "Saving is unavailable here — kriyas will last for this session only."}
      </p>

      {me && (
        <div className="k-signedin">
          <span className="k-sub k-mono k-small">{me.email}</span>
          <button className="k-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- builder ---------------------------- */

function Builder({ cat, seq, teacher, durations, trackById, onChange, onSave, onDelete, onCancel }) {
  const [open, setOpen] = useState(null);
  const set = (patch) => onChange({ ...seq, ...patch });

  const versionsOf = (practice) => {
    const v = cat.library.filter((t) => t.practice === practice);
    return [...v].sort((a, b) => (b.teacher === teacher) - (a.teacher === teacher));
  };

  const pick = (practice) => {
    const v = versionsOf(practice);
    if (v.length === 1) return add(v[0].id);
    const mine = v.filter((x) => x.teacher === teacher);
    if (mine.length === 1) return add(mine[0].id);
    setOpen(open === practice ? null : practice);
  };

  const add = (tid) => { set({ steps: [...seq.steps, { t: tid, k: uid() }] }); setOpen(null); };
  const addPause = () => set({ steps: [...seq.steps, { p: 15, k: uid() }] });

  const move = (i, dir) => {
    const s = [...seq.steps], j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    set({ steps: s });
  };
  const cyclePause = (i) => {
    const s = [...seq.steps];
    s[i] = { ...s[i], p: PAUSE_CHOICES[(PAUSE_CHOICES.indexOf(s[i].p) + 1) % PAUSE_CHOICES.length] };
    set({ steps: s });
  };
  const swapVersion = (i, tid) => {
    const s = [...seq.steps];
    s[i] = { ...s[i], t: tid };
    set({ steps: s });
  };

  const total = seq.steps.reduce((a, st) => a + (st.p ? st.p : durations[st.t] || 0), 0);

  return (
    <div className="k-fade">
      <header className="k-head">
        <button className="k-ghost" onClick={onCancel}>Back</button>
        <button className="k-btn k-primary" disabled={!seq.steps.length} onClick={() => onSave(seq)}>Save</button>
      </header>

      <input className="k-display k-nameinput" placeholder="Name this kriya"
        value={seq.name} onChange={(e) => set({ name: e.target.value })} />

      <div className="k-headrow k-mt">
        <span className="k-eyebrow">The sequence</span>
        {total > 0 && <span className="k-mono k-dim k-small">{fmtLong(total)}</span>}
      </div>

      {seq.steps.length === 0 && <p className="k-sub">Empty. Add a practice below.</p>}

      <ol className="k-steps">
        {seq.steps.map((st, i) => {
          const t = st.t ? trackById(st.t) : null;
          const sibs = t ? cat.library.filter((x) => x.practice === t.practice) : [];
          return (
            <li key={st.k || i} className="k-step">
              <span className={st.p ? "k-bead k-bead-sm" : "k-bead"} />
              {st.p ? (
                <button className="k-steplabel k-pause" onClick={() => cyclePause(i)}>
                  Silence <span className="k-mono">{fmt(st.p)}</span>
                  <span className="k-hint">tap to change</span>
                </button>
              ) : (
                <span className="k-steplabel">
                  <span className="k-display k-stepname">{t ? t.practice : "Missing"}</span>
                  {t && sibs.length > 1 ? (
                    <select className="k-select" value={t.id} onChange={(e) => swapVersion(i, e.target.value)}>
                      {sibs.map((x) => <option key={x.id} value={x.id}>{tagOf(x) || "Default"}</option>)}
                    </select>
                  ) : t && tagOf(t) ? <span className="k-tag">{tagOf(t)}</span> : null}
                  {t && durations[t.id] && <span className="k-mono k-dim k-small">{fmt(durations[t.id])}</span>}
                </span>
              )}
              <span className="k-stepbtns">
                <button className="k-icon" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="k-icon" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="k-icon" onClick={() => set({ steps: seq.steps.filter((_, x) => x !== i) })} aria-label="Remove">×</button>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="k-eyebrow k-mt">Add a practice</div>
      <div className="k-chiprow">
        {cat.practices.map((p) => (
          <button key={p} className={"k-chip" + (open === p ? " k-chip-on" : "")} onClick={() => pick(p)}>{p}</button>
        ))}
        <button className="k-chip k-chip-alt" onClick={addPause}>+ Silence</button>
      </div>

      {open && (
        <div className="k-card k-mt-s">
          <div className="k-eyebrow">{open} — which one</div>
          <div className="k-chiprow">
            {versionsOf(open).map((v) => (
              <button key={v.id} className="k-chip k-chip-sm" onClick={() => add(v.id)}>
                {tagOf(v) || "Default"}
                {durations[v.id] ? <span className="k-mono k-dim k-small"> {fmt(durations[v.id])}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="k-mt">
        <button className="k-danger" onClick={() => onDelete(seq.id)}>Delete this kriya</button>
      </div>
    </div>
  );
}

/* ---------------------------- recordings -------------------------- */

function LibraryView({ cat, durations, onBack }) {
  const [preview, setPreview] = useState(null);
  const el = useRef(null);

  const toggle = (t) => {
    if (!el.current) return;
    if (preview === t.id) { el.current.pause(); setPreview(null); }
    else { el.current.src = t.url; el.current.play().catch(() => {}); setPreview(t.id); }
  };

  const group = (title, items) => (
    <div key={title} className="k-card k-group">
      <div className="k-display k-groupname">{title}</div>
      {items.map((t) => (
        <div key={t.id} className="k-verrow">
          <span className="k-verleft">
            <span className="k-tag">{tagOf(t) || "Default"}</span>
            <span className="k-mono k-dim k-small k-file">{t.file}</span>
          </span>
          <span className="k-verright">
            <span className="k-mono k-dim k-small">{durations[t.id] ? fmt(durations[t.id]) : "—"}</span>
            <button className="k-ghost" onClick={() => toggle(t)}>{preview === t.id ? "Stop" : "Play"}</button>
          </span>
        </div>
      ))}
    </div>
  );

  const fullNames = [...new Set(cat.pathTracks.map((t) => t.name))];

  return (
    <div className="k-fade">
      <header className="k-head">
        <button className="k-ghost" onClick={onBack}>Back</button>
        <div className="k-eyebrow">Recordings</div>
      </header>
      <audio ref={el} onEnded={() => setPreview(null)} />

      <p className="k-sub">
        A dash instead of a length means that file didn’t load — check the name
        matches your folder exactly.
      </p>

      <div className="k-eyebrow k-mt">Practices</div>
      <div className="k-list k-mt-s">
        {cat.practices.map((p) => group(p, cat.library.filter((t) => t.practice === p)))}
      </div>

      <div className="k-eyebrow k-mt">Full kriyas</div>
      <div className="k-list k-mt-s">
        {fullNames.map((n) => group(n, cat.pathTracks.filter((t) => t.name === n)))}
      </div>
    </div>
  );
}

/* ------------------------------ player ---------------------------- */

function Player({ audioA, audioB, seq, trackById, durations, onExit }) {
  const [index, setIndex] = useState(0);
  const [isPlaying, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(null);
  const timer = useRef(null);
  const pauseElapsed = useRef(0); /* elapsed seconds for silence steps, mutated by the
                                      countdown interval and by seeking alike */

  const step = seq.steps[index];
  const done = index >= seq.steps.length;
  const track = step && step.t ? trackById(step.t) : null;
  const next = useCallback(() => setIndex((i) => i + 1), []);

  /* audio steps alternate across two elements, so the next recording
     buffers while the current one is still playing                    */
  const audioSteps = seq.steps.map((s, i) => (s.t ? i : -1)).filter((i) => i >= 0);
  const elFor = (i) => {
    const n = audioSteps.indexOf(i);
    return n < 0 ? null : (n % 2 === 0 ? audioA.current : audioB.current);
  };
  const warm = (from) => {
    const j = audioSteps.find((i) => i > from);
    if (j == null) return;
    const t = trackById(seq.steps[j].t);
    const el = elFor(j);
    if (!t || !el || el.dataset.url === t.url) return;
    el.dataset.url = t.url;
    el.src = t.url;
    el.load();
  };

  useEffect(() => {
    const cur = elFor(index);
    if (done) {
      [audioA.current, audioB.current].forEach((a) => a && a.pause());
      return;
    }
    clearInterval(timer.current);
    setElapsed(0); setStatus(null);

    if (step.p) {
      [audioA.current, audioB.current].forEach((a) => a && a.pause());
      setTotal(step.p);
      warm(index);
      pauseElapsed.current = 0;
      timer.current = setInterval(() => {
        pauseElapsed.current += 0.25; setElapsed(pauseElapsed.current);
        if (pauseElapsed.current >= step.p) { clearInterval(timer.current); next(); }
      }, 250);
      return () => clearInterval(timer.current);
    }

    if (!track || !cur) { next(); return; }
    const other = cur === audioA.current ? audioB.current : audioA.current;
    if (other) other.pause();

    const ready = cur.dataset.url === track.url;
    if (!ready) { cur.dataset.url = track.url; cur.src = track.url; }
    cur.currentTime = 0;
    setTotal(durations[track.id] || (isFinite(cur.duration) ? cur.duration : 0));
    setStatus(ready && cur.readyState >= 3 ? null : "loading");

    const p = cur.play();
    if (p && p.catch) p.catch(() => setStatus("blocked"));

    const onPlaying = () => { setStatus(null); warm(index); };
    const onEnd = () => next();
    const onMeta = () => setTotal(cur.duration);
    const onErr = () => setStatus("error");
    cur.addEventListener("playing", onPlaying);
    cur.addEventListener("ended", onEnd);
    cur.addEventListener("loadedmetadata", onMeta);
    cur.addEventListener("error", onErr);
    timer.current = setInterval(() => setElapsed(cur.currentTime), 250);
    return () => {
      cur.removeEventListener("playing", onPlaying);
      cur.removeEventListener("ended", onEnd);
      cur.removeEventListener("loadedmetadata", onMeta);
      cur.removeEventListener("error", onErr);
      clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, done]);

  useEffect(() => {
    if (!step || !step.p) return;
    clearInterval(timer.current);
    if (!isPlaying) return;
    timer.current = setInterval(() => {
      pauseElapsed.current += 0.25; setElapsed(pauseElapsed.current);
      if (pauseElapsed.current >= step.p) { clearInterval(timer.current); next(); }
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  useEffect(() => {
    let lock = null;
    if (isPlaying && navigator.wakeLock)
      navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => { try { lock && lock.release(); } catch (e) {} };
  }, [isPlaying]);

  useEffect(() => () => {
    [audioA.current, audioB.current].forEach((a) => {
      if (!a) return;
      a.pause(); a.removeAttribute("src"); delete a.dataset.url; a.load();
    });
    clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const cur = elFor(index);
    if (isPlaying) { if (!step.p && cur) cur.pause(); setPlaying(false); }
    else {
      if (!step.p && cur) { const p = cur.play(); if (p && p.catch) p.catch(() => setStatus("blocked")); }
      setStatus(null); setPlaying(true);
    }
  };
  const skip = (d) => { setPlaying(true); setIndex(Math.min(seq.steps.length, Math.max(0, index + d))); };

  const seek = (value) => {
    const t = Math.max(0, Math.min(total, value));
    if (step.p) { pauseElapsed.current = t; setElapsed(t); return; }
    const cur = elFor(index);
    if (cur) cur.currentTime = t;
    setElapsed(t);
  };

  const pct = total ? Math.min(100, (elapsed / total) * 100) : 0;
  const left = total ? Math.max(0, total - elapsed) : null;

  if (done) {
    return (
      <div className="k-fade k-center k-player k-player-done">
        <div className="k-eyebrow">{seq.name}</div>
        <h2 className="k-display k-h1 k-mt">Complete</h2>
        <p className="k-sub">Sit for as long as you like.</p>
        <button className="k-btn k-primary k-wide k-mt" onClick={onExit}>Done</button>
      </div>
    );
  }

  const title = step.p ? "Silence" : track ? track.practice : "—";
  /* the meta line under the title: teacher as a pill, then length and
     what kind of recording this is — the same facts the home rows show,
     laid out for a screen you look at from across the room */
  const kind = step.p ? "Silence"
    : track ? (track.variant || (track.kind === "full" ? "Full kriya" : "Guided")) : "";
  const meta = [total ? fmtLong(total) : "", kind].filter(Boolean).join("  ·  ");

  return (
    <div className="k-fade k-player">
      <header className="k-head k-playhead">
        <button className="k-ghost" onClick={onExit}>Close</button>
        <div className="k-eyebrow">{seq.name}</div>
      </header>

      {/* the photo shows through here — the panel below carries everything */}
      <div className="k-stage" aria-hidden="true" />

      <section className="k-panel">
        <h2 className="k-display k-panel-title">{title}</h2>

        <div className="k-metarow">
          {!step.p && track && track.teacher && <span className="k-tag">{track.teacher}</span>}
          {meta && <span className="k-meta">{meta}</span>}
        </div>

        <input
          className="k-progress" type="range" aria-label="Playback progress"
          min={0} max={total || 0} step={0.1}
          value={Math.min(elapsed, total || 0)}
          disabled={!total}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ "--pct": `${pct}%` }}
        />

        <div className="k-timerow k-mono">
          <span>{fmt(elapsed)}</span>
          <span className="k-dim">{left == null ? "" : `-${fmt(left)}`}</span>
        </div>

        {status === "loading" && <p className="k-note">Loading…</p>}
        {status === "blocked" && <p className="k-note k-warn">Tap play to continue.</p>}
        {status === "error" && <p className="k-note k-warn">This recording wouldn’t load. Check the link, or skip ahead.</p>}

        <div className="k-controls">
          <button className="k-circle" onClick={() => skip(-1)} aria-label="Previous">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
          </button>
          <span className={isPlaying ? "k-bigwrap k-bigwrap-playing" : "k-bigwrap"}>
            <button className="k-circle k-big" onClick={toggle} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying
                ? <svg viewBox="0 0 24 24" className="k-glyph" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.2" /><rect x="13.4" y="5" width="3.6" height="14" rx="1.2" /></svg>
                : <svg viewBox="0 0 24 24" className="k-glyph" aria-hidden="true"><path d="M8.5 5.4 18.5 12l-10 6.6z" /></svg>}
            </button>
          </span>
          <button className="k-circle" onClick={() => skip(1)} aria-label="Next">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        {seq.steps.length > 1 && (
          <div className="k-thread k-thread-lg">
            {seq.steps.map((st, i) => (
              <span key={st.k || i}
                className={(st.p ? "k-bead k-bead-sm" : "k-bead") +
                  (i === index ? " k-bead-on" : i < index ? " k-bead-past" : "")} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ styles ---------------------------- */

function Styles() {
  return (
    <style>{`
.k-root, .k-root *, .k-root *::before, .k-root *::after { box-sizing:border-box; }
.k-root {
  --line:#2E3852; --sandal:#EFE6D6; --muted:#8D96AB; --amber:#E9A94A; --sage:#7FB3A6; --slate:#232C40;
  min-height:100vh; min-height:100svh; margin:0 auto; max-width:560px; padding:22px 18px 40px;
  background:radial-gradient(130% 70% at 50% -15%, #1D2436 0%, #0D1018 62%);
  color:var(--sandal); font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
  position:relative; isolation:isolate;
  /* Text sitting straight on the photo needs to carry its own contrast,
     since some of the photos are bright. Two layers: a tight one for
     edge definition, a wide soft one that darkens the area behind the
     glyphs. Cards are opaque, so they opt out below. */
  text-shadow:0 1px 3px rgba(6,8,14,.9), 0 2px 14px rgba(6,8,14,.8);
}
.k-card, .k-teacher-on, .k-primary, .k-big, .k-panel { text-shadow:none; }
/* Gurudev backdrop — a full-screen presence behind the app.
   The photos vary a lot in framing, so anything that crops tight is a
   lottery; full-bleed reads well whichever one comes up. --bg-photo is
   set per load in JSX. */
.k-root::before {
  content:""; position:fixed; inset:0; z-index:-1; pointer-events:none;
  background-image:
    /* a spotlight rather than a flat veil: stays dark along the top and
       bottom edges where loose text sits, opens up across the middle so
       the photo actually reads. Several of the photos have bright
       backgrounds, so the edge bands are what keep text legible. */
    linear-gradient(180deg,
      rgba(13,16,24,.80) 0%,
      rgba(13,16,24,.54) 26%,
      rgba(13,16,24,.48) 55%,
      rgba(13,16,24,.76) 84%,
      rgba(13,16,24,.90) 100%),
    var(--bg-photo, none);
  background-size:cover, cover;
  background-position:center, center 16%;
  background-repeat:no-repeat, no-repeat;
  filter:saturate(.92);
}
/* In the player the photo IS the screen rather than a backdrop, so the
   veil pulls right back: just enough at the top edge to hold the header,
   and nothing much in the middle. The control panel below is opaque, so
   the bottom of the photo needs no help at all. */
.k-root-photo::before {
  background-image:
    linear-gradient(180deg,
      rgba(13,16,24,.60) 0%,
      rgba(13,16,24,.20) 18%,
      rgba(13,16,24,.04) 46%,
      rgba(13,16,24,.20) 80%,
      rgba(13,16,24,.40) 100%),
    var(--bg-photo, none);
  filter:none;
}
.k-display { font-family:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif; }
.k-mono { font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }
.k-eyebrow { font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--muted); }
.k-h1 { font-size:34px; margin:2px 0 0; font-weight:500; }
.k-sub { font-size:13px; color:var(--muted); line-height:1.6; margin:6px 0 0; display:block; }
.k-dim { color:var(--muted); } .k-small { font-size:11px; }
.k-mt { margin-top:24px; } .k-mt-s { margin-top:10px; } .k-center { text-align:center; }
.k-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; }
.k-brand { display:flex; align-items:center; gap:11px; min-width:0; }
/* the logo artwork is dark on a transparent ground, so it needs
   flattening to white to read against this theme */
.k-logo { width:38px; height:auto; flex:none; filter:brightness(0) invert(1); opacity:.9; }
/* smaller than the standalone .k-h1 so logo + title + Recordings still
   fit one line on a ~360px phone */
.k-brand .k-h1 { font-size:25px; line-height:1.15; }
.k-headrow { display:flex; align-items:center; justify-content:space-between; gap:10px; }

.k-teacherbar { border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:12px 0; }
.k-teacherrow { display:flex; gap:8px; overflow-x:auto; margin-top:9px; padding-bottom:2px; }
.k-teacher { flex:none; background:none; border:1px solid var(--line); color:var(--muted);
  border-radius:999px; padding:8px 15px; font-size:13px; cursor:pointer; white-space:nowrap; }
.k-teacher-on { color:#12151F; background:var(--sandal); border-color:var(--sandal); font-weight:600; }

.k-card { background:linear-gradient(180deg,#19212F,#131926); border:1px solid var(--line); border-radius:20px; padding:16px; }
.k-list { display:flex; flex-direction:column; gap:10px; }
.k-row { width:100%; display:flex; align-items:center; justify-content:space-between; gap:14px;
  color:inherit; text-align:left; cursor:pointer; }
.k-rowname { font-size:20px; font-weight:500; display:block; margin-bottom:4px; }
.k-play { width:44px; height:44px; flex:none; border-radius:50%; background:var(--amber); position:relative; }
.k-play::after { content:""; position:absolute; top:50%; left:54%; transform:translate(-50%,-50%);
  border-left:13px solid #10131C; border-top:9px solid transparent; border-bottom:9px solid transparent; }
.k-seqcard { padding:0; overflow:hidden; }
.k-seqmain { width:100%; display:flex; align-items:center; justify-content:space-between; gap:14px;
  background:none; border:0; color:inherit; text-align:left; padding:16px 16px 12px; cursor:pointer; }
.k-edit { width:100%; background:rgba(255,255,255,.03); border:0; border-top:1px solid var(--line);
  color:var(--muted); padding:11px; font-size:12px; letter-spacing:.14em; text-transform:uppercase; cursor:pointer; }
.k-edit-locked { cursor:default; opacity:.55; text-align:center; }

.k-tag { font-size:12px; letter-spacing:.08em; color:var(--sage); background:rgba(127,179,166,.1);
  border:1px solid rgba(127,179,166,.25); border-radius:999px; padding:3px 10px; display:inline-block; }
.k-file { display:block; margin-top:5px; opacity:.6; word-break:break-all; }

.k-thread { display:flex; align-items:center; gap:7px; margin-top:12px; flex-wrap:wrap; }
.k-thread-lg { justify-content:center; gap:10px; margin:22px 0 0; }
.k-bead { width:11px; height:11px; border-radius:50%; background:var(--slate);
  border:1px solid var(--line); flex:none; transition:all .4s ease; }
.k-bead-sm { width:5px; height:5px; background:transparent; border-color:var(--muted); }
.k-bead-past { background:var(--sage); border-color:var(--sage); opacity:.45; }
.k-bead-on { background:var(--amber); border-color:var(--amber); transform:scale(1.45);
  box-shadow:0 0 14px rgba(233,169,74,.55); }

.k-btn { border:1px solid var(--line); background:rgba(255,255,255,.04); color:var(--sandal);
  border-radius:999px; padding:13px 22px; font-size:15px; cursor:pointer; }
.k-btn:disabled { opacity:.4; }
.k-primary { background:var(--amber); border-color:var(--amber); color:#12151F; font-weight:600; }
.k-wide { display:block; width:100%; margin-top:14px; }
.k-ghost { background:none; border:0; color:var(--muted); font-size:13px; letter-spacing:.1em;
  text-transform:uppercase; cursor:pointer; padding:8px 2px; }
.k-danger { background:none; border:0; color:#C97A73; font-size:13px; cursor:pointer; padding:8px 0; }

.k-chiprow { display:flex; flex-wrap:wrap; gap:9px; margin-top:12px; }
.k-chip { background:rgba(255,255,255,.05); border:1px solid var(--line); color:var(--sandal);
  border-radius:999px; padding:11px 16px; font-size:14px; cursor:pointer; }
.k-chip-on { border-color:var(--amber); color:var(--amber); }
.k-chip-sm { padding:9px 14px; font-size:13px; }
.k-chip-alt { border-style:dashed; color:var(--muted); }

.k-nameinput { width:100%; background:none; border:0; border-bottom:1px solid var(--line);
  color:var(--sandal); font-size:26px; padding:8px 0; outline:none; }
.k-nameinput:focus { border-color:var(--amber); }

.k-steps { list-style:none; margin:10px 0 0; padding:0; }
.k-step { display:flex; align-items:center; gap:11px; padding:12px 2px; border-bottom:1px solid rgba(46,56,82,.5); }
.k-steplabel { flex:1; background:none; border:0; color:inherit; text-align:left;
  display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.k-stepname { font-size:17px; }
.k-select { background:rgba(127,179,166,.1); border:1px solid rgba(127,179,166,.25); color:var(--sage);
  border-radius:999px; padding:4px 8px; font-size:12px; outline:none; }
.k-pause { color:var(--muted); font-size:15px; cursor:pointer; }
.k-hint { font-size:10px; letter-spacing:.12em; text-transform:uppercase; opacity:.6; }
.k-stepbtns { display:flex; gap:4px; flex:none; }
.k-icon { width:34px; height:34px; border-radius:10px; border:1px solid var(--line);
  background:rgba(255,255,255,.03); color:var(--muted); font-size:15px; cursor:pointer; }
.k-warn { color:#D9A05B; font-size:13px; }

.k-group { padding:14px 16px; }
.k-groupname { font-size:18px; margin-bottom:6px; }
.k-verrow { display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:9px 0; border-top:1px solid rgba(46,56,82,.5); }
.k-verleft { min-width:0; }
.k-verright { display:flex; align-items:center; gap:12px; flex:none; }

/* ------------------------------- player --------------------------- */
/* The player is a photo with a control panel resting on the bottom of
   it: header floats on the image, the stage is empty on purpose (that
   is the photo), and everything you touch lives in the panel. */
.k-player { display:flex; flex-direction:column; min-height:calc(100vh - 62px);
  min-height:calc(100svh - 62px); }
.k-player-done { min-height:88svh; }
.k-playhead { margin-bottom:0; }
.k-stage { flex:1; min-height:90px; }

.k-panel { text-shadow:none; text-align:center;
  /* bleeds through the root's padding so it sits on the bottom edge */
  margin:18px -18px -40px;
  padding:26px 22px calc(26px + env(safe-area-inset-bottom, 0px));
  border-radius:26px 26px 0 0;
  border:1px solid rgba(255,255,255,.07); border-bottom:0;
  background:linear-gradient(180deg, rgba(15,19,29,.93) 0%, rgba(10,13,20,.97) 100%);
  -webkit-backdrop-filter:blur(22px); backdrop-filter:blur(22px);
  box-shadow:0 -26px 60px rgba(6,8,14,.5); }
.k-panel-title { font-size:38px; font-weight:500; line-height:1.1; margin:0; }
.k-metarow { display:flex; align-items:center; justify-content:center;
  gap:12px; flex-wrap:wrap; margin-top:14px; }
.k-meta { font-size:12.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }

.k-progress { -webkit-appearance:none; appearance:none; display:block;
  width:100%; height:20px; margin:22px auto 0; background:transparent; cursor:pointer; }
.k-progress:disabled { cursor:default; opacity:.4; }
.k-progress::-webkit-slider-runnable-track { height:4px; border-radius:999px;
  background:linear-gradient(to right, var(--amber) var(--pct), rgba(255,255,255,.22) var(--pct)); }
.k-progress::-webkit-slider-thumb { -webkit-appearance:none; appearance:none;
  width:13px; height:13px; margin-top:-4.5px; border-radius:50%; background:#fff;
  box-shadow:0 1px 5px rgba(0,0,0,.5); }
.k-progress::-moz-range-track { height:4px; border-radius:999px; background:rgba(255,255,255,.22); }
.k-progress::-moz-range-progress { height:4px; border-radius:999px; background:var(--amber); }
.k-progress::-moz-range-thumb { width:13px; height:13px; border-radius:50%; border:none;
  background:#fff; box-shadow:0 1px 5px rgba(0,0,0,.5); }
.k-timerow { display:flex; justify-content:space-between; align-items:baseline;
  font-size:15px; margin-top:-2px; }
.k-note { font-size:13px; color:var(--muted); margin:12px 0 0; }
.k-note.k-warn { color:#D9A05B; }

.k-controls { display:flex; align-items:center; justify-content:center; gap:30px; margin-top:20px; }
.k-circle { width:60px; height:60px; border-radius:50%; border:1px solid rgba(255,255,255,.14);
  background:rgba(255,255,255,.05); color:var(--sandal); cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; padding:0; }
.k-circle svg { width:24px; height:24px; fill:none; stroke:currentColor;
  stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
.k-big { width:88px; height:88px; background:var(--amber); border-color:var(--amber); color:#12151F;
  box-shadow:0 10px 30px rgba(233,169,74,.28); }
.k-big .k-glyph { width:30px; height:30px; fill:currentColor; stroke:none; }
.k-bigwrap { position:relative; display:inline-flex; }
/* a fixed hairline ring, plus the two expanding rings while playing */
.k-bigwrap::before { content:""; position:absolute; inset:-7px; border-radius:50%;
  border:2px solid rgba(233,169,74,.5); pointer-events:none; }
.k-bigwrap-playing::after {
  content:""; position:absolute; inset:0; border-radius:50%; border:2px solid var(--amber);
  animation:kplaypulse 2.2s ease-out infinite; pointer-events:none;
}
@keyframes kplaypulse {
  0% { transform:scale(1); opacity:.65; }
  100% { transform:scale(1.6); opacity:0; }
}

/* ------------------------ gate and people ------------------------- */
.k-gate { display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; min-height:80vh; min-height:80svh; }
.k-gate-logo { width:54px; margin-bottom:18px; opacity:1; }
.k-gate-title { font-size:32px; margin-bottom:4px; }
.k-gate-sub { max-width:34ch; margin-top:14px; }
.k-gate-btn { max-width:260px; }
.k-gsi { margin-top:26px; min-height:44px; display:flex; justify-content:center; }
.k-headbtns { display:flex; align-items:center; gap:6px; flex:none; }
.k-signedin { display:flex; align-items:center; justify-content:space-between; gap:10px;
  margin-top:14px; padding-top:12px; border-top:1px solid var(--line); }
.k-userhead { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.k-userwho { min-width:0; }
.k-username { font-size:19px; display:block; }
.k-saving { opacity:.55; }

.k-waiting-count { color:var(--amber); }
.k-mailtest { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:10px;
  padding-top:10px; border-top:1px solid var(--line); }
.k-card-pending { border-color:rgba(233,169,74,.55); box-shadow:0 0 0 1px rgba(233,169,74,.18); }
.k-request { margin-top:12px; padding:11px 13px; border-radius:12px;
  background:rgba(233,169,74,.08); border:1px solid rgba(233,169,74,.22); }
.k-request-courses { font-size:16px; margin-top:3px; }
.k-request-note { font-size:14px; color:var(--sandal); opacity:.85; margin:7px 0; font-style:italic; }
.k-approvebar { display:flex; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap; }
.k-gate-chips { justify-content:center; margin-top:22px; }
.k-note-input { width:100%; max-width:340px; margin-top:14px; resize:vertical;
  background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:14px;
  color:var(--sandal); font:inherit; font-size:14px; padding:11px 13px; outline:none; }
.k-note-input:focus { border-color:var(--amber); }
.k-note-input::placeholder { color:var(--muted); }

.k-toast { position:fixed; left:50%; bottom:26px; transform:translateX(-50%);
  background:#20293B; border:1px solid var(--line); color:var(--sandal);
  padding:12px 20px; border-radius:999px; font-size:14px; z-index:50; }
.k-foot { font-size:11px; color:var(--muted); line-height:1.7; margin-top:30px; }

.k-fade { animation:kfade .5s ease both; }
@keyframes kfade { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:none;} }
button:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid var(--amber); outline-offset:3px; }
@media (prefers-reduced-motion: reduce) {
  .k-fade { animation:none; }
  .k-bead { transition:none; }
  .k-bigwrap-playing::after { animation:none; content:none; }
}
/* short viewports (landscape phones, small windows) — compact the panel
   so its controls and spacing don't force a scrollbar */
@media (max-height: 700px) {
  .k-head { margin-bottom:12px; }
  .k-stage { min-height:40px; }
  .k-panel { margin-top:10px; padding-top:18px; }
  .k-panel-title { font-size:29px; }
  .k-metarow { margin-top:10px; }
  .k-progress { margin-top:12px; }
  .k-thread-lg { margin:14px 0 0; gap:8px; }
  .k-controls { gap:22px; margin-top:14px; }
  .k-circle { width:52px; height:52px; }
  .k-big { width:72px; height:72px; }
  .k-big .k-glyph { width:26px; height:26px; }
}
`}</style>
  );
}
