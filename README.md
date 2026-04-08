# VibeMatch

Production-ready MVP: a **meme-swiping** web app (Tinder-adjacent, not a clone) where users swipe memes to build a **personality vector** from meme tags, see a **vibe archetype** (Chaos Goblin, Wholesome Bean, etc.), then get matched with the **closest opposite-gender profile** from a **demo vibe pool** (15 female + 15 male seeded users), preferring **cosine similarity ≥ 0.7**. Privacy-first: **Supabase Auth with email + password only** (no phone numbers). Stack: **Next.js 14 (App Router)**, **TailwindCSS**, **Framer Motion**, **shadcn-style UI**, **TanStack Query**, **Supabase** (Postgres + Auth + Realtime), deploy on **Vercel**; optional **Railway** cron for meme ingestion.

## Features

- Landing → signup (**male/female**) → **mandatory onboarding** (age 18+, profile photo to Supabase Storage) → swipe → **vibe archetype** after **20 swipes** → **best opposite-gender match** modal with **Text this person** → **realtime chat** with moderation (blocks phones, emails, Instagram/Telegram/WhatsApp patterns).
- **Glass / liquid UI** (`#0b0f19` base, violet–cyan accents), **MemeCard** stack with drag + buttons + **keyboard** (← / →).
- **MatchReveal** modal + **confetti** on first match (per browser).
- **Admin fallback**: `/admin/upload` posts to `/api/admin/memes` with `ADMIN_SECRET`.
- **Worker**: `workers/meme-ingest.mjs` pulls from Reddit `/r/memes/hot` and inserts rows (tags inferred from title/subreddit).
- **PWA-ready**: `public/manifest.json` + metadata; add icons and optional `next-pwa` later.
- **RLS**: users see only themselves; matches only as participant; messages only for match participants.

## Repository layout

```
app/           App Router pages + API routes
components/    UI + MemeCard, SwipeControls, MatchReveal, ChatInterface
lib/           Supabase clients, matching, moderation, React Query provider
hooks/         (extend as needed)
supabase/      schema.sql, seed.sql
workers/       Railway cron meme ingestion
```

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Providers**: enable Email; disable phone if shown.
3. **SQL Editor**: run `supabase/schema.sql` end-to-end. If you already had an older schema, also run `supabase/migration_002_profile_demo.sql`.
4. **Optional memes seed**: run `supabase/seed.sql` for placeholder memes (picsum images).
5. **Demo match pool (30 fake opposite-gender profiles)**: from the project root, with `SUPABASE_SERVICE_ROLE_KEY` set, run `npm run seed:demo`. This creates auth users `demo-f-01@vibematch.demo` … `demo-m-15@vibematch.demo` with photos (randomuser.me), ages, and personality vectors. Re-run safe: it upserts existing emails.
6. **Realtime** (for chat live updates): **Database → Replication** (or SQL) — add table `public.messages` to the `supabase_realtime` publication.
7. **Auth → URL configuration**: add your local and production URLs:
   - Site URL: `http://localhost:3000` (dev) and your Vercel URL (prod).
   - Redirect URLs: include `http://localhost:3000/auth/callback` and `https://YOUR_DOMAIN/auth/callback`.

## 2. Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Where |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → **anon** `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → **service_role** key (server-only; never expose to the client) |
| `ADMIN_SECRET` | Long random string; required for `/api/admin/memes` and the local admin upload UI |

## 3. Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up, finish **profile onboarding** (photo + age), then swipe. After 20 swipes you get a **vibe archetype** and your **closest opposite-gender demo match** (requires `npm run seed:demo`). Matching uses **male ↔ female** only for real users.

## 4. API routes

| Route | Purpose |
|-------|---------|
| `GET /api/memes` | Next memes for the feed (excludes already swiped) |
| `POST /api/swipe` | Record swipe; recompute vector after 20; run matcher |
| `GET /api/match` | List matches (peer email enriched server-side) |
| `GET/POST /api/messages` | List/send messages (POST runs moderation) |
| `GET/PATCH /api/profile` | Current user + swipe count + archetype; complete profile (photo URL, age, gender) |
| `POST /api/admin/memes` | Insert meme (`x-admin-secret` header) |

## 5. Deploy frontend (Vercel)

1. Push this repo to GitHub/GitLab/Bitbucket.
2. **Import** the repo in [Vercel](https://vercel.com).
3. Set the same env vars as in `.env.example` (use **Production** and **Preview** as needed).
4. Deploy. Update Supabase Auth redirect URLs with your Vercel domain.

## 6. Worker (Railway cron)

1. Create a **Railway** project from the same repo (or deploy a **cron** service).
2. **Variables**: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (same as server).
3. **Start command**: `npm install && npm run worker:ingest` (or `node workers/meme-ingest.mjs` after install).
4. **Cron schedule** (example): `0 3 * * *` (daily 03:00 UTC).

The worker fetches Reddit JSON; respect Reddit’s terms and rate limits in production (caching, backoff, or curated sources).

## 7. Security notes

- Never commit `.env.local` or the **service role** key.
- RLS policies assume clients use the **anon** key; server routes that need broad reads use the **service role** only after session checks.
- Tune `lib/moderation.ts` regexes for your jurisdiction and product policy.

## 8. React Native later

Keep API contracts stable (`/api/*` JSON), share **types** (`PersonalityVector`, DTOs), and reuse Supabase client + Realtime on mobile.

## Scripts

| Script | Command |
|--------|---------|
| Dev | `npm run dev` |
| Build | `npm run build` |
| Worker | `npm run worker:ingest` |
| Demo users (30) | `npm run seed:demo` |

---

MIT — adjust license as needed.
