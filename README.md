# Fusion Church — Worship Planner

Service planning for Fusion Church: plan Sunday's order of service, keep a song library with
chord charts, schedule teams, and give musicians a stage view on their phone or tablet.

Built on **Next.js (App Router, TypeScript) + Supabase + Cloudflare Workers**, with email through **Resend**.

## What it does

- **Plans**: one per service. Build the order of service from songs, items (welcome, sermon,
  offering…) and section headers. Set durations and the start time to get a running clock.
  Pick the key for each song. Start a new plan by copying an earlier one. Print it.
- **Song library**: title, author, key, BPM, meter, CCLI #, themes, reference link, and lyrics +
  chords in ChordPro (`[G]Amazing [D/F#]grace`). Live preview, transpose to any key, print,
  and a history of every service the song was used in.
- **Teams & scheduling**: teams (Worship Band, Production, …) with positions (Keys, Sound, …),
  each with a roster. On a plan, schedule people per position (rosters listed first, block-outs
  flagged), then **Send requests** to email everyone a "Can you serve?" link with
  Accept / Decline, no login needed. Status shows on the plan: Not sent, Pending, Confirmed, Declined.
- **Stage view** (`/live/<plan>`): full-screen, dark by default. Swipe through the set with
  Prev/Next or the arrow keys, transpose on the fly, hide chords for vocalists, and change the font size.
- **My Profile**: name/phone, block-out dates, serving history.
- **People** (admins): approve sign-ups, add people, set roles.

## Roles

| Role | Can |
| --- | --- |
| `admin` | Everything, including people and roles |
| `leader` | Edit plans, songs, teams and schedules; send requests |
| `member` | View everything; accept/decline own requests; own block-outs |
| `pending` | Nothing until an admin approves them |

The **first account to sign in becomes admin**. Everyone after that starts as `pending`.
Rules are enforced in Postgres with Row-Level Security (`supabase/schema.sql`), not just in the UI.

## Setup

> Everything here is **brand-new and separate from BC Billing**: its own Supabase project, Resend account, Cloudflare Worker and domain. Nothing is shared.

### 1. Supabase (database + login)
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste all of `supabase/schema.sql` and **Run**. It's safe to re-run.
   It also creates a "Sunday Morning" service type and starter Worship Band / Production teams.
3. **Authentication → URL Configuration**:
   - Site URL: `https://fusionchurchservices.cc`
   - Redirect URLs: add `https://fusionchurchservices.cc/auth/callback` (and
     `http://localhost:3000/auth/callback` for local dev).
4. **Project Settings → API**: copy the Project URL, the `anon` key and the `service_role` key.

### 2. Email (Resend)
1. Create an account at [resend.com](https://resend.com), add your domain, and add the DNS
   records it shows you. They verify that you own the domain.
2. Create an API key → this is `RESEND_API_KEY`. `EMAIL_FROM` must use the verified domain,
   e.g. `Worship Team <worship@fusionchurchservices.cc>`.
3. Recommended: send Supabase's sign-in emails through Resend too, because Supabase's built-in
   mailer allows only a few emails per hour. In Supabase go to **Authentication → Emails → SMTP
   Settings** and enter host `smtp.resend.com`, port `465`, username `resend`, password = your
   Resend API key, and sender = your `EMAIL_FROM` address.

### 3. Deploy (Cloudflare Workers)
The app runs on Cloudflare Workers through the [OpenNext](https://opennext.js.org/cloudflare) adapter.
1. In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, and pick this repo.
2. Build settings:
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
3. Add the variables from `.env.local.example` under **Settings → Variables and Secrets** *and*
   under **Settings → Build → Variables and secrets** (`NEXT_PUBLIC_*` values are baked in at build
   time). Make `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` the **Secret** type.
4. Deploy. The site appears at `fusion-worship.<your-account>.workers.dev`.

To deploy from your own computer instead: `npx wrangler login`, then `npm run deploy`.

### 4. Your domain
1. Add the domain to Cloudflare (buy it under **Domains → Register**, or transfer it in).
2. In the Worker: **Settings → Domains & Routes → Add → Custom domain** → `fusionchurchservices.cc`
   (and `www.fusionchurchservices.cc`). Cloudflare sets up DNS and HTTPS for you.
3. Set `NEXT_PUBLIC_SITE_URL=https://fusionchurchservices.cc`, update the Supabase Site URL and
   Redirect URL (step 1.3), and redeploy.

### 5. First run
Open the site, sign in with your email, and you're the admin. Then:
**Teams** → add people to rosters · **Songs** → add your songs · **Plans** → create Sunday's plan.
Add people under **People**, or have them sign in themselves and approve them there.

## Local development
```bash
cp .env.local.example .env.local   # fill in values
npm install
npm run dev                         # http://localhost:3000
```

## Lyrics licensing
Storing and displaying song lyrics for your team is generally covered by your church's
CCLI Church Copyright License (and printing charts by a CCLI/SongSelect subscription). Record
each song's CCLI number in the library.
