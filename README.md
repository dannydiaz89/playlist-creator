# Classroom Playlist Creator

Students search a real music catalog and suggest songs for their class. The
teacher reviews every track with an advisory explicit-content pre-check, then
syncs the approved ones straight into a **Spotify** or **YouTube Music**
playlist.

It replaces a Google Form → CSV export → sync script workflow with one app.

Built with **Next.js 15** (App Router), **Convex**, **Better Auth**, and
**Tailwind**. Design rationale lives in
[`docs/implementation_plan.md`](docs/implementation_plan.md); the original
clickable mockups are in [`docs/`](docs/).

---

## Status

**Working end to end on Spotify** — tested against a real account:

- **Teacher accounts** — email + password, invite-code gated sign-up.
- **Class surveys** — join codes, per-class playlist choices, teacher-written
  questions (per song or per submission), open/close, edit, delete.
- **Student survey** — no login. Search Spotify's catalog, pick real tracks,
  answer the teacher's questions. A "can't find it" manual request is allowed
  (capped at 2).
- **Review** — advisory pre-checks (label explicit tag + title keywords),
  approve/deny with an audit trail, "Denied before" warnings, and **Find match**
  to point an unresolved track at the right recording.
- **Sync** — one class-wide sync that previews exactly what will be written,
  de-duplicates tracks several students picked, and skips anything already
  in the playlist.
- **Playlists tab** — choose which playlists students can pick, create new
  ones, browse and remove songs.

**Not yet exercised against a real account:** the **YouTube Music** path. It is
implemented and unit-tested, but no Google credentials have been connected yet.

---

## Run it locally

### Prerequisites

