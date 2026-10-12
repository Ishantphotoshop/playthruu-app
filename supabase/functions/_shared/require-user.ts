// Shared guard for the Edge Functions that spend our free quotas (IGDB, SteamGridDB, PSN, cast).
//
// Why this exists: with "Verify JWT" switched on, the platform only checks that the Authorization
// header holds a validly SIGNED token. The public anon key (which is in the website's own code) is
// one of those, so anybody on the internet could call these functions and use up the quotas.
// requireUser() asks the auth service who the token belongs to; the anon key belongs to nobody,
// so it is turned away, and only a signed-in person gets through.
//
// allow() is a small per-person limit kept in the function's memory. It is best effort (each
// running copy of a function keeps its own count), which is plenty to stop one account hammering a
// paid or rate-limited API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function reply(cors: Record<string, string>, status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function roleOf(token: string): string {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return String(JSON.parse(json).role ?? "");
  } catch {
    return "";
  }
}

export async function requireUser(
  req: Request,
  cors: Record<string, string>,
): Promise<{ user: { id: string } } | { error: Response }> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: reply(cors, 401, "Sign in to use this.") };
  // Our own functions calling each other (fetch-cast asks igdb-proxy for a game's name) present the
  // project's secret service key, which only the server has. That is not a person, but it is us.
  // These functions keep "Verify JWT" on, so the platform has already checked the token's signature
  // before this code runs: a token that says role=service_role can only be the project's own key.
  if ((SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) || roleOf(token) === "service_role") {
    return { user: { id: "server" } };
  }
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return { error: reply(cors, 401, "Sign in to use this.") };
    return { user: { id: data.user.id } };
  } catch {
    return { error: reply(cors, 401, "Sign in to use this.") };
  }
}

const hits = new Map<string, number[]>();

// True while `userId` is under `max` calls to `bucket` in the last `windowMs`.
export function allow(userId: string, bucket: string, max: number, windowMs = 60_000): boolean {
  const key = `${bucket}:${userId}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function tooMany(cors: Record<string, string>) {
  return reply(cors, 429, "Too many requests. Wait a moment and try again.");
}
