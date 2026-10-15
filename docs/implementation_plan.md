# Implementation Plan: Classroom Playlist Curator (Next.js + Convex)

Build a full-stack, real-time classroom music curation web application using **Next.js (App Router)** and **Convex**. Teachers sign in with **Better Auth** (email + password) and link a **Spotify** account via OAuth; Better Auth persists and refreshes the provider tokens. Teachers generate class-specific survey codes (e.g. `P4-BEATS`) and collect student song suggestions from anonymous students. An automated background engine pre-screens songs for explicit metadata and restricted keywords, presenting an advisory report to the teacher, who retains final discretion to approve, deny, or override false alarms before pushing tracks into live playlists.

---

## User Review Required

> [!IMPORTANT]
> **Decision (superseded): Zero-Credential Server Architecture is dropped.** The original design stored Spotify/YouTube tokens exclusively in ephemeral browser cookies with no server-side credentials. This was abandoned for three reasons:
> 1. It was already violated — `/api/sync` reads the token server-side on every request, so the server was in the token path regardless.
> 2. It made the background screening action **impossible**: a Convex action cannot read a browser cookie, and at student-submit time no teacher session exists.
> 3. Browser-side PKCE token exchange and `HttpOnly` cookies are mutually exclusive — JavaScript cannot set an `HttpOnly` cookie.
>
> **Replacement:** Better Auth owns both teacher login and the Spotify connection. `SPOTIFY_CLIENT_SECRET` lives on the server; access and refresh tokens are persisted by Better Auth and refreshed via `getAccessToken`. The teacher stays connected across sessions instead of re-authenticating every hour.

> [!IMPORTANT]
> **Students are never authenticated.** Student accounts are explicitly out of scope. The class code is a public bearer capability (it is written on a whiteboard). Authorization is therefore **two-tier** — see Phase 2.

> [!NOTE]
> **Convex Account / Deployment**: Running Convex locally uses the lightweight local development instance (`pnpm convex dev`), which requires zero cloud infrastructure setup during initial development.

> [!WARNING]
> **Spotify redirect URI**: Spotify no longer accepts `localhost` as a redirect URI. Use `http://127.0.0.1:3000` in development and register it in the Spotify dashboard.

> [!WARNING]
> **Spotify Development Mode quota**: A new Spotify app allows a maximum of 25 users, each added manually by email in the developer dashboard. The teacher's own Spotify account must be added to the allowlist or OAuth will fail for them. Distributing this to other teachers requires Extended Quota Mode review.

---

