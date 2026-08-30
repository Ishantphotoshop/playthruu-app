# Playthruu

A Letterboxd-style diary for video games — log what you play, rate it,
review it, follow friends, build lists. Runs as a normal website, installs
on your phone like an app, and can be packaged into a real `.apk`.

No build tools, no npm install, no server code to write. It's plain
HTML/CSS/JS talking directly to a free [Supabase](https://supabase.com)
project (Postgres database + accounts, done for you).

**Total setup time: ~15 minutes**, almost all of it clicking around two
websites (Supabase and GitHub). Follow the steps in order.

**What's in the app:** accounts and profiles, a diary with ratings and
written reviews, a want-to-play list, custom lists, following/followers,
a Top 5 favorites showcase, a per-user ratings breakdown chart, a home
feed with trending and "Friends Are Playing" carousels, and a filterable
Discover screen (genre, platform, release date, rating, singleplayer/
multiplayer, developer, publisher). Game pages show release date,
platforms, genre, developer, publisher, a spoiler-light synopsis, and a
clickable developer studio with its own mini profile page (logo, blurb,
and the rest of their catalog). Settings covers personal info (including pronouns), a
comment-privacy preference, password changes, and a real profile-photo
upload from your camera or gallery.

---

## What's in this folder

```
index.html                          the app
css/styles.css                       all styling
js/                                  app code (plain ES modules, no bundler needed)
  config.js                           ← you paste your Supabase project details here (step 2)
supabase/functions/igdb-proxy/       Edge Function that talks to IGDB (step 3)
supabase/functions/news-proxy/       Edge Function that merges gaming RSS feeds (step 3b)
manifest.json                       makes it installable as an app
service-worker.js                   offline caching
icons/                               app icons
schema.sql                           ← you paste this into Supabase (step 1)
```

---

## Step 1 — Create your database (5 min)

1. Go to [supabase.com](https://supabase.com) → sign up (free, no credit
   card) → **New project**. Pick any name/region/password (save the
   password somewhere, you won't need it for the app itself).
2. Wait ~2 minutes for the project to finish provisioning.
3. In the left sidebar, open the **SQL Editor** → **New query**.
4. Open `schema.sql` from this folder, copy the whole file, paste it in,
   click **Run**. This creates every table, security rule, and the
   trigger that sets up a profile when someone signs up.

That's your entire backend. Nothing else to install or configure.

## Step 2 — Connect the app to your database (2 min)

1. In Supabase: **Project Settings** (gear icon) → **API**.
2. Copy the **Project URL** and the **anon / public** key (older
   dashboards call it "anon key", newer ones "publishable key" — same
   thing; don't use the "service_role / secret" key, that one's private).
3. Open `js/config.js` in this folder and paste them in:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
4. Save the file.

**Optional but recommended for a personal/friends app:** Supabase asks
new users to confirm their email by default. To skip that friction, go to
**Authentication → Sign In / Providers → Email** and turn off "Confirm
email". You can always turn it back on later.

## Step 3 — Turn on game search (10 min)

Without this step, the "search for a game" box only finds games someone
in your app has already typed in by hand — it starts empty, so search
looks broken on day one. This step connects it to **IGDB**, so typing
"Zelda" finds it immediately (with a real portrait cover, screenshots,
and developer studio credit), the same way Letterboxd already knows
every film.

IGDB requires a Client Secret to authenticate, and secrets can never sit
in client-side code — so instead of pasting a key into `config.js` like
before, this step deploys a small server-side proxy (a Supabase Edge
Function) that holds the secret and talks to IGDB on the app's behalf.

1. **Get IGDB credentials.** Go to
   [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) →
   sign in with (or create) a Twitch account. Twitch requires
   **two-factor authentication** on the account before it'll let you
   register an app — if you don't have it on yet, go to your Twitch
   Security and Privacy settings, turn on 2FA, then come back here.
   Once that's done: **Register Your Application**. Name: anything
   unique. OAuth Redirect URL: `http://localhost` (unused here, but
   required to fill in). Category: "Application Integration" or
   "Other". Click **Create**, then open it and copy the **Client ID**,
   and click **New Secret** to get a **Client Secret**.
2. **Install the Supabase CLI** (one-time, if you don't have it). From
   this project folder:
   ```bash
   npm install supabase --save-dev
   ```
   (There's no global `npm install -g supabase` — the CLI only installs
   per-project this way, so every command below is run with `npx` in
   front of it. Mac/Linux users with Homebrew can instead run
   `brew install supabase/tap/supabase` for a global `supabase` command
   and can drop the `npx` prefix everywhere below.)
3. **Log in and link this project:**
   ```bash
   npx supabase login
   npx supabase link --project-ref your-project-ref
   ```
   Your project ref is the random string in your Supabase Project URL
   (`https://your-project-ref.supabase.co`).
4. **Deploy the function and set your secrets**, from this folder:
   ```bash
   npx supabase functions deploy igdb-proxy
   npx supabase secrets set TWITCH_CLIENT_ID=your_client_id TWITCH_CLIENT_SECRET=your_client_secret
   ```

That's it — no changes to `config.js` needed. Game search, Discover
filters, trending, and studio pages all go through this function now.
Without it deployed (or without the secrets set), those features quietly
return no results — your own catalog (games people have already added)
still searches fine.

*(The Supabase CLI needs Node.js 20 or later — if `npx supabase login`
just hangs or errors oddly, run `node -v` and update Node first.)*

If you already have a live Playthruu project running on RAWG, also run
`migrations/2026-07-29_igdb_migration.sql` in Supabase's SQL Editor once
— it's additive, so nothing already in your catalog breaks.

To let people log in with their username instead of just their email,
also run `migrations/2026-08-06_username_login.sql` once in the SQL
Editor. Without it, logging in by username will show "No account found"
even for real accounts — email login still works fine either way.

## Step 3b — Turn on the News tab (2 min)

The News tab shows gaming headlines pulled from a handful of outlets
(IGN, GameSpot, Eurogamer, PC Gamer, Kotaku) via their public RSS feeds.
Unlike IGDB, there's no account to make and no secret to store — the
proxy just merges public feeds server-side (their CORS policy blocks a
browser from fetching them directly, which is the only reason a proxy is
needed at all). If you already did Step 3's CLI setup, this is one command:

```bash
npx supabase functions deploy news-proxy
```

Without it deployed, the News tab shows "Couldn't load news right now" —
nothing else in the app is affected.

## Step 4 — Try it locally

Browsers block ES modules from loading via a plain double-clicked HTML
file, so you need a tiny local server (not a real deployment, just for
testing):

```bash
cd questlog
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Sign up, search for a
game, log it, rate it, poke around. (No Python? Any static server works —
VS Code's "Live Server" extension, `npx serve`, etc.)

## Step 5 — Put it online

The app needs to live at a real URL for two reasons: so you (and friends)
can use it from anywhere, and because the APK step below requires one.
**GitHub Pages** is the easiest free option:

1. Create a new GitHub repo (public or private both work) and push this
   whole folder to it.
2. Repo → **Settings → Pages** → under "Build and deployment", set
   **Source: Deploy from a branch**, branch **main**, folder **/ (root)**
   → **Save**.
3. After a minute, GitHub shows your live URL:
   `https://yourusername.github.io/your-repo-name/`

Netlify or Cloudflare Pages work just as well if you'd rather drag-and-drop
the folder onto a webpage instead of using git — search "Netlify Drop" for
the no-account version.

## Step 6 — Get it on your phone

**Fastest option — no extra tools, works right now:**
Open your GitHub Pages URL in Chrome on your phone → menu → **Add to Home
screen** (Android) or Safari → Share → **Add to Home Screen** (iPhone). It
now behaves like an installed app: its own icon, full screen, no browser
bar. This is a real PWA install, not a shortcut — most people can stop
here.

**A real, sideloadable `.apk` file:**
1. Go to [pwabuilder.com](https://pwabuilder.com).
2. Paste your GitHub Pages URL, click **Start**.
3. It reads your `manifest.json`/`service-worker.js` and scores the app —
   it should come back green. Click **Package for stores** → **Android**.
4. Leave the defaults (it uses Google's own Bubblewrap tool under the
   hood to build a signed package) → **Generate** → download the zip,
   which contains an `.apk` you can install directly and an `.aab` for
   the Play Store later if you ever want that.
5. On your phone: download the `.apk`, tap it, allow "install from
   unknown sources" if asked. Done — it's a real app in your app drawer.

Keep the signing key PWABuilder gives you if you think you'll ever
update the app through the same listing.

---

## Notes

- **This is a shared app, not a demo.** Anyone who signs up on your URL
  gets their own account and their own private/public entries, governed
  by the row-level-security rules in `schema.sql` — public reviews are
  visible to everyone, private diary entries only to their owner.
- **Changing the look:** all colors, fonts, and spacing are CSS variables
  at the top of `css/styles.css`. The app icon is generated by whatever
  is in `icons/` — replace those PNGs (192×192 and 512×512, plus the
  `-maskable-` versions with extra padding) to rebrand it.
- **Cost:** Supabase's free tier (500MB database, 50k monthly active
  users) comfortably covers personal or friend-group use. GitHub Pages is
  free with no limits that matter here.
- **Known v1 limits, easy to extend later:** comments on reviews have a
  privacy *setting* (Settings → Privacy) but posting/reading comments
  isn't built yet — only likes work today. No OAuth/social login
  (email+password only). No push notifications. The database schema and
  code are small and readable on purpose so you (or an AI assistant) can
  extend them.
- **RAWG's free tier requires attribution** — the app credits "Game data
  via RAWG.io" with a link on the Settings page (kept off the search
  results themselves to keep those clean). Free tier covers up to 100k
  monthly users, far more than personal/friend-group use needs.
- **QR codes** are generated by a free, no-signup image endpoint
  (api.qrserver.com) — nothing to configure, but it does mean showing a
  QR code requires internet access, same as the RAWG search does.
- **Sharing a profile** uses your phone's native share sheet
  (`navigator.share`) — Instagram, Messages, WhatsApp, whatever's
  installed shows up there automatically. Apps can't post directly into
  Instagram without Instagram's own developer approval, so the share
  sheet is the standard, honest way to get a link into any app,
  Instagram included. On desktop browsers without share-sheet support,
  it copies the link to your clipboard instead.

## If you set this app up before July 22, 2026

Several new features need database changes your existing project
doesn't have yet: precise release dates, developer/studio, publisher, a
cached synopsis, credited-director info, average playtime, a trailer
link, a real portrait cover slot, a player count, pronouns, a
comment-privacy preference, a Top 5 favorites table, and a Storage
bucket for uploaded profile photos.

Open Supabase's **SQL Editor** and run the **"MIGRATION FOR EXISTING
PROJECTS"** block near the bottom of `schema.sql` (copy from that
heading to the end of the file) every time you pull an update. It's
safe to run more than once — everything in it uses `if not exists` /
`on conflict do nothing` guards, so re-running it after you've already
applied it just does nothing on the parts you have. This same block is
also the fix if the app ever throws *"Could not find the 'x' column of
'games' in the schema cache"* — its last line forces PostgREST to
refresh its cache immediately instead of waiting.

