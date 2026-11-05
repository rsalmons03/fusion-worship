# Fusion Church — Worship Planner

Service planning for Fusion Church: plan Sunday's order of service, keep a song library with
chord charts, schedule teams, and give musicians a stage view on their phone or tablet.

Built on **Next.js (App Router, TypeScript) + Supabase + Vercel**, with email through **Resend**.

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

> Everything here is **brand-new and separate from BC Billing**: its own Supabase project, Resend account, Vercel project and domain. Nothing is shared.

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

### 3. Deploy (Vercel)
1. Import this GitHub repo at [vercel.com/new](https://vercel.com/new).
2. Add the environment variables from `.env.local.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_CHURCH_NAME`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`.
3. Deploy.

### 4. Your domain
1. Buy the domain from any registrar (Cloudflare, Porkbun, Namecheap, …), or buy it inside Vercel
   (**Domains → Buy**), which sets up DNS for you.
2. In Vercel: **Project → Settings → Domains → Add** `fusionchurchservices.cc` (and `www.fusionchurchservices.cc`).
3. At your registrar, add the DNS records Vercel shows you. Usually that's an `A` record for the
   root pointing to Vercel's IP and a `CNAME` for `www` pointing to Vercel. Use the exact
   values Vercel displays. HTTPS is set up automatically once DNS resolves.
4. Set `NEXT_PUBLIC_SITE_URL=https://fusionchurchservices.cc` in Vercel, update the Supabase Site URL and
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
