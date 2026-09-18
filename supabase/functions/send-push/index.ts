// SEND PUSH — delivers one notification to a user's subscribed devices.
//
// This is the piece that makes a notification arrive on a phone with
// Playthruu fully closed. Everything before it depended on the app being
// alive: the realtime subscription is a WebSocket inside the page, so a
// killed tab (or an app swiped out of recents) has no WebSocket and
// therefore no notification. A Web Push subscription is different — it
// belongs to the browser's own push service, not to the page, so it
// outlives the tab entirely. The service worker wakes up, gets the
// payload, and posts the notification.
//
// Called by a trigger on public.notifications (see
// migrations/2026-09-18_web_push.sql), never by a browser. It is
// authenticated with a shared secret rather than the service-role key,
// deliberately: the trigger needs SOMETHING to prove it is the trigger,
// and a purpose-made secret that can only cause a push to be sent is a
// far smaller thing to leak into the database than a key that can do
// anything to any table.
//
// Setup:
//   supabase secrets set VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
//   supabase secrets set PUSH_HOOK_SECRET=...
//   supabase functions deploy send-push --no-verify-jwt
//
// --no-verify-jwt is required: the caller is Postgres, which has no user
// JWT to present. The shared-secret check below is what takes its place,
// and it runs before anything else happens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")
  ?? "BC3Rag_ehGUNwBxY64oggTk0-6__lusChtIe7keeyyZUAwXmtMze1hLdn9rlQOY0uB9pXvurZYM7OdTZBDMabvo";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:as4142509@gmail.com";
const PUSH_HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// What each kind of notification says on the lock screen. Deliberately
// the actor's name plus a plain verb phrase — a notification is read in
// about a second, and anything cleverer than "X liked your review" costs
// more than it adds.
function describe(kind: string, actor: string, gameTitle: string | null, commentBody: string | null) {
  switch (kind) {
    case "follow":
      return { title: "New follower", body: `${actor} started following you` };
    case "like":
      return {
        title: "Playthruu",
        body: gameTitle ? `${actor} liked your review of ${gameTitle}` : `${actor} liked your review`,
      };
    case "comment":
      return {
        title: `${actor} commented`,
        body: commentBody ? commentBody.slice(0, 140) : "They commented on your review",
      };
    case "message":
      return { title: actor, body: "Sent you a message" };
    default:
      return { title: "Playthruu", body: "Something happened" };
  }
}

// Where tapping it should land.
function routeFor(kind: string, row: Record<string, unknown>) {
  if (kind === "message" && row.conversation_id) return `#/messages/${row.conversation_id}`;
  if ((kind === "like" || kind === "comment") && row.log_id) return `#/review/${row.log_id}`;
  return "#/notifications";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The only thing standing between this and the open internet, so it is
  // checked first and the failure says nothing useful.
  if (!PUSH_HOOK_SECRET || req.headers.get("x-push-secret") !== PUSH_HOOK_SECRET) {
    return json({ error: "Not allowed" }, 401);
  }
  if (!VAPID_PRIVATE_KEY) return json({ error: "Push is not configured" }, 500);

  let payloadIn: { notification_id?: string };
  try {
    payloadIn = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const notificationId = payloadIn.notification_id;
  if (!notificationId) return json({ error: "notification_id is required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Read the row back rather than trusting the body: the trigger sends
  // only an id, so there is nothing to forge, and the joined actor name
  // and game title are needed anyway.
  const { data: row, error: rowErr } = await admin
    .from("notifications")
    .select(`
      id, user_id, kind, log_id, comment_id, conversation_id,
      actor:profiles!notifications_actor_id_fkey(display_name, username),
      log:logs!notifications_log_id_fkey(games!logs_game_id_fkey(title)),
      comment:comments!notifications_comment_id_fkey(body)
    `)
    .eq("id", notificationId)
    .single();
  if (rowErr || !row) return json({ error: "No such notification" }, 404);

  // The per-kind mute switches are already honoured by the trigger that
  // wrote this row, so a muted kind never gets here. `push` is separate:
  // it is about this delivery channel, not about the event.
  const { data: profile } = await admin
    .from("profiles")
    .select("notification_prefs")
    .eq("id", row.user_id)
    .single();
  const prefs = (profile?.notification_prefs ?? {}) as Record<string, boolean>;
  if (prefs.push !== true) return json({ skipped: "push is off for this user" });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", row.user_id);
  if (!subs?.length) return json({ skipped: "no subscriptions" });

  const actorName = (row.actor as { display_name?: string; username?: string } | null)?.display_name
    ?? (row.actor as { username?: string } | null)?.username
    ?? "Someone";
  const gameTitle = ((row.log as { games?: { title?: string } } | null)?.games?.title) ?? null;
  const commentBody = ((row.comment as { body?: string } | null)?.body) ?? null;
  const { title, body } = describe(row.kind as string, actorName, gameTitle, commentBody);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const message = JSON.stringify({
    title,
    body,
    // One notification per kind, so five likes replace each other in the
    // shade instead of stacking into a wall.
    tag: `playthruu-${row.kind}`,
    route: routeFor(row.kind as string, row as Record<string, unknown>),
    // The Sound switch is the one part of the tone the app gets to
    // decide; everything else belongs to the phone's own settings.
    silent: prefs.sound === false,
  });

  const results = await Promise.allSettled(subs.map((s) =>
    webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      message,
      { TTL: 60 * 60 * 12 },
    )
  ));

  // A push service answers 404 or 410 for a subscription that no longer
  // exists — the app was uninstalled, or site data was cleared. Those are
  // permanent, so the row is removed rather than retried forever; every
  // other failure is left alone because it may well be transient.
  const dead: string[] = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") { sent += 1; return; }
    const status = (r.reason as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) dead.push(subs[i].endpoint);
  });
  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("endpoint", dead);
  }

  return json({ sent, failed: results.length - sent, pruned: dead.length });
});
