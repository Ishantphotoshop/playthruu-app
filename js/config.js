// ============================================================
// PLAYTHRUU CONFIG — paste your own Supabase project details here
// ============================================================
// Where to find these:
//   Supabase dashboard → your project → Project Settings → API
//   - "Project URL"            → SUPABASE_URL
//   - "anon" / "public" key    → SUPABASE_ANON_KEY
//     (newer Supabase dashboards may label this "publishable key" —
//     same thing, use that one, NOT the "service_role" / "secret" key)
//
// This key is meant to be public — it's safe to ship in the app.
// Your data is protected by the Row Level Security rules in
// schema.sql, not by hiding this key.
// ============================================================

export const SUPABASE_URL = "https://kpgjuuplpgilupogpezc.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwZ2p1dXBscGdpbHVwb2dwZXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMDgwOTAsImV4cCI6MjEwMTU4NDA5MH0.39cjFgmgBquORUSY00vWOeuAhI3nPYIOAhQhREq9OF8";
// Powers game search (so typing "Zelda" finds it, like Letterboxd finds a
// film) using IGDB — real portrait cover art, screenshots, and studio
// credits, all in one source. Unlike RAWG, IGDB requires a Client Secret
// to authenticate, which must never sit in client-side code like this
// file. So there's nothing to paste here: the app calls a Supabase Edge
// Function (supabase/functions/igdb-proxy) that holds the secret
// server-side and proxies requests to IGDB on the app's behalf.
//
// One-time setup (see README.md for full steps):
//   1. Register a free app at https://dev.twitch.tv/console/apps to get
//      a Client ID + Client Secret.
//   2. supabase functions deploy igdb-proxy
//   3. supabase secrets set TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=...
//
// Until that's done, IGDB calls quietly return no results — your own
// catalog (games people have already added) still searches fine.

// Fallback source, used only when IGDB comes up short on a search (it
// has real gaps on smaller/indie titles). Ishan's own dedicated key
// (rawg.io/apidocs) as of 2026-08-18 — replaces the old shared key from
// before the IGDB migration, so this app no longer shares a rate limit
// with anyone else's.
export const RAWG_API_KEY = "b0c4599765444b5e9207260042c05ed1";

// Powers the GIF picker in the messenger (developers.giphy.com — free,
// no billing needed at this scale). Tenor was the original plan but
// Google discontinued it in mid-2026, so this is GIPHY's direct
// replacement instead.
export const GIPHY_API_KEY = "K9tBeFhMg4uYiafTHTgaxW9Luipq6kIP";