- **Node.js 20+** and **pnpm** (`npm install -g pnpm`)
- A free **[Convex](https://convex.dev)** account
- A **Spotify** account (and optionally a Google account for YouTube Music)

### 1. Install

```bash
git clone https://github.com/dannydiaz89/playlist-creator.git
cd playlist-creator
pnpm install
cp .env.local.example .env.local
```

### 2. Start Convex

```bash
pnpm dev:convex
```

The first run asks you to log in and create a project, then writes
`CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`. **Leave it
running** — it deploys your backend functions and regenerates
`convex/_generated/` on every change.

Add one value it does not write for you — the same URL with `.convex.cloud`
swapped for `.convex.site`:

```
NEXT_PUBLIC_CONVEX_SITE_URL=https://<your-deployment>.convex.site
```

### 3. Create a Spotify app

At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
→ **Create app**:

| Field | Value |
|---|---|
| Redirect URI | `http://127.0.0.1:3000/api/auth/callback/spotify` |
| APIs used | Web API |

Then under **User Management**, **add your own Spotify account**. New apps are
in Development Mode — max 25 users, each added by email — and sign-in silently
fails for anyone not on that list.

> **Use `127.0.0.1`, not `localhost`.** Spotify rejects `localhost` as a
> redirect URI. Open the app at `http://127.0.0.1:3000` too, so the sign-in
> starts and finishes on the same address.

### 4. Set environment variables — in two places

This is the step that trips people up. The app runs in **two runtimes**:

| Runtime | Set with | Reads |
|---|---|---|
| **Convex** (where Better Auth runs) | `npx convex env set NAME value` | everything under `convex/` |
| **Next.js** | `.env.local` | everything under `src/` |

Generate a secret and an invite code:

```bash
openssl rand -base64 32
```

```bash
openssl rand -hex 8
```

Set them on **Convex** (run each with your values):

```bash
npx convex env set BETTER_AUTH_SECRET '<secret>'
npx convex env set BETTER_AUTH_URL http://127.0.0.1:3000
npx convex env set TEACHER_INVITE_CODE '<invite code>'
npx convex env set SPOTIFY_CLIENT_ID '<spotify client id>'
npx convex env set SPOTIFY_CLIENT_SECRET '<spotify client secret>'
```

And put the **same values** in `.env.local` — the student search and the seed
script read them from there:

```
BETTER_AUTH_SECRET=<secret>
TEACHER_INVITE_CODE=<invite code>
SPOTIFY_CLIENT_ID=<spotify client id>
SPOTIFY_CLIENT_SECRET=<spotify client secret>
```

> If Better Auth can't see these you'll get *"You are using the default
> secret"* or Spotify's *"client_id: Invalid"*. Both mean the value is missing
> from the **Convex** side. Restart `pnpm dev:convex` after changing them.

### 5. Start the app

In a second terminal:

```bash
pnpm dev
```

Open **http://127.0.0.1:3000**.

### 6. Create your teacher account

The app has to be running for this — the script signs up through it. Add an
email and a temporary password to `.env.local`:

```
SEED_TEACHER_EMAIL=you@example.com
SEED_TEACHER_PASSWORD=pick-a-temporary-password
```

then, in a third terminal:

```bash
pnpm seed
```

Sign-up is gated on `TEACHER_INVITE_CODE`, so nobody else can create an
account on your deployment. Once you're in, close the door:

```bash
npx convex env remove TEACHER_INVITE_CODE
```

### 7. Try it

1. Sign in → **Settings** → connect Spotify.
2. **Playlists** → create a playlist and tick it as available to students.
3. **Surveys** → New survey → copy the student link.
4. Open that link in a private window, search a song, submit.
5. Back as the teacher: review it, approve it, and sync from the survey page.

---

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm dev:convex` | Convex backend + codegen (keep running alongside) |
| `pnpm seed` | Create a teacher account |
| `pnpm test` | Unit tests (`SKIP_LIVE=1` skips the ones that call the real catalog) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Production build — **stop `pnpm dev` first**, they share `.next/` |

Remove a teacher account (for example a test one):

```bash
npx convex run admin:deleteTeacher '{"email":"someone@example.com"}'
```

---

## Optional: YouTube Music

In [Google Cloud Console](https://console.cloud.google.com): enable the
**YouTube Data API v3**, create an OAuth client (Web application) with redirect
URI `http://127.0.0.1:3000/api/auth/callback/google`, and add yourself as a
test user while the consent screen is in Testing. Then:

```bash
npx convex env set GOOGLE_CLIENT_ID '<client id>'
npx convex env set GOOGLE_CLIENT_SECRET '<client secret>'
```

YouTube's API is capped at roughly **10,000 units a day**, and its search is
expensive — see [YouTube quota](#youtube-quota) below.

---

## Using the app

### Dashboard tabs

| Tab | Holds |
|---|---|
| **Surveys** | Class surveys, their responses, and the class-wide sync |
| **Playlists** | Which provider playlists students can pick; create, browse, remove songs |
| **Settings** | The provider account connection |

The header and tabs stay put when you open a survey or a single response.

Only playlists you **own** are listed — Spotify won't let an app read or add
to playlists you merely follow.

### Connecting a provider

Use **Connect** on the Settings tab while signed in. It calls `linkSocial`,
which attaches the provider to the account you are already signed into.

> Not `signIn.social`. That treats the flow as a *fresh sign-in as the provider
> identity*: when the provider's email matches an existing user it fails with
> `account_not_linked` **and drops the teacher's session**, so you get bounced to
> the home page logged out.

Common callback errors, all surfaced in-app:

| Code | Meaning |
|---|---|
| `client_id: Invalid` | Provider credentials not set on the **Convex** deployment |
| `state_mismatch` | A stale attempt was still open, or the consent page idled past the 5-minute state cookie |
| `please_restart_the_process` | The state cookie was missing — start and finish on the same host (`127.0.0.1:3000`) |
| `account_not_linked` | The link was attempted as a sign-in; use Connect from Settings |

---

## How it works

### The catalog follows the provider

**Spotify class → students search Spotify.** Anything they pick provably exists
there, arrives with its exact `spotify:track:…` URI, and syncs with **zero**
lookups. Uses client credentials — an app-level token, so students never sign in
and the teacher's token is never spent on student searches.

**YouTube class, or Spotify unavailable → students search Deezer**, and sync
resolves by ISRC. YouTube cannot be searched by students at all: `search.list`
costs **100 quota units** per call, so a class would exhaust the 10,000/day
budget in minutes.

> **Why not Deezer everywhere?** The two catalogs assign *different ISRCs to the
> same recording*, and Deezer carries tracks Spotify does not. Verified live: a
> Sublime track picked from Deezer (`USGA19647697`) returned **zero** Spotify
> results by ISRC *and* by text. Searching the destination platform removes that
> entire class of failure.

### Deezer as the fallback catalog

Students search [Deezer's public API](https://api.deezer.com) — no key, no OAuth,
no secret — and pick a real track. That yields a canonical title, artist, the
label's `explicit_lyrics` flag, and an **ISRC**, which is the key that resolves
to *either* provider at sync time.

This matters more than it looks: **YouTube exposes no explicit-content flag at
all**, so on a YouTube-only setup Deezer is the only screening signal in the
system. Keeping the catalog provider-independent is what makes both providers
equally usable.

> The iTunes Search API is **not** usable here. Since Sept 2025 it silently
> filters out explicit tracks — query `rockstar post malone` and it reports
> `trackExplicitness: "cleaned"` because the explicit original is hidden. The app
> would mark it clean and then sync the explicit version. `catalog.live.test.ts`
> guards against Deezer ever behaving the same way.

### Authorization is in Convex, not the middleware

The Convex deployment URL is public and callable from any browser console.
Every function therefore checks identity itself (`convex/lib/auth.ts`):

- **Tier 1 (teacher)** — `requireTeacher` + `requireOwnedSurvey`. Authentication
  alone is not authorization: without the ownership check any signed-in teacher
  could moderate another teacher's class.
- **Tier 2 (student, anonymous)** — `surveys.getByCode` returns a narrow
  projection only; `submissions.submit` enforces `isActive`, song caps and rate
  limits *in the mutation*.

`src/middleware.ts` is defence in depth for page navigations only.

### Sync is per survey, not per submission

The Sync panel lives on the survey's responses page and writes **every approved
track in the class at once**, grouped by the playlist each student chose.

Dedupe only works when the whole set is considered together: twelve students
picking the same song is **one** add. Syncing submission by submission — the
earlier design — deduped only *within* a submission, so the same track picked by
different students was added once per student.

The panel previews the exact plan before writing anything, grouped by
destination playlist, built from the **same key the sync engine uses** so the
list is the plan rather than an estimate of it. Two badges matter:

- **N students** — this track was picked more than once and will be added once.
- **Find match** — no exact provider URI, so sync has to guess and may fail.
  It is a **button**: search the provider (or paste a track link) and pick the
  right recording. Once matched it syncs exactly, and the badge becomes
  **Matched**.

Resolving a track sets `providerTrackId` but deliberately leaves the student's
`title`/`artist` untouched — the record shows what they asked for and what the
teacher matched it to, not a rewrite. `providerTrackTitle`, `resolvedBy` and
`resolvedAt` capture the match.

A link can be pasted for either provider. On YouTube that is the better path
anyway: a search there costs 100 of the 10,000 daily API units.

### A song that was denied before

Resubmission is allowed — nothing blocks a student from picking a track another
student already had rejected. But the teacher is told, because otherwise a
denied track reappears looking completely fresh ("No flags, needs review") and
approving it silently reverses the earlier call. That is sharpest right after a
playlist removal: remove a song, another student submits it, it goes straight
back in.

- The review row shows **Denied before (N×)** with the reason previously given.
- **Approve all verified-clean skips it**, reporting how many it passed over.
  Sweeping a deliberately-denied track back in is exactly what that button must
  not do.

Matching is on the provider track id **or** the ISRC, since the same recording
arrives under either depending on which catalog the student searched. Advisory
only — the teacher can still approve it.

### Removing a song from a playlist

Removal has to be **sticky** — clearing `isSynced` alone would let the next sync
silently put the track back and undo the teacher's action. But leaving
`isSynced: true` to achieve that makes the flag lie, since the track really is
gone.

So removal is recorded honestly on both axes:

| Field | After removal | Means |
|---|---|---|
| `isSynced` | `false` | it is genuinely not in the playlist |
| `decision` | `denied` | *this* is what keeps it out of future syncs |
| `denialReason` | "Removed from the playlist" | why |

**There is a way back**: re-approve the track on that student's response and the
next sync adds it again. Scoped to surveys that actually target the playlist, so
removing from one class cannot reach into another. Removing a track no student
submitted denies nothing — that is normal.

### Fail closed, never open

- A manual "can't find it" request has no explicit flag, so the *absence* of one
  means nothing. It gets `status: "unverified"` and `bulkApproveClean` skips it.
- If the catalog is unreachable the survey shows an error — it never falls back
  to accepting free text.
- On YouTube quota exhaustion, sync stops, marks exactly what was written, and
  reports `"5 of 12 synced, retry tomorrow"`. It never reports success on a
  partial sync.

### YouTube quota

`search.list` costs 100 units and `playlistItems.insert` 50, against 10,000/day
— naively ~66 songs/day, which one class of 30 can exceed. Three mitigations
keep it comfortable:

1. only **approved** tracks are resolved;
2. **dedupe by ISRC** — twelve students picking one song is one lookup;
3. the deployment-wide **`trackResolutions` cache** — a hit costs 0 search units.

A realistic class lands around 3,750 units. Without dedupe and caching the same
day fails outright.

---

## Spotify API notes

The **February 2026 Web API migration** retired three endpoints this app used.
All now return **403 Forbidden** with correct scopes:

| Purpose | Retired | Replacement |
|---|---|---|
| Create playlist | `POST /users/{id}/playlists` | `POST /me/playlists` |
| Add tracks | `POST /playlists/{id}/tracks` | `POST /playlists/{id}/items` |
| Read playlist tracks | `GET /playlists/{id}/tracks` | `GET /playlists/{id}/items` |
| Remove tracks | `DELETE …/tracks` with `{tracks:[{uri}]}` | `DELETE …/items` with **`{items:[{uri}]}`** |

Response shapes moved with them: playlist items are under `item` (was `track`),
and track counts under `items.total` (was `tracks.total`).
- **Track counts come from `items.total`**, not the older `tracks.total`, which
  `/me/playlists` no longer returns.
- **Server-to-server calls to Better Auth must send an `Origin` header.**
  Without it every request is rejected as CSRF (`MISSING_OR_NULL_ORIGIN`), which
  surfaces as a misleading "not connected".

## Gotchas

- **Do not run `pnpm build` while `pnpm dev` is running.** They share `.next`;
  the collision corrupts it and the dev server starts throwing `ENOENT` on
  compiled routes. Fix: stop dev, `rm -rf .next`, restart.
- **`expectAuth: true` must stay OFF on the Convex client.** It holds every
  query until authentication resolves; students are anonymous by design, so the
  survey page would load forever. Teacher-side queries pass `'skip'` until
  `useConvexAuth()` reports authenticated instead.

## Known limitations

- **YouTube matching is fuzzy.** There is no ISRC lookup, so it is text search
  plus a duration check. The UI says so before you sync; check the playlist after.
- **Screening is metadata only.** Title, artist, and the label's explicit tag.
  **Lyrics are not scanned.** It is advisory input to a human, never a filter.
- **Provider switch clears playlist links.** A `providerPlaylistId` is only valid
  for the account that issued it.
- The catalog search rate limiter is in-memory — fine for one instance, needs a
  shared store if ever scaled out.
