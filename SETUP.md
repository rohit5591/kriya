# Putting the recordings behind a sign-in

The app runs two ways from the same source.

| | `npm run build` | `npm run build:cf` |
|---|---|---|
| Where | GitHub Pages, `/kriya/` | Cloudflare Worker, `/` |
| Audio | `public/audio`, public to anyone | private R2 bucket, through `/api/audio` |
| Who can listen | anyone with the link | signed in, and only what they were granted |

Nothing below touches the GitHub Pages build. It keeps working exactly as
it does today until you decide to retire it — see the last section.

## The four courses

| Course | Opens up |
|---|---|
| **Part 1** | Kriya, OM, Bhastrika, 3 Stage, Padmasadhana, Regular Kriya, Fast Kriya |
| **Part 2 (Advanced)** | everything in Part 1, plus Mudra Pranayam |
| **Sahaj Samadhi** | everything in Part 1, plus the three Sahaj recordings |
| **Sanyam 2** | everything, plus Bhogar, Sanyam 2 Bells, Samaveda, the four Sanyam 2 kriyas |

Part 2 and Sahaj are branches off Part 1, not rungs of a ladder — someone
can have either, both, or neither. Sanyam 2 sits on top of all of it. If
that mapping is ever wrong, it lives in one place: `shared/catalog.js`.

## 1. A Google sign-in client

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → OAuth consent screen** → External. Add the two or
   three people as **test users**, or hit Publish — in testing mode only
   listed addresses can sign in, which is its own kind of gate.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorised JavaScript origins:
   - `https://kriya.<your-subdomain>.workers.dev` (fill in after step 2 below if you do not know it yet)
   - `http://localhost:5173` and `http://127.0.0.1:8787` for local work
4. Copy the **Client ID** into `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID`.

There is no client *secret* here and no redirect URL: the browser gets an
ID token, the Worker verifies its signature against Google's public keys,
and issues its own cookie.

## 2. Cloudflare

```sh
npx wrangler login

npx wrangler r2 bucket create kriya-audio
npx wrangler kv namespace create ACCESS      # copy the id it prints
```

Then in `wrangler.jsonc`:

- `kv_namespaces[0].id` → the id from the command above
- `vars.ADMIN_EMAILS` → your own Google address (comma-separated for more).
  These addresses are admin on sight and get every course, which is what
  stops a fresh deployment locking you out of your own people list.

And the session signing key, which must not live in the repo:

```sh
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
npx wrangler secret put SESSION_SECRET      # paste it in
```

Changing `SESSION_SECRET` later signs everyone out. That is the panic button.

## 3. The recordings

```sh
npm run upload-media
```

364MB over 20 files, so it takes a while. Keys are slugged from the
filenames (`OM - Dinesh.mp3` → `audio/om-dinesh.mp3`) because spaces do
not survive the trip into R2. Re-running is safe — every object is
overwritten — so if it dies partway, just run it again.

## 4. Deploy

```sh
npm run deploy          # build:cf, then wrangler deploy
```

Sign in as yourself first. You will land straight in with everything,
because your address is in `ADMIN_EMAILS`. Anyone else who signs in gets
a *waiting* screen and appears in **People** for you to tick courses
against. Grants take effect on their next page load.

## 5. Letting people in

Someone who signs in with nothing granted is asked which courses they have
done, plus an optional note, and that request goes into their record and
to the top of your **People** screen.

What they tick is a **claim, not a grant**. The chips on their card start
at what they asked for; change any of them before hitting Approve and
that is what they get — higher or lower. Decline closes the request and
grants nothing. Either way the request is answered and disappears from
the waiting count.

### Getting an email when someone asks

Optional. Without it the request is still recorded and still waits in
People — you just have to go and look.

1. Sign up at [resend.com](https://resend.com) with the same address as
   `ADMIN_EMAILS` and create an API key.
2. Store it (paste at the prompt — it never has to be written down):

```sh
npx wrangler secret put RESEND_API_KEY
```

The default sender is `onboarding@resend.dev`, which Resend allows
without a verified domain but only to the address that owns the account —
which is exactly where these go. If you ever want a different sender, add
a verified domain in Resend and set `vars.EMAIL_FROM` in `wrangler.jsonc`.

A dead or missing mail provider never fails a request: the submission is
saved first and the email is best-effort after it.

## Working on it locally

```sh
cp .dev.vars.example .dev.vars   # a throwaway SESSION_SECRET
npm run build:cf
npx wrangler dev                 # app + api on http://127.0.0.1:8787
```

`.dev.vars` overrides the matching entry in `wrangler.jsonc` `vars`, and
wrangler only re-reads it when it restarts — so after editing either
file, check the binding table it prints. A value shown as `(hidden)` came
from `.dev.vars`; one shown in full came from `wrangler.jsonc`. That
distinction is worth knowing: a stale `.dev.vars` silently shadowing your
real `ADMIN_EMAILS` looks exactly like a broken sign-in.

For hot reload, run `npm run dev:worker` and `npm run dev:cf` together:
Vite serves the app on 5173 and proxies `/api` to the Worker.

To seed a few recordings into the local bucket: `npm run upload-media -- --local`.

## What this does and does not protect

The Worker checks the session and the grants on **every** audio request,
and answers 404 rather than 403 for a recording someone has not been
taught — they learn nothing about what exists. The bucket has no public
URL; nothing but the Worker can read it.

What it cannot stop is someone who *has* been granted a recording saving
the file. That is unavoidable for anything playable.

## Closing the public copy

Until you do this, every recording is still downloadable from the GitHub
Pages site and from the repo, and the gate is decorative:

1. Turn off the Pages deployment (delete `.github/workflows/deploy.yml`,
   and the site in the repo's Settings → Pages).
2. `git rm -r --cached public/audio` and move the folder to `media/`
   (already gitignored). `npm run upload-media` reads from either place.
3. **Make the repo private.** Free GitHub Pages needs a public repo,
   so this only becomes possible once step 1 is done.
4. The files stay in git history even after step 2. If that matters,
   rewrite it with [git-filter-repo](https://github.com/newren/git-filter-repo)
   and force-push — destructive, and it breaks every existing clone, so
   it is worth a deliberate decision rather than a reflex.