## Proposed System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                              NEXT.JS APP                               │
│                                                                        │
│   • / (Homepage): Student Code Gate + Teacher Sign-In                  │
│   • /survey?code=XXX: Student Multi-Track Form (anonymous, 1-10 songs) │
│   • /teacher: Dashboard (Spotify Connect, Class Codes, Live Subs)      │
│   • /teacher/review/[id]: Song Moderation & Platform Sync              │
│   • /api/auth/[...all]: Better Auth handler (login + Spotify OAuth)    │
│   • middleware.ts: Server-side route guard on /teacher/*               │
└──────────────────┬─────────────────────────────────────────────────────┘
                   │  JWT identity flows into every Convex call
                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            CONVEX BACKEND                              │
│                                                                        │
│  @convex-dev/better-auth component                                     │
│   • Owns user / session / account tables                               │
│   • Persists Spotify access + refresh tokens                           │
│   • Makes ctx.auth.getUserIdentity() available in every fn             │
│                                                                        │
│  Application tables: surveys, submissions, songs                       │
│                                                                        │
│  TIER 1 (teacher, authenticated + ownership-checked):                  │
│   surveys.list / create / toggleStatus, submissions.listBySurvey,      │
│   songs.updateDecision, songs.bulkApproveClean, sync                   │
│                                                                        │
│  TIER 2 (student, anonymous, code-scoped):                             │
│   surveys.getByCode  -> narrow projection only                         │
│   submissions.submit -> rate-limited, isActive enforced in mutation    │
│                                                                        │
│  Actions: catalog search + advisory screening (uses stored token)      │
└────────────────────────────────────────────────────────────────────────┘
```

> [!CAUTION]
> **The Convex deployment URL is public.** Any student can open devtools and call Convex functions directly. Authorization therefore **must** live inside the Convex function handlers. A check in a Next.js route handler or React component is decorative — it protects nothing.

---

## Provider-Neutral Catalog (Deezer)

> [!IMPORTANT]
> **Students do not type free text.** They search a real catalog and pick a real track. This was the single highest-leverage change to the design — it removes the disambiguation problem, removes the need for a background screening action, and works before the teacher has connected any provider.

The teacher may end up on Spotify **or** YouTube, so the catalog cannot be either one. It is [Deezer's public API](https://api.deezer.com) — no API key, no OAuth, no client secret, no user account.

```
GET https://api.deezer.com/search?q=rockstar%20post%20malone&limit=8
  → title, artist, album, duration, cover art, and explicit_lyrics (boolean)

GET https://api.deezer.com/track/{id}
  → isrc  ← the cross-provider join key
```

**Verified behaviour** (queried live while writing this plan):

| Query | Result |
|-------|--------|
| `rockstar post malone` | `explicit_lyrics: true`, `isrc: USUM71710087` |
| `here comes the sun beatles` | `explicit_lyrics: false` |
| `artist:"Post Malone" track:"rockstar"` | 2 results, **both explicit — no clean version exists** |

### When the song isn't in the catalog

Deezer's catalog is broad and its fuzzy matching is forgiving (`"sunflwer post malon"` resolves to Sunflower), but it misses three real categories: **lyric-based searches** ("that song that goes ooh na na" — there is no lyric search), **non-commercial recordings** (a school band, a friend's SoundCloud), and **unreleased or YouTube-only content**. The last matters most when the teacher is on YouTube, whose catalog is far broader than Deezer's.

A student who cannot find their song must not be stuck. There are therefore **three** outcomes from a song row, not two:

| Outcome | `source` | Has ISRC | Screening | Teacher path |
|---------|----------|----------|-----------|--------------|
| Picked from catalog | `catalog` | yes | `clean` or `flagged` | Normal review |
| **Not found → manual request** | `manual` | **no** | **`unverified`** | Must resolve by hand |
| Catalog unreachable | — | — | — | Row cannot be completed; see fail-closed rule |

#### The manual-request escape hatch

After a search returns nothing, the row offers **"Can't find it? Request it manually"**, which collects free-text title and artist and stores the row with `source: "manual"`.

> [!CAUTION]
> **`unverified` must never be treated as clean.** A manual row has no label explicit flag, so the *absence* of a flag carries no information. Screening therefore assigns `status: "unverified"`, and:
> - `bulkApproveClean` **must skip it** — it only ever approves `status === "clean"`.
> - The review UI must render it visually distinct from a verified clean track.
> - Sync cannot auto-resolve it: with no ISRC there is nothing to match on, so the teacher picks the track in their own provider before it can sync.
>
> Defaulting an unscreened row to clean is the same fail-open mistake as the iTunes explicit bug, just arriving through the front door.

#### Keeping it from becoming the bypass

If "can't find it" is the path of least resistance, students learn that typing gibberish submits anything unscreened. The escape hatch must therefore carry **more** friction than picking from the catalog, not less:

- **Capped at 2 manual rows per submission** (`MAX_MANUAL`). A submission of ten hand-typed songs is not a catalog gap, it is an evasion.
- **The student note becomes required** when any manual row is present, same rule as a flagged track.
- The UI states plainly that manual requests need the teacher to find the track by hand — so picking from search is visibly the faster route.
- Rate limiting applies to the whole submission regardless.

#### Schema impact

- `songs.source`: **[NEW]** `"catalog"` | `"manual"`.
- `isrc`, `deezerId`, `durationSec`, `artworkUrl` become **optional** — null for manual rows.
- `preScreen.status` gains **`"unverified"`**.
- `submissions.submit` validation changes: a song row must carry *either* a catalog `deezerId` + `isrc`, *or* `source: "manual"` with non-empty title and artist. Reject anything else, and reject more than `MAX_MANUAL` manual rows.

### Why not the iTunes Search API

> [!CAUTION]
> **Do not use the iTunes Search API for this.** Since late September 2025 it has silently stopped returning explicit tracks — still broken as of April 2026, with no Apple response. Querying `rockstar post malone` returns `trackExplicitness: "cleaned"` because the explicit original is filtered out of results entirely. The app would report the track as clean, and then sync the explicit version from Spotify. A screening signal that fails *open* is worse than no screening at all.

### Resolution at sync time

The stored ISRC resolves to whichever provider the teacher connected:

| Provider | Resolution |
|----------|-----------|
| Spotify | `GET /v1/search?q=isrc:{ISRC}&type=track&market={market}` — ISRC must be **uppercase with no dashes**, and results are market-specific, so always pass `market` |
| YouTube | No ISRC support. Falls back to `search.list` on `"{artist} {title}"`, then a duration sanity-check against the Deezer duration |

> [!NOTE]
> Deezer's public catalog endpoints are documented and unauthenticated, but they are a third party's terms of service. Fine for a single classroom; revisit before any wider distribution.

### What this deletes from the original design

- **The background screening action is gone.** `explicit_lyrics` arrives with the search result, so screening is synchronous and instant at pick time. There is no longer a "Convex action needs a Spotify token at student-submit time" problem — the problem was an artifact of accepting free text.
- **Title/artist disambiguation is gone.** The student already picked the exact recording.
- **The Spotify client secret is now needed only for playlist writes**, not for screening. The Better Auth decision still holds — teacher login and sync tokens both need it — but its blast radius is smaller than when we made that call.

### What still needs the keyword lexicon

`explicit_lyrics` is a label-supplied profanity flag. It does not catch themes — `Pumped Up Kicks` is `explicit_lyrics: false`. The school-safety keyword lexicon still runs over the **title and artist** as a second, advisory signal. It still does not read lyrics.

---

## Provider Parity: Spotify and YouTube Music

> [!IMPORTANT]
> **Neither provider is primary.** The teacher picks at setup and may switch later, so both paths are first-class. An earlier draft treated YouTube as a caveat-laden fallback to Spotify; that is corrected here. The app must be equally usable if the teacher moves from one to the other — which is also why **listing the teacher's existing playlists is required on both**, not just a Spotify convenience.

### What actually differs

Everything student-facing is identical, because the catalog is Deezer and is provider-independent. Only the sync leg differs:

| | Spotify | YouTube |
|---|---|---|
| Explicit flag from provider | yes (`explicit`) | **none** |
| Lookup by ISRC | yes — `search?q=isrc:{ISRC}&type=track` | **no** — text search + duration check |
| Listing teacher playlists | `GET /v1/me/playlists` | `GET /youtube/v3/playlists?mine=true` |
| Creating a playlist | `POST /v1/users/{id}/playlists` | `POST /youtube/v3/playlists` |
| Adding tracks | `POST /v1/playlists/{id}/tracks` | `POST /youtube/v3/playlistItems` (one call **per track**) |
| Rate model | request rate limit | **hard daily quota** |

> [!NOTE]
> **This is why the catalog is Deezer and not the provider.** YouTube exposes no explicit-content flag at all, so on a YouTube-only setup Deezer is not a second opinion — it is the *only* screening signal in the system. Screening stays identical across providers precisely because it never touches them.

### Playlist listing and linking

Both providers must support: list the teacher's playlists, create a new one, and **read back the created playlist** (id, name, url, track count) so `allowedPlaylists[].providerPlaylistId` can be linked immediately. A teacher who switches providers re-links targets against the new account's playlists; the survey's playlist *labels* are unchanged, so student-facing config survives the switch.

> [!CAUTION]
> `providerPlaylistId` is only valid for the account that issued it. On provider switch or account change, **clear every `providerPlaylistId`** and force re-linking. A stale id from the other provider will either 404 or, worse, resolve to an unrelated playlist.

---

### YouTube quota: the binding constraint

YouTube Data API v3 costs, against a default **10,000 units/day** per project:

| Call | Units |
|---|---|
| `search.list` (resolve a track to a video) | **100** |
| `playlistItems.insert` (add one track) | 50 |
| `playlists.list` / `playlistItems.list` | 1 |
| `playlists.insert` | 50 |

Naively that is **150 units per song → ~66 songs/day**. One class of 30 students submitting 3 songs each is 90 songs, which **exceeds the daily quota on a single class**. This is a real ceiling, not a footnote.

#### Three mitigations, in order of effect

1. **Resolve only approved tracks.** Denied and pending tracks never cost a call. Already implied by the sync design; now explicit.
2. **Dedupe by ISRC before resolving.** Twelve students submitting the same song is *one* search and *one* insert, not twelve. Class playlists overlap heavily.
3. **Persist the resolution.** A school's taste repeats across classes and terms, so the second time anyone anywhere picks that track it costs **0 search units**.

Worked example — 30 students × 3 songs = 90 rows, ~50 unique, ~35 approved, ~15 already cached:

```
20 searches × 100  = 2,000
35 inserts  ×  50  = 1,750
                     -----
                     3,750 units   (of 10,000)
```

Comfortable. Without dedupe and caching the same day fails outright.

#### `trackResolutions` — [NEW] table

```ts
{
  isrc: string,            // uppercase, no dashes — indexed with provider
  provider: "spotify" | "youtube",
  providerTrackId: string, // Spotify URI, or YouTube videoId
  title: string,           // what was matched, so a teacher can spot a bad match
  durationSec: number,
  confidence: "exact" | "fuzzy",
  resolvedAt: number,
}
```

- Keyed on `(isrc, provider)`. **Deployment-wide, not per-teacher** — the cache is worth far more shared, and it holds no user data.
- Spotify writes `confidence: "exact"` (ISRC match). YouTube writes `"fuzzy"` (text search + duration check) and the review UI should say so before syncing.
- Manual (`source: "manual"`) rows have no ISRC and are **never cached** — there is no stable key, and the teacher resolves them by hand.

> [!WARNING]
> **Surface quota exhaustion honestly.** On `quotaExceeded`, sync must stop, report how many tracks were written, mark exactly those `isSynced`, and tell the teacher to retry tomorrow. Silently partial-syncing a playlist and reporting success is worse than failing — the teacher will not notice the gap until class.

---

## Teacher-Defined Questions

The survey is coursework, not just a song picker. The teacher writes the prompts students answer, so the same tool serves "why this song?", "what does it remind you of?", and a plain general note without a code change.

> [!IMPORTANT]
> **This replaces the fixed `studentNote` field.** An earlier draft hard-coded a single note and debated whether it should be optional. That was the wrong axis — *the teacher decides* what is asked and what is mandatory, per survey.

### Two scopes

The teacher's own examples split cleanly across two scopes, and both are needed:

| Scope | Asked | Example | Stored on |
|-------|-------|---------|-----------|
| `song` | Once per song row | "Why this song?" · "What does it remind you of?" | `songs.answers` |
| `submission` | Once for the whole response | "General note?" | `submissions.answers` |

A song-scoped question with 10 songs means 10 answers, so the survey UI shows a live count and the teacher sees the cost while editing.

### Shape

```ts
// surveys.questions — ordered
{
  id: string,           // stable; answers key off this, so never reuse an id
  label: string,        // "Why did you pick this song?"
  helpText?: string,
  scope: "song" | "submission",
  required: boolean,
  maxLength: number,    // default 500
}
```

Answers are stored keyed by question id:
- `submissions.answers`: `Record<questionId, string>` for `scope: "submission"`
- `songs.answers`: `Record<questionId, string>` for `scope: "song"`

> [!CAUTION]
> **Question ids are permanent.** Editing a question's `label` is fine and leaves existing answers readable. Deleting a question must **not** delete answers already submitted under it — the review screen still renders orphaned answers under their original label, or the teacher silently loses student work. Prefer an `archived: true` flag over a hard delete.

### Defaults

A new survey is seeded with one question so it works out of the box:

```
{ id: "why", label: "Why did you pick these songs?", scope: "submission", required: true }
```

### Validation

- Teacher-set `required` is authoritative and enforced **in the mutation**, not just the UI.
- **Escalation, on top of that**: a song that pre-screens `flagged` or `unverified` requires an explanation regardless of what the teacher marked. If the survey has song-scoped questions, that song's first one becomes required; otherwise the first submission-scoped question does. A student cannot submit an explicit or unverifiable track with no justification.
- `maxLength` enforced server-side.

### Teacher editing

The survey dialog gets a question editor: add, reorder, edit label and help text, toggle `required`, pick scope. Reordering rewrites `order`, never ids.

---

## Design System (Single Source of Truth)

> [!IMPORTANT]
> **This section is authoritative and the mockups conform to it.** The previous draft's design system and its mockups were two different designs — the doc specified `indigo-600` / `rounded-lg` / `max-w-4xl` / 14px minimum, while the mockups shipped `blue-700` / `rounded-2xl` / `max-w-5xl` / 10px text. Three contradictions have been resolved below rather than left for the implementer to guess.

Codified in [`tailwind.config.ts`](file:///Users/dda/dev/playlist-creator/tailwind.config.ts) and [`src/lib/design.ts`](file:///Users/dda/dev/playlist-creator/src/lib/design.ts).

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `background` | `slate-50` (#f8fafc) | Page canvas |
| `foreground` | `slate-900` (#0f172a) | Primary text, headings |
| `muted` | `slate-500` (#64748b) | Secondary text, labels, timestamps |
| `border` | `slate-200` (#e2e8f0) | Dividers, input borders, table rules |
| `accent` | `indigo-600` (#4f46e5) | Primary buttons, active links, focus rings |
| `accent-hover` | `indigo-700` (#4338ca) | Hover state for accent elements |
| `success` | `emerald-600` (#059669) | Approved badges, sync confirmation |
| `warning` | `amber-500` (#f59e0b) | Advisory/flagged badges, pending states |
| `danger` | `rose-600` (#e11d48) | Denied badges, destructive actions, errors |
| `surface` | `white` (#ffffff) | Elevated panels |

> [!IMPORTANT]
> **Resolved #1 — accent is `indigo`, not `blue`.** The mockups' `blue-700` is retired. No gradients, no neon, no multi-color backgrounds. Accent is for interactive elements only.

### Typography

| Element | Size / Weight | Tailwind Class |
|---------|--------------|----------------|
| Page title | 24px / semibold | `text-2xl font-semibold` |
| Section heading | 18px / medium | `text-lg font-medium` |
| Body text | 16px / normal | `text-base` |
| Small / caption / table cell | 14px / normal | `text-sm` |
| Badge / overline label | 12px / medium | `text-xs font-medium` |
| Monospace (codes) | 14px / medium | `font-mono text-sm font-medium` |

> [!IMPORTANT]
> **Resolved #2 — 12px is the floor.** The old mockups used `text-[10px]` and `text-[11px]` throughout the moderation table while the same document promised WCAG AA and a Lighthouse accessibility score ≥ 95. Those goals are incompatible. **`text-xs` (12px) is the smallest permitted size and is reserved for badges and overline labels. Table cells are `text-sm` (14px).** If a table does not fit at 14px, the table has too many columns — fix the table, not the type.

- **Line height**: 1.6 body, 1.3 headings.
- **Font**: Inter, with a real system fallback stack.

### Spacing & Layout

| Pattern | Value | Notes |
|---------|-------|-------|
| Reading-width pages (`/`, `/survey`) | `max-w-3xl mx-auto` | Forms and prose |
| Data-dense pages (`/teacher`, review) | `max-w-6xl mx-auto` | Tables need room |
| Section gap | `space-y-6` | |
| Component padding | `p-4` to `p-6` | |
| Radius — controls, inputs, badges | `rounded-lg` (8px) | Buttons, inputs, selects, badges |
| Radius — panels | `rounded-xl` (12px) | Elevated containers only |
| Focus ring | `ring-2 ring-indigo-500 ring-offset-2` | WCAG 2.4.7 |

> [!IMPORTANT]
> **Resolved #3 — two widths, two radii.** A single `max-w-4xl` cannot serve both a centred join form and a seven-column moderation table. Radius is a two-step scale so panels read as containers without the `rounded-2xl` drift.

### Component Patterns

#### Buttons
```
Primary:   bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg px-4 py-2.5 text-sm font-medium
Secondary: bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg px-4 py-2.5 text-sm
Danger:    bg-rose-600 text-white hover:bg-rose-700 rounded-lg px-4 py-2.5 text-sm font-medium
Ghost:     text-indigo-600 hover:bg-indigo-50 rounded-lg px-3 py-2 text-sm
```
All buttons are `min-h-[44px]` to meet the touch-target baseline.

#### Inputs & Selects
```
bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm min-h-[44px]
focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500
placeholder:text-slate-400
```

#### Status Badges
```
Clean:    bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium px-2 py-1 rounded-lg
Flagged:  bg-amber-50  text-amber-800   border border-amber-200
Denied:   bg-rose-50   text-rose-700    border border-rose-200
Pending:  bg-slate-100 text-slate-600   border border-slate-200
```

#### Elevated Panels
```
bg-white border border-slate-200 rounded-xl p-6
```
> **Never nest panels inside panels.** Inside a panel, separate content with `border-t border-slate-200`, not another bordered box. The old mockups violated this on every page.

### Iconography

- **Library**: [Lucide React](https://lucide.dev), 20×20 in dense UI, 24×24 otherwise.
- **Stroke width**: 1.5px. Color inherits `currentColor`.
- Every decorative icon carries `aria-hidden="true"`. Every icon-only button carries an `aria-label`.

### Accessibility Baselines

| Requirement | Standard |
|-------------|----------|
| Text contrast | 4.5:1 minimum (AA) |
| Minimum font size | 12px badges, 14px all content |
| Focus indicator | 2px ring + 2px offset, never `outline: none` |
| Touch target | 44×44px minimum |
| Modals | Focus trap, Escape closes, focus restored on close, background `inert` |
| Live regions | `aria-live="polite"` on every async result and validation summary |
| Motion | `prefers-reduced-motion` respected |

> [!NOTE]
> `aria-modal="true"` alone does **not** trap focus, close on Escape, or restore focus. The previous mockups set the attribute and implemented none of the behaviour. In React, use a headless dialog primitive rather than hand-rolling it.

### Design File Map

| File | Purpose |
|------|---------|
| [`tailwind.config.ts`](file:///Users/dda/dev/playlist-creator/tailwind.config.ts) | Custom color tokens |
| [`src/lib/design.ts`](file:///Users/dda/dev/playlist-creator/src/lib/design.ts) | `btn.primary`, `badge.clean`, `input.base`, `panel` via `clsx`/`tailwind-merge` |
| [`src/app/globals.css`](file:///Users/dda/dev/playlist-creator/src/app/globals.css) | Tailwind directives, base reset |
| [`docs/assets/tokens.js`](file:///Users/dda/dev/playlist-creator/docs/assets/tokens.js) | The token object. **Port straight into `tailwind.config.ts`** |
| [`docs/assets/design.css`](file:///Users/dda/dev/playlist-creator/docs/assets/design.css) | `.btn`, `.field`, `.panel`, `.badge`, `.tbl`, `.dlg` — becomes `src/lib/design.ts` |
| [`docs/assets/proto.js`](file:///Users/dda/dev/playlist-creator/docs/assets/proto.js) | Dialog focus-trap helper, `announce()`, catalog search, `screenTrack()` lexicon |
| [`docs/index.html`](file:///Users/dda/dev/playlist-creator/docs/index.html) | Join gate + teacher sign-in |
| [`docs/mockups/student-survey.html`](file:///Users/dda/dev/playlist-creator/docs/mockups/student-survey.html) | Catalog search & pick. **Hits the live Deezer API** |
| [`docs/mockups/teacher-dashboard.html`](file:///Users/dda/dev/playlist-creator/docs/mockups/teacher-dashboard.html) | Provider connection, surveys, submissions |
| [`docs/mockups/review-submission.html`](file:///Users/dda/dev/playlist-creator/docs/mockups/review-submission.html) | Moderation + grouped multi-playlist sync. **Resolves tracks live from the catalog** |

> [!NOTE]
> **Mockup status.** All four pages pass **axe-core with zero violations**. Both catalog-facing pages hit the live API: the survey searches it, and the review page resolves each pick by id to get real title, artist, duration, artwork, explicit flag, and **ISRC**. Nothing catalog-derived is hand-typed anywhere in the mockups — an earlier draft hardcoded four ISRCs and two were wrong, which is precisely the failure mode this avoids. Both pages **fail closed** when the catalog is unreachable: the survey refuses to accept free text, and the review page hides the table and disables approve/sync rather than showing half-resolved tracks as verified. Dialogs implement a real focus trap, Escape-to-close, focus restore, and background `inert` (all six behaviours verified in-browser). Two prototype-only shortcuts do **not** carry into the app: the Tailwind Play CDN (not for production), and JSONP for catalog search — `api.deezer.com` sends no `Access-Control-Allow-Origin`, so the real app must call the server route `/api/catalog/search`, which also enforces rate limiting.

> [!TIP]
> Import class names from `design.ts` rather than inlining Tailwind strings, so a token change propagates everywhere.

---

## Proposed Changes

### Phase 1: Project Setup & Convex Initialization

Initialize the Next.js project with TypeScript, Tailwind CSS, and Convex. **pnpm** is the project package manager.

#### [NEW] [package.json](file:///Users/dda/dev/playlist-creator/package.json)
- `"packageManager": "pnpm@9"` field for Corepack enforcement.
- Next.js 14+ (App Router), React 18/19, TypeScript.
- Dependencies: `convex`, `better-auth`, `@convex-dev/better-auth` (**pin exact version — pre-1.0**), `lucide-react`, `clsx`, `tailwind-merge`.
- Dev dependencies: `tailwindcss`, `postcss`, `autoprefixer`.

#### [NEW] [convex.json](file:///Users/dda/dev/playlist-creator/convex.json)
- Convex configuration linking to the local or cloud development environment.

#### [NEW] [.env.local](file:///Users/dda/dev/playlist-creator/.env.local)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment endpoint (public). |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex HTTP actions endpoint, used as the Better Auth base URL. |
| `BETTER_AUTH_SECRET` | Signing secret for sessions. Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | `http://127.0.0.1:3000` in dev — **not** `localhost` (Spotify requirement). |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID. |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret. **Server-only — never `NEXT_PUBLIC_`.** |
| `GOOGLE_CLIENT_ID` | Optional, YouTube provider. |
| `GOOGLE_CLIENT_SECRET` | Optional, YouTube provider. Server-only. |

> [!NOTE]
> `TEACHER_PASSWORD` is **removed**. It was a single shared secret with no user identity attached, which made per-teacher data scoping impossible. Better Auth replaces it.

---

### Phase 2: Convex Backend Schema & Functions

#### [NEW] `convex/schema.ts`

> [!IMPORTANT]
> Field names below are **authoritative**. The original draft's schema and its test plan disagreed on at least six names (`preScreen` vs `screeningFlags`, `isActive` vs `status`, `className` vs `title`, `allowedPlaylists` vs `playlists`, plus `decidedAt` / `teacherOverride` which the tests asserted but the schema never defined). Tests must be updated to match this section.

Better Auth's `user`, `session`, `account`, and `verification` tables are supplied by the `@convex-dev/better-auth` component and are **not** declared here.

Application tables:

1. `surveys`:
   - `teacherId`: **[NEW]** Better Auth user ID (`identity.subject`). Every teacher-facing query filters on this. Indexed as `by_teacher`.
   - `code`: Class join code, uppercase. Indexed as `by_code`.
   - `className`: Title of the class (e.g. "Period 4 Music Lab").
   - `questions`: **[NEW]** Ordered array of `{ id, label, helpText?, scope, required, maxLength }`. See Teacher-Defined Questions.
   - `allowedPlaylists`: **[CHANGED]** Array of `{ label: string, providerPlaylistId: string | null }`. Was a bare string array, which left no way to map a student's per-track choice ("Study & Focus") onto an actual Spotify playlist at sync time.
   - `isActive`: Boolean flag to open/close submissions.
   - `createdAt`: Timestamp.
2. `submissions`:
   - `surveyId`: Foreign key to `surveys`.
   - `studentName`: Name or alias.
   - `studentSeat`: Optional desk/period info.
   - `answers`: **[REPLACES `studentNote`]** `Record<questionId, string>` for the survey's `scope: "submission"` questions. The old single free-text note is gone — see Teacher-Defined Questions.
   - `createdAt`: Timestamp.
3. `songs`:
   - `submissionId`: Foreign key to `submissions`.
   - `surveyId`: Foreign key to `surveys`. Denormalized so screening and sync can scope by survey without a join.
   - `title`: Song title, **as returned by the catalog** (not student-typed).
   - `artist`: Artist name, from the catalog.
   - `source`: **[NEW]** `"catalog"` | `"manual"`. Manual rows are student free text for songs the catalog does not have.
   - `isrc`: **[NEW]** The cross-provider join key. Uppercase, no dashes. **Null when `source: "manual"`.**
   - `deezerId`: **[NEW]** Catalog track ID. Null for manual rows.
   - `durationSec`: **[NEW]** Sanity-checks YouTube fallback matches. Null for manual rows.
   - `artworkUrl`: **[NEW]** Cover art for the moderation table. Null for manual rows.
   - `playlistTarget`: The `label` selected by the student; resolved to a `providerPlaylistId` at sync time.
   - `preScreen`: Object with `status` (`clean` | `flagged` | `unverified`), `isExplicitTag` (boolean, from Deezer `explicit_lyrics`), and `matchedKeywords` (array). No `pending` state and no `apiError` — screening resolves synchronously at pick time. `unverified` is reserved for `source: "manual"` rows, where the absence of an explicit flag means nothing.
   - `decision`: Union of `"pending"` | `"approved"` | `"denied"`.
   - `denialReason`: Optional reason for dismissal.
   - `decidedAt`: **[NEW]** Timestamp of the teacher's decision.
   - `decidedBy`: **[NEW]** Better Auth user ID of the deciding teacher.
   - `teacherOverride`: **[NEW]** Boolean — true when a teacher approved a track that pre-screened as flagged. This is the audit trail that protects the teacher.
   - `isSynced`: Boolean tracking live export.
   - `answers`: **[NEW]** `Record<questionId, string>` for the survey's `scope: "song"` questions.
   - `syncedTrackUri`: **[NEW]** The provider URI actually written, for idempotency and dedupe.

#### Authorization model (applies to every function below)

Two tiers. Tier 1 is the default; Tier 2 is the explicit, audited exception.

```typescript
// convex/lib/auth.ts — shared helper, used by every Tier 1 function
export async function requireTeacher(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error("Not authenticated");
  return identity.subject; // Better Auth user ID
}

// Ownership is a SEPARATE check. Authentication alone is not authorization —
// without this, any signed-in teacher can moderate any other teacher's class.
export async function requireOwnedSurvey(ctx, surveyId) {
  const teacherId = await requireTeacher(ctx);
  const survey = await ctx.db.get(surveyId);
  if (!survey || survey.teacherId !== teacherId) throw new Error("Not found");
  return survey;
}
```

| Tier | Functions | Gate |
|------|-----------|------|
| **1 — Teacher** | `surveys.list`, `surveys.create`, `surveys.toggleStatus`, `submissions.listBySurvey`, `submissions.getById`, `songs.updateDecision`, `songs.bulkApproveClean` | `requireTeacher` + `requireOwnedSurvey` |
| **2 — Student (anonymous)** | `surveys.getByCode`, `submissions.submit` | No identity. Code-scoped, rate-limited, narrow projection |

#### [NEW] `convex/surveys.ts`
- `create`: **Tier 1.** Creates a survey owned by `identity.subject`. Checks code uniqueness before insert — Convex mutations are serializable, so check-then-insert is safe here despite the absence of unique constraints.
- `getByCode`: **Tier 2.** Returns a **narrow projection only**: `className`, `isActive`, and `allowedPlaylists[].label`. Must **never** return `teacherId`, `providerPlaylistId`, or any submission. A leak here re-opens the whole hole through the student door.
- `list`: **Tier 1.** Filters `by_teacher` on `identity.subject`. Never returns all surveys.
- `toggleStatus`: **Tier 1**, ownership-checked.

#### [NEW] `convex/submissions.ts`
- `submit`: **Tier 2.** Anonymous. Must enforce **inside the mutation**, not in the UI:
  - survey exists and `isActive === true` (a closed survey must be unwritable via a direct Convex call);
  - `1 <= songs.length <= 10`;
  - every song carries **either** a catalog `deezerId` + `isrc`, **or** `source: "manual"` with a non-empty title and artist — reject anything else;
  - at most `MAX_MANUAL` (2) manual rows per submission;
  - every question with `required: true` has a non-empty answer;
  - a `flagged` or `unverified` song has an explanation even if the teacher marked nothing required;
  - no answer exceeds its question's `maxLength`;
  - rate limit per session/IP. **This is the only thing standing between the app and one bored student inserting 5,000 rows.**
  - Schedules background pre-screening.
- `listBySurvey`: **Tier 1**, ownership-checked. Students must never be able to read other students' names or notes.
- `getById`: **Tier 1**, ownership-checked via the parent survey.

#### [NEW] `convex/screening.ts` — now a pure function, not an action

Screening no longer needs a network call at submit time, because the student picked a catalog track and `explicit_lyrics` came back with it. What remains is a synchronous, deterministic function run inside `submissions.submit`:

- `isExplicitTag` — copied straight from the catalog result.
- `matchedKeywords` — the school-safety lexicon run over title and artist. **Phrase-level, not substring**: `"Hugs Not Drugs"` and `"Pumped Up Kicks"` must not match on a bare substring rule.
- `status` — `unverified` when `source: "manual"` (no catalog signal exists); otherwise `flagged` if either signal fires, else `clean`.

> [!NOTE]
> **The Convex background action is deleted.** It existed only to resolve free text against Spotify, which required a token no one could supply at student-submit time. Removing free text removed the action, the token problem, and the `pending` screening state together.

> [!WARNING]
> **Screening is metadata-only.** It sees title, artist, and the label-supplied explicit flag. It does **not** read lyrics. The old mockup's "3 matched restricted words in chorus" was never buildable and must not reappear in the UI. Label explicit tags are also inconsistently applied. Present every result as advisory; the teacher decides.

#### [NEW] `src/app/api/catalog/search/route.ts`
- Thin server-side proxy to `https://api.deezer.com/search`. Server-side so the rate limit is enforced centrally and the upstream can be swapped without touching the client.
- Debounced from the client (250ms); returns at most 8 results.
- Rate-limited per session — this endpoint is reachable by unauthenticated students.
- Returns `{ deezerId, title, artist, album, durationSec, artworkUrl, isExplicit, isrc }`.
- On upstream failure returns `503` with a clear message. The survey form must degrade to a "catalog unavailable, try again shortly" state rather than silently accepting free text — accepting free text here would reintroduce every problem this design removes.

#### [NEW] `convex/songs.ts`
- `updateDecision`: **Tier 1**, ownership-checked. Sets `decision`, `decidedAt`, `decidedBy`, and `teacherOverride` (true when approving a track whose `preScreen.status === "flagged"`).
- `bulkApproveClean`: **Tier 1**, ownership-checked. Approves only songs with `preScreen.status === "clean"` — **never `flagged`, never `unverified`**. A manual row has no explicit flag, so treating its absence as clean would fail open.
> [!NOTE]
> **`swapCleanEdit` is cut.** The original design offered a 1-click "Swap for Clean Radio Edit". Querying the catalog for the canonical test case — `artist:"Post Malone" track:"rockstar"` — returns two results, **both explicit**: no clean version exists. Neither Spotify nor Deezer exposes a "clean variant of" relation, so the feature would have been a title/artist/duration heuristic that usually finds nothing and occasionally surfaces a karaoke cover. A teacher who wants a clean version can ask the student to search for one; the survey form already searches the catalog.

---

### Phase 3: Authentication (Better Auth + Convex)

Replaces the original "Client-Side Auth & Ephemeral Cookie Layer". `src/lib/cookies.ts`, `src/lib/spotify-pkce.ts`, `src/lib/youtube-gis.ts`, and `src/app/api/auth/teacher/route.ts` are **all removed**.

#### Dependencies
- `better-auth` and `@convex-dev/better-auth` (currently `0.12.x`).

> [!WARNING]
> `@convex-dev/better-auth` is **pre-1.0** and has shipped breaking changes between minor versions (migration guides exist for 0.8 → 0.12). Pin the exact version in `package.json` and read the migration notes before bumping.

#### [NEW] `convex/convex.config.ts`
- Registers the Better Auth component: `app.use(betterAuth)`.

#### [NEW] `convex/auth.ts`
- Instantiates `createAuth` with the Convex database adapter.
- `emailAndPassword: { enabled: true }` — teacher sign-in.
- `socialProviders.spotify: { clientId, clientSecret, scope: [...] }`.
- Required Spotify scopes: `playlist-modify-public`, `playlist-modify-private`, `playlist-read-private`. (`playlist-read-collaborative` if collaborative playlists are targets.)
- Exports `authComponent` for use in Convex functions.

#### [NEW] `src/app/api/auth/[...all]/route.ts`
- Better Auth's Next.js catch-all handler. Handles sign-in, sign-out, the Spotify OAuth redirect, and callback.

#### [NEW] `src/lib/auth-client.ts`
- `createAuthClient` for the browser. Exposes `signIn.email`, `signIn.social({ provider: "spotify" })`, `signOut`, `useSession`.

#### [NEW] `middleware.ts`
- Server-side guard on `/teacher/*`. Redirects unauthenticated requests to `/`.

> [!IMPORTANT]
> Middleware is **defence in depth, not the security boundary**. It only guards Next.js page navigations. The actual boundary is the per-function check inside Convex, because the Convex URL is public and callable directly. Do not let the presence of middleware justify skipping the Convex-side checks.

#### Token handling for sync
- Better Auth persists the Spotify access **and refresh** token on the linked account.
- `/api/sync` obtains a live token via Better Auth's `getAccessToken`, which refreshes on expiry. **Screening no longer needs a token at all** — see the Provider-Neutral Catalog section.
- **The teacher no longer re-authenticates every hour.** The original 2-hour cookie TTL was wrong regardless: Spotify access tokens expire in 3600s, so the mockup's "Session Cookie: 1h 48m left" badge would have shown green while the token was already dead. The UI should now show *account connected / not connected*, not a countdown.

#### Teacher onboarding
- Sign-up is **not** publicly exposed. Seed the single teacher account with a script, or gate sign-up behind an invite code. An open `/sign-up` on a public URL would let anyone create an account and read student data.

---

### Phase 4: Frontend Next.js Views

Translate the approved accessible HTML mockups into React App Router pages:

#### [NEW] `src/app/page.tsx` (Homepage & Student Code Gate)
- Center-stage join code input: students type `P4-BEATS` and press Enter to navigate to `/survey?code=P4-BEATS`.
- Quick-test demo buttons for instant access.
- Top-right "Teacher Portal" button opening the Better Auth email + password sign-in modal.

#### [NEW] `src/app/survey/page.tsx` (Student Survey View)
- Validates the class code via `useQuery(api.surveys.getByCode)`.
- Displays classroom title and configured playlist choices.
- **Catalog search per row**: student types, sees up to 8 real tracks with cover art, and picks one. The stored record is the catalog's canonical title/artist/ISRC — never the student's typing.
- An explicit track is **not blocked at pick time**; it is picked, marked, and surfaced to the teacher. Blocking here would just teach students to misspell their way around it.
- 1 to 10 songs, each with its own playlist target.
- Optional "Note for Teacher" textarea. **Changed from mandatory** — requiring a justification for all ten tracks produces ten copies of "idk i like it". Required only when a picked track pre-screens as flagged, where the student actually has something to explain.
- **Non-blocking**: submits directly to Convex; screening is advisory, not a gate.

#### [NEW] `src/app/teacher/page.tsx` (Teacher Moderation Dashboard)
- Wrapped in `<Authenticated>` from `convex/react`; guarded server-side by `middleware.ts`.
- **Step 1: Provider Connection Panel** — Spotify and YouTube are presented as equal choices:
  - `authClient.signIn.social({ provider })` to link either account.
  - Lists the linked account's existing playlists, and can create + link a new one. Required on **both** providers so a teacher can switch without losing the ability to target playlists.
  - Switching provider clears every `providerPlaylistId` and prompts re-linking.
  - **Connected / Not connected** state — no countdown timer. Better Auth refreshes the token, so remaining lifetime is not something the teacher needs to watch or act on.
  - "Disconnect Spotify" unlinks the account.
  - Fetches and displays available playlists from the provider.
- **Step 2: Class Survey Manager**:
  - Lists active class codes (`P4-BEATS`, `STUDY-22`).
  - "Create New Class Survey" modal with code randomizer and playlist selection.
  - 1-click "Copy Student Link" button.
- **Step 3: Real-Time Submissions Table**:
  - Live reactive list powered by `useQuery(api.submissions.listBySurvey)`.
  - Displays student name, class code, songs submitted, and automated pre-screening advisory badge.
  - Link to review submission.

#### [NEW] `src/app/teacher/review/[id]/page.tsx` (Song Moderation & Sync Screen)
- Displays student submission details, seat info, and the student note when present.
- **Automated Advisory Report Table**:
  - Label explicit flag (`explicit: true/false`).
  - Keyword match summary.
  - 1-click **Approve (Teacher Override)** or **Deny**, with an optional denial reason.
- **Playlist Sync Target Bar**:
  - Pre-selects from playlists fetched in Step 1 or allows creating a new playlist.
- **Execute Sync Button**:
  - Triggers `/api/sync` to export all approved tracks to the connected provider.

#### [NEW] `src/app/api/sync/route.ts`
- Requires an authenticated Better Auth session; re-checks survey ownership before reading any song.
- Obtains a live provider token via Better Auth's `getAccessToken` (auto-refreshing) rather than reading a cookie.
- Groups approved songs by `playlistTarget` → `providerPlaylistId` and writes each group to its own playlist. The original design collected a per-track playlist choice and then discarded it at sync.
- **Resolution order per track**: `trackResolutions` cache → provider lookup (Spotify ISRC search, or YouTube text search + duration check) → write the result back to the cache. On YouTube this is what keeps the job inside the daily quota.
- **Dedupe before resolving**: collapse approved songs by ISRC first, so a track twelve students picked costs one lookup and one insert. On YouTube each duplicate avoided saves 150 quota units.
- **Idempotency**: skip songs already `isSynced`, and check existing playlist contents. Neither provider's add endpoint is idempotent — without this a re-click or partial failure double-adds.
- **Quota exhaustion** (`quotaExceeded`): stop, mark exactly the tracks that were written, report the count, and tell the teacher to retry tomorrow. Never report success on a partial sync.
- Writes `isSynced` and `syncedTrackUri` per song as each batch succeeds, so a mid-batch failure is resumable.
- Returns the playlist link(s).

---

## Testing Plan

### Tooling & Configuration

| Tool | Purpose | Config File |
|------|---------|-------------|
| **Vitest** | Unit & integration tests (fast, ESM-native) | `vitest.config.ts` |
| **convex-test** | Convex function tests with in-memory DB | Uses Vitest runner |
| **Playwright** | End-to-end browser tests | `playwright.config.ts` |
| **axe-core / @axe-core/playwright** | Automated accessibility audits | Integrated into Playwright |
| **Lighthouse CI** | Performance & a11y scoring in CI | `lighthouserc.json` |

```bash
# Run all unit/integration tests
pnpm vitest run

# Run E2E tests
pnpm playwright test

# Run accessibility audit on running dev server
pnpm lighthouse http://localhost:3000 --only-categories=accessibility
```

---

### 1. Unit Tests (`src/__tests__/unit/`)

#### 1a. Lexicon Scanner (`screening.test.ts`)

| Test Case | Input | Expected Result |
|-----------|-------|-----------------|
| Detects explicit keyword in title | `"F**k You"` by CeeLo Green | `keywordMatch: true` |
| Flags common profanity variants | `"B!tch Better"` by artist | `keywordMatch: true` (normalized) |
| **False-positive safe**: song with coincidental word | `"Pumped Up Kicks"` by Foster the People | `keywordMatch: false` (phrase-level, not substring) |
| **False-positive safe**: "Drugs" in educational context | `"Hugs Not Drugs"` | `keywordMatch: false` |
| Clean title passes cleanly | `"Here Comes the Sun"` by The Beatles | All flags `false` |
| Empty/whitespace input | `""`, `"   "` | Graceful return with no flags |

#### 1b. Auth Helpers (`auth-helpers.test.ts`)

> Replaces the former PKCE and cookie-helper suites. `spotify-pkce.ts` and `cookies.ts` no longer exist — Better Auth owns token handling, so there is nothing hand-rolled left to unit test. Auth is now covered by the Convex authorization tests in §2e, which is where it actually matters.

- `requireTeacher(ctx)` throws when `ctx.auth.getUserIdentity()` returns `null`.
- `requireTeacher(ctx)` returns `identity.subject` when authenticated.
- `requireOwnedSurvey(ctx, id)` throws when the survey's `teacherId` differs from the caller.
- `requireOwnedSurvey(ctx, id)` throws the **same** error for "not found" and "not yours", so the existence of another teacher's survey is not leaked.

#### 1d. Survey Code Generator (`survey-code.test.ts`)

- Generated codes match pattern `^[A-Z0-9]{2,6}(-[A-Z0-9]{2,6}){0,2}$` (e.g. `P4-BEATS`, `GYM-01`).
- 500 sequential generations produce zero duplicates.
- Codes are 3–12 characters (excluding hyphens) for easy verbal sharing.

---

### 2. Convex Integration Tests (`convex/__tests__/`)

> Uses `convex-test` to spin up an in-memory Convex instance per test file.

#### 2a. Surveys (`surveys.test.ts`)

| Test | Action | Assertion |
|------|--------|-----------|
| Create survey | `mutations.surveys.create({ className: "Period 4", allowedPlaylists: [{label:"Study",providerPlaylistId:null}] })` as an authed teacher | Returns doc with valid `code`, `isActive: true`, `teacherId` set to caller |
| Lookup by code | `queries.surveys.getByCode({ code })` unauthenticated | Returns the survey projection |
| **Projection is narrow** | `getByCode` unauthenticated | Result has **no** `teacherId`, **no** `providerPlaylistId`, **no** submissions |
| Invalid code returns null | `queries.surveys.getByCode({ code: "ZZZZZ" })` | Returns `null` |
| Deactivate survey | `mutations.surveys.toggleStatus({ id })` as owner | `isActive` becomes `false` |
| Duplicate code prevention | Create 100 surveys | All codes are unique |

#### 2b. Submissions (`submissions.test.ts`)

| Test | Action | Assertion |
|------|--------|-----------|
| Submit with 1 song | `mutations.submissions.submit({ surveyId, studentName, note, songs: [1 song] })` | Creates submission + 1 linked song row |
| Submit with 10 songs | Same with 10 song objects | Creates submission + 10 linked song rows |
| **Reject 0 songs** | Submit with empty `songs` array | Throws validation error |
| **Reject 11 songs** | Submit with 11 song objects | Throws validation error |
| Note is required | Submit with empty `note` | Throws validation error |
| List by survey | `queries.submissions.listBySurvey({ surveyId })` after 3 submissions | Returns 3 submissions, newest first |
| Song-playlist linkage | Submit song with `playlistTarget: "Study"` | Song row has correct `playlistTarget` field |

#### 2c. Songs & Moderation (`songs.test.ts`)

| Test | Action | Assertion |
|------|--------|-----------|
| Approve track | `mutations.songs.updateDecision({ id, decision: "approved" })` | `decision` is `"approved"`, `decidedAt` is set |
| Deny track | `mutations.songs.updateDecision({ id, decision: "denied" })` | `decision` is `"denied"` |
| Override false positive | Approve a song that has `screeningFlags.keywordMatch: true` | `decision: "approved"`, `teacherOverride: true` |
| Bulk approve clean | Create 5 songs (3 clean, 2 flagged), call `bulkApproveClean` | Only 3 clean songs become `"approved"` |

#### 2d. Screening (`screening.test.ts`)

> Now a pure-function suite — no mocking, no network, no Convex action.

| Test Case | Input | Expected |
|-----------|-------|----------|
| Explicit tag propagates | Catalog result `isExplicit: true` | `preScreen.status: "flagged"`, `isExplicitTag: true` |
| Clean track passes | `isExplicit: false`, benign title | `status: "clean"`, no keywords |
| Keyword fires on clean-tagged track | `"Pumped Up Kicks"`, `isExplicit: false` | `status: "flagged"` via `matchedKeywords`, `isExplicitTag: false` |
| **False-positive safe** | `"Hugs Not Drugs"` | `matchedKeywords: []` — phrase-level, not substring |
| Both signals | Explicit tag **and** keyword match | `status: "flagged"`, both fields populated |
| Empty/whitespace | `""`, `"   "` | Returns cleanly, no flags, no throw |

#### 2e. Authorization (`authz.test.ts`) — **new, and the most important suite in the plan**

These tests encode the hole that motivated adopting Better Auth. Each one calls a Convex function **directly**, the way a student with devtools would — bypassing React, middleware, and every UI guard.

| Test | Action | Assertion |
|------|--------|-----------|
| Unauthenticated cannot list surveys | `queries.surveys.list()` with no identity | Throws `"Not authenticated"` |
| Unauthenticated cannot read submissions | `queries.submissions.listBySurvey({ surveyId })` with no identity | Throws |
| Unauthenticated cannot moderate | `mutations.songs.updateDecision({ id, decision: "approved" })` with no identity | Throws |
| **Cross-teacher isolation** | Teacher B calls `listBySurvey` on Teacher A's survey | Throws — authentication alone must not grant access |
| **Cross-teacher moderation blocked** | Teacher B calls `updateDecision` on a song in Teacher A's survey | Throws |
| `surveys.list` is scoped | Teacher A has 2 surveys, Teacher B has 3; A calls `list` | Returns exactly A's 2 |
| **Closed survey rejects direct writes** | `mutations.submissions.submit` to a survey with `isActive: false` | Throws — the UI gate is not the enforcement point |
| Song count enforced server-side | `submit` with 0 songs, and with 11 songs | Both throw |
| Anonymous submit still works | `submit` to an active survey with no identity | Succeeds — students must never need an account |
| Rate limit engages | 50 rapid `submit` calls from one session | Throttled after threshold |

---

### 3. API Route Tests (`src/__tests__/api/`)

#### 3a. Better Auth Routes (`auth.test.ts`)

| Test | Request | Expected |
|------|---------|----------|
| Sign in with correct credentials | `POST /api/auth/sign-in/email` | `200`, session cookie set |
| Sign in with wrong password | `POST /api/auth/sign-in/email` | `401`, no session |
| Sign-up is not publicly reachable | `POST /api/auth/sign-up/email` | Rejected (disabled or invite-gated) |
| Middleware guards `/teacher` | `GET /teacher` with no session | Redirect to `/` |
| Middleware guards nested routes | `GET /teacher/review/abc` with no session | Redirect to `/` |
| Spotify link requires a session | `GET /api/auth/sign-in/social?provider=spotify` unauthenticated | Rejected |
| Rate limiting | 10 rapid failed sign-ins | `429` after threshold |

#### 3b. Sync Route (`sync.test.ts`)

| Test | Request | Expected |
|------|---------|----------|
| No session | `POST /api/sync` unauthenticated | `401 Unauthorized` |
| Not the owner | Authed as Teacher B, sync Teacher A's survey | `403` / not found |
| No linked Spotify account | Authed teacher who never connected Spotify | `400` with "Connect Spotify first" |
| Token refresh on expiry | Stored access token expired, refresh token valid | Refreshes transparently, sync succeeds |
| Refresh token revoked | Spotify returns `invalid_grant` on refresh | `401` with "Reconnect Spotify", account marked unlinked |
| Valid Spotify sync | Mock Spotify `POST /v1/playlists/{id}/tracks` returning `201` | `200` with `{ playlistUrl }` |
| **Multi-playlist grouping** | 3 approved songs across 2 `playlistTarget` values | Two separate playlist writes, correct split |
| **Idempotent re-sync** | Call sync twice with the same approved set | Second call adds 0 tracks |
| **Intra-batch dedupe** | 5 students submit the same track URI | Track added once |
| Partial failure is resumable | Mock failure on the 2nd of 3 batches | Songs from batch 1 stay `isSynced: true`; retry adds only the rest |
| Spotify API error | Mock Spotify returning `403` | `502` with descriptive error |
| Valid YouTube sync | Mock YouTube `playlistItems.insert` returning `200` | `200` with `{ playlistUrl }` |
| **Cache hit skips lookup** | Track whose `(isrc, provider)` is cached | No `search.list` / ISRC search issued at all |
| **Cache written on miss** | Uncached track resolved | `trackResolutions` row created with correct `confidence` |
| **Dedupe before resolve** | 12 approved songs sharing one ISRC | Exactly 1 lookup and 1 insert |
| Manual rows are never cached | `source: "manual"` track synced by hand | No `trackResolutions` row written (no ISRC key) |
| Spotify resolution is exact | ISRC search hit | `confidence: "exact"` |
| YouTube resolution is fuzzy | Text search + duration check | `confidence: "fuzzy"`, surfaced in the UI before sync |
| YouTube duration mismatch | Search returns a 10-min video for a 3-min track | Rejected, not blindly inserted |
| **Quota exhausted mid-batch** | Mock `quotaExceeded` after 5 of 12 inserts | Stops; exactly those 5 marked `isSynced`; reports "5 of 12 synced, retry tomorrow"; **does not** report success |
| Provider switch clears links | Teacher relinks from Spotify to YouTube | Every `providerPlaylistId` cleared, re-linking prompted |
| Playlists list on both | `list` against each provider | Returns id, name, url, track count |
| Empty track list | Valid session but `tracks: []` | `400` with "No tracks to sync" |

#### 3c. Catalog Search (`catalog.test.ts`)

| Test | Request | Expected |
|------|---------|----------|
| Basic search | `GET /api/catalog/search?q=rockstar` | `200`, ≤8 normalized results |
| Explicit flag preserved | Mock Deezer `explicit_lyrics: true` | Result has `isExplicit: true` — must never be dropped or defaulted to false |
| ISRC present | Result includes uppercase, dash-free `isrc` | Required for cross-provider sync |
| Empty query | `?q=` | `400`, no upstream call |
| Upstream 5xx | Mock Deezer failure | `503` — **must not** fall back to accepting free text |
| Upstream timeout | Mock hang | `503` within a bounded timeout |
| Rate limited | 100 rapid calls from one session | `429` — endpoint is reachable by unauthenticated students |
| No secrets leaked | Inspect response | Plain catalog metadata only |

---

### 4. End-to-End Tests (`e2e/`)

> Uses **Playwright** with Chromium. Convex dev instance running locally.

#### 4a. Student Submission Flow (`e2e/student-flow.spec.ts`)

1. Navigate to `http://localhost:3000`.
2. Type class code `P4-BEATS` into the join input → press Enter.
3. Assert URL is `/survey?code=P4-BEATS` and classroom title is visible.
4. Fill in 3 songs with playlist selections and a student note.
5. Click "Submit" → assert success confirmation message.
6. Revisit homepage → enter same code → verify no duplicate submission guard (students can submit multiple times).

#### 4b. Teacher Dashboard Real-Time Update (`e2e/teacher-realtime.spec.ts`)

1. In **Browser Context A**: teacher signs in via the Better Auth modal → navigates to `/teacher`.
2. In **Browser Context B**: student submits a new response via the survey form.
3. In **Browser Context A**: assert the new submission row appears in the table **without page refresh** (Convex reactivity).
4. Assert submission count badge increments.

#### 4c. Moderation & Override Flow (`e2e/moderation.spec.ts`)

1. Teacher clicks "Review" on a submission containing a flagged song.
2. Assert the advisory report shows correct pre-screening badges (explicit, keyword, clean alternative).
3. Click "Approve" on a false-positive flagged song → assert badge changes to "Approved (Override)".
4. Click "Deny" on another song → assert badge changes to "Denied".

#### 4d. Survey Management (`e2e/survey-management.spec.ts`)

1. Teacher clicks "Create New Survey".
2. Fills in class name, selects playlists, and clicks "Generate Code".
3. Assert new code appears in the survey list.
4. Click "Copy Link" → assert clipboard contains the correct URL.
5. Deactivate survey → assert status badge changes to "Closed".
6. Student attempts to submit via the deactivated code → assert friendly error message.

---

### 5. Accessibility Tests

#### 5a. Automated axe-core Scans (integrated into Playwright)

```typescript
// Runs on every E2E page navigation
import AxeBuilder from '@axe-core/playwright';

test('homepage has no a11y violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

**Pages scanned**: `/`, `/survey?code=P4-BEATS`, `/teacher`, `/teacher/review/[id]`.

#### 5b. Specific WCAG Checks

| Requirement | Check | Standard |
|-------------|-------|----------|
| Color contrast | All text meets 4.5:1 ratio (AA) or 7:1 (AAA) against `slate-50` background | WCAG 1.4.3 / 1.4.6 |
| Keyboard navigation | Full tab-through of all forms without mouse | WCAG 2.1.1 |
| Focus indicators | Visible focus ring (2px+ solid) on all interactive elements | WCAG 2.4.7 |
| Form labels | Every `<input>`, `<select>`, `<textarea>` has an associated `<label>` | WCAG 1.3.1 |
| Error messaging | Validation errors announced via `aria-live="polite"` regions | WCAG 4.1.3 |
| Screen reader landmarks | `<main>`, `<nav>`, `<header>`, `<footer>` used semantically | WCAG 1.3.1 |
| Responsive text | No horizontal scroll at 320px viewport width | WCAG 1.4.10 |

#### 5c. Lighthouse CI (runs in GitHub Actions)

```bash
pnpm lhci autorun --collect.url=http://localhost:3000 \
  --assert.assertions.categories:accessibility=0.95
```

- **Threshold**: Accessibility score ≥ 95/100 to pass CI.
- Runs against `/`, `/survey`, and `/teacher` routes.

---

### 6. Security Tests

| Vector | Test | Expected |
|--------|------|----------|
| XSS via song title | Submit song with title `<script>alert('xss')</script>` | Title rendered as escaped text, no script execution |
| XSS via student note | Submit note containing `<img onerror=alert(1)>` | Sanitized output |
| **Direct Convex call bypass** | Call `api.surveys.list` from a browser console with no session | Throws. See §2e — this is the primary threat model |
| **Student reads other students' data** | Student on `/survey` calls `api.submissions.listBySurvey` | Throws |
| **Student self-approves a track** | Student calls `api.songs.updateDecision({ decision: "approved" })` | Throws |
| CSRF on sign-in | `POST /api/auth/sign-in/email` without `Origin` | Rejected; Better Auth session cookie is `SameSite=Lax` |
| Session cookie not readable by JS | `document.cookie` in the page | Better Auth session cookie absent (`HttpOnly`) |
| **Spotify secret never reaches the client** | `grep -r "SPOTIFY_CLIENT_SECRET" .next/static/` | No match. Only `NEXT_PUBLIC_*` may be bundled |
| **Provider tokens never reach the client** | Inspect any Convex query payload on `/teacher` | No access or refresh token present |
| Survey code enumeration | Brute-force `getByCode` for 10,000 codes | Rate limiting triggers; no timing side-channel |
| Unauth page access | `GET /teacher` with no session | Redirected to homepage with sign-in prompt |
| Open sign-up | `POST /api/auth/sign-up/email` from the internet | Rejected — otherwise anyone creates an account and reads student PII |

---

### 7. Manual Smoke Tests (Pre-Release Checklist)

#### Student Flow
- [ ] Open homepage → enter valid code → redirected to survey
- [ ] Enter invalid code → see friendly "Code not found" error
- [ ] Add 1 song → submit → see confirmation
- [ ] Add 10 songs with different playlist targets → submit → see confirmation
- [ ] Try to add 11th song → "Add Song" button disabled
- [ ] Submit without note → see validation error on the note field

#### Teacher Flow
- [ ] Sign in with correct credentials → reach `/teacher` dashboard
- [ ] Sign in with wrong password → see error, remain on homepage
- [ ] Connect Spotify via OAuth → see "Connected" badge (account state, **not** a countdown)
- [ ] Sign out, sign back in the next day → Spotify still connected (refresh token works)
- [ ] Open `/teacher` in a logged-out incognito window → redirected to homepage
- [ ] Create new class survey with custom code → appears in list
- [ ] Copy student link → open in incognito → survey loads correctly
- [ ] See real-time submission appear after student submits
- [ ] Review submission → approve and deny songs → all status badges update
- [ ] Deactivate survey → student sees "Survey closed" message

#### Sync Flow
- [ ] Select target playlist → click "Sync Approved Tracks" → tracks appear in Spotify/YouTube playlist
- [ ] Disconnect provider → linked account removed → "Connect" buttons reappear
- [ ] Sync twice in a row → tracks are **not** duplicated in the playlist
- [ ] Revoke access in Spotify account settings, then sync → clear "reconnect Spotify" error, not a 500
