# Fusion: notes for Claude

Fusion is the church app for Fusion Church. It replaces Planning Center and MultiTracks for the church
(not sold to others). The owner is not a developer: explain things simply, say exactly what to tap and where,
and avoid jargon.

## Stack and deploys

- Next.js 15 (App Router, TypeScript, Tailwind) + Supabase (Postgres with RLS, auth, Storage bucket `charts`,
  Realtime) + Cloudflare Workers via OpenNext.
- **Every push to `main` deploys to the live site** (Cloudflare project `fusion-worshipppp`). `main` = live.
- Locations: Newfield, Egg Harbor, Ventnor (`useLocations()`); roles: admin, leader, member, pending
  (`useProfile()`: `isAdmin`, `isLeader`).

## How we work

1. **Work on a branch, never straight on `main`.** Show the owner an example (screenshots or a short demo)
   before anything goes to `main`. Push to `main` only when the owner says so ("push it").
2. **Database changes:** never change the live database directly. Add a new numbered file in
   `supabase/migrations/` (next free number after the highest there), written to be safe to run twice
   (`if not exists`, `drop policy if exists`, …). Append it to `supabase/ALL_UPDATES.sql` above the
   "Make the app see the changes right away" line. Give the owner the exact SQL to paste into Supabase →
   SQL Editor, ending with `notify pgrst, 'reload schema';`, and explain in plain English what it does.
   The app must keep working, with a friendly "run update 0NN_….sql" note, until it has been run.
3. **Secrets** (API keys, tokens, passwords) live only in Cloudflare → Workers → fusion-worshipppp →
   Settings → Variables and Secrets. Never in code, commits, or chat. If the owner pastes one in chat,
   tell them to rotate it.
4. **Before pushing:** `npx tsc --noEmit` and `npx next build` must pass.
5. **Show, don't guess:** for UI changes, run the app and look at it (Playwright is available) before
   saying it works. Report honestly what was and wasn't tested.
6. **Respect copyright:** no copying other apps' designs or content, paid test questions (Working Genius,
   CliftonStrengths), lyrics we don't have rights to, or paid media.
7. **Costs:** anything that spends money on the owner's accounts (Replicate image/video/stem splitting,
   paid APIs) needs the price stated and the owner's OK first.
8. Commit messages: short, clear, say what changed and why.

## Where things are

- `app/(app)/`: signed-in pages: `plans`, `schedule` (bulk scheduler: fair fill, max weeks in a row,
  needed / not needed per position), `confirmations`, `songs`, `teams`, `people`, `trainings`,
  `strengths` (leaders' dashboard) and `gifts` (each person's assessment results), `me`, `health`, `roster`.
- `app/screen/`, `app/remote/`: lyrics screen for the stage + phone remote (backgrounds, sermon slides).
- `app/tracks/[songId]`: Fusion Tracks (multitrack player: stems, click/guide/count-in, lyrics panel).
- `components/tracks/MultitrackPlayer.tsx`: the audio engine (Web Audio, sample-accurate start).
- `lib/`: shared logic: `fairfill.ts` (scheduling), `songgap.ts` (setlists), `positionNeeds.ts`,
  `assessments.ts`, `sermon.ts` (PDF → slides), `slides.ts`, `chordpro.ts`, `zipUpload.ts`
  (multitrack zips, shrinking big audio), `mp3Align.ts`, `guideTrack.ts`, `tempo.ts`.
- `lib/types.ts`: table types. `supabase/schema.sql` + `supabase/migrations/`: the database.
- Hidden but kept: Planning Center sync (`components/plan/PcoSync.tsx`, `app/api/pco`), Sunday Mode draft
  (`app/sunday/[id]`).

## Limits to remember

- Storage refuses single files over 50 MB; big audio is shrunk to MP3 on the device (`lib/zipUpload.ts`).
- Phones have little memory: Fusion Tracks loads parts a few at a time and uses lighter audio on phones.
