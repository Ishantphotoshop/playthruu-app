import { supabase } from './supabase-client.js';
import { onAuthChange, signOut, updatePasswordAfterReset } from './auth.js';
import * as api from './api.js';
import { state, cachedProfile } from './state.js';
import { route, setNotFound, startRouter, navigate, refreshCurrentView, pageEl, historyDepth, resetPages, trackOverlays, onOverlayEntry } from './router.js';
import { renderLandingView, seedPinnedGames } from './views/landing-view.js';
import { renderAuthView } from './views/auth-view.js';
import { renderFeedView } from './views/feed-view.js';
import { renderSearchView } from './views/search-view.js';
import { renderDiscoverView, warmDiscover } from './views/discover-view.js';
import { renderListDetailView } from './views/lists-view.js';
import { renderMessagesView } from './views/messages-view.js';
import { MESSENGER_ARCHIVED } from './config.js';
import { renderMessageThreadView } from './views/message-thread-view.js';
import { renderProfileView, warmOwnProfile } from './views/profile-view.js';
import { renderConnectionsView } from './views/connections-view.js';
import { renderActivityView } from './views/activity-view.js';
import { renderTrendingView } from './views/trending-view.js';
import { renderFriendsPlayingView } from './views/friends-playing-view.js';
import { renderCurrentlyPlayingView } from './views/currently-playing-view.js';
import { renderLogListView } from './views/log-list-view.js';
import { renderGameView } from './views/game-view.js';
import { renderGameReviewsView } from './views/game-reviews-view.js';
import { renderReviewView } from './views/review-view.js';
import { renderPersonView } from './views/person-view.js';
import { renderDirectorView } from './views/director-view.js';
import { renderStudioView } from './views/studio-view.js';
import { renderSettingsView } from './views/settings-view.js';
import { renderNotificationsView } from './views/notifications-view.js';
import { openLogComposer } from './views/log-composer.js';
import { toast, qs, promptSignIn } from './utils.js';
import { buzz } from './haptics.js';
import { clearViewCache, setCached, getCached, CACHE_KEYS } from './cache.js';
import { iconClose, iconLock } from './components.js';

const appEl = document.getElementById('app');
let routesRegistered = false;
let publicRoutesRegistered = false;

// One-time dev utility: sign in, open the browser console, run
// `await seedLoginBackdrops()` once. Adds every login-screen backdrop
// credit to the catalogue so its "Art from X" link works for everyone
// afterward, signed in or not — see the comment on seedLoginBackdropGames
// in api.js for why this needs to run signed in at all.
window.seedLoginBackdrops = api.seedLoginBackdropGames;
// Same idea, for the signed-out Games tab's pinned titles (see the
// comment on seedPinnedGames in landing-view.js) — most of those are
// upcoming/just-announced, so tapping one hit an unnecessary sign-up
// prompt until it's been added once. Run: `await seedPinnedGames()`.
window.seedPinnedGames = seedPinnedGames;

// A small number on the Messages nav icon for "you have N unread
// conversations". navBar() itself stays synchronous and side-effect
// free — every view calls it as part of a plain template string — so
// the badge is applied here instead, as a class + data attribute on
// whatever [data-route="/messages"] element currently exists. That
// element gets torn down and rebuilt on every single navigation
// (navBar() re-renders as part of each view), which is why this
// re-applies on every hashchange rather than once: the count itself
// only needs recomputing when a conversation actually changes (via the
// realtime subscription below), but the class/attribute have to be
// reapplied to a fresh DOM node every time the view underneath it swaps.
let unreadMessageCount = 0;
let unsubscribeConversations = null;

function applyMessageBadge() {
  document.querySelectorAll('.tabbar [data-route="/messages"]').forEach((el) => {
    el.classList.toggle('tabbar__item--badge', unreadMessageCount > 0);
    if (unreadMessageCount > 0) el.setAttribute('data-badge-count', unreadMessageCount > 99 ? '99+' : String(unreadMessageCount));
    else el.removeAttribute('data-badge-count');
  });
}

async function refreshMessageBadge() {
  if (!state.user) return;
  try {
    const convos = await api.getConversations(state.user.id);
    unreadMessageCount = convos.filter((c) => c.unread || (c.status === 'pending' && c.requested_by !== state.user.id)).length;
    // This exact list is what the Messages tab paints from, and it's
    // already in hand here for the badge — handing it to the view cache
    // means opening Messages for the first time paints instantly off it
    // instead of showing a spinner while refetching what we just had.
    // Costs nothing: no extra request, just not throwing the result away.
    setCached(CACHE_KEYS.messages, convos);
  } catch {
    // Transient failure — keep showing the last known count rather than
    // flickering the badge off over a single dropped request.
  }
  applyMessageBadge();
}

// The bell's own unread count, kept exactly the way the Messages badge
// above is and for the same reason: navBar() and topBar() are both
// synchronous template strings that every view re-renders, so the count
// lives here and is re-applied to whatever bell element currently exists
// on each navigation.
let unreadNotifCount = 0;
let unsubscribeNotifications = null;
// Preferences are read once per session and cached here so the realtime
// handler can decide how to announce something without a round trip on
// every single notification.
let notifPrefs = api.NOTIFICATION_PREF_DEFAULTS;

// Announces something in the phone's own notification shade rather than
// in the page, and only when the app is not the thing you are looking at
// - a banner for something already on screen is just a second copy of it.
//
// There is deliberately no app-specific sound any more. A notification
// tone is a setting people have already made on their phone, often
// carefully (silent at work, one particular tone they recognise), and an
// app that substitutes its own is overriding a decision that was never
// its to make. Both paths below therefore ask for the SYSTEM default:
// `silent: false` on the web Notification, and the default sound on the
// Android channel. The Sound switch in Settings chooses between that
// default and no sound at all, which is the only part of this the app
// has any business deciding.
const NOTIF_TEXT = {
  follow: 'started following you',
  like: 'liked your review',
  comment: 'commented on your review',
  message: 'sent you a message',
};

function maybeSystemNotify(row) {
  if (document.visibilityState === 'visible') return;
  const body = NOTIF_TEXT[row?.kind] || 'Something happened';
  const tag = `playthruu-${row?.kind || 'x'}`;

  // The Android shell is a Trusted Web Activity now, so the page runs in
  // Chrome and the plain Web Notification below is already a real system
  // notification there - delegated to Playthruu, with its icon and its
  // own entry in Android's notification settings. This bridge check is
  // what the earlier WebView build needed instead (a WebView cannot post
  // to the shade at all); it is kept because it costs nothing and is the
  // only thing that would have to come back if the shell ever did.
  const native = window.PlaythruuNative;
  if (native?.notify) {
    try {
      native.notify('Playthruu', body, tag, !!notifPrefs.sound);
      return;
    } catch {
      // Fall through to the web path rather than going silent.
    }
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Playthruu', {
      body,
      icon: 'icons/icon-192.png',
      // One banner per kind rather than a stack of five identical ones.
      tag,
      // false asks for whatever tone the phone is already set to.
      silent: !notifPrefs.sound,
    });
    n.onclick = () => {
      window.focus();
      navigate('/notifications');
      n.close();
    };
  } catch {
    // Some browsers throw on the Notification constructor when the page
    // is controlled by a service worker; the badge already covers it.
  }
}

function applyNotifBadge() {
  document.querySelectorAll('[data-route="/notifications"]').forEach((el) => {
    // Two different homes for this element now that the messenger's old
    // tab slot is also a notifications bell: the tab bar has its own
    // badge class, already tuned for that exact 58x50 icon spot (it was
    // built for the messages badge this replaced); the topbar bell on
    // Feed keeps its own.
    const badgeClass = el.closest('.tabbar') ? 'tabbar__item--badge' : 'topbar__bell--badge';
    el.classList.toggle(badgeClass, unreadNotifCount > 0);
    if (unreadNotifCount > 0) el.setAttribute('data-badge-count', unreadNotifCount > 99 ? '99+' : String(unreadNotifCount));
    else el.removeAttribute('data-badge-count');
  });
}

async function refreshNotifBadge() {
  if (!state.user) return;
  try {
    unreadNotifCount = await api.getUnreadNotificationCount(state.user.id);
  } catch {
    // Same call as the message badge makes: keep the last known count
    // rather than flickering to zero over one dropped request.
  }
  applyNotifBadge();
}

// A signed-out visitor can genuinely browse game pages, search, and
// Discover's filters (see landing-view.js) — these are the only routes
// that work without a session, registered separately from the protected
// set below and reachable before anyone ever logs in. Idempotent
// (guarded), so it's safe to call again from registerRoutes() once
// someone does.
function registerPublicRoutes() {
  if (publicRoutesRegistered) return;
  publicRoutesRegistered = true;
  route('/game/:id', (p) => renderGameView(pageEl(), p));
  // Viewing a game that isn't in the catalogue yet — see the note on
  // renderGameView's `igdbId` mode in game-view.js for why this exists
  // as its own route rather than reusing /game/:id.
  route('/game/igdb/:igdbId', (p) => renderGameView(pageEl(), { igdbId: Number(p.igdbId) }));
  route('/search', () => renderSearchView(pageEl()));
  route('/discover', () => renderDiscoverView(pageEl()));
  // What the Search tab's funnel opens: the filters themselves, not a
  // page of popular games with the filters hidden behind a second tap.
  route('/discover/filters', () => renderDiscoverView(pageEl(), { openFilters: true }));
}

function registerRoutes() {
  if (routesRegistered) return;
  routesRegistered = true;
  registerPublicRoutes();
  route('/feed', () => renderFeedView(pageEl()));
  route('/news', () => renderFeedView(pageEl(), { initialTab: 'news' }));
  route('/trending', () => renderTrendingView(pageEl()));
  route('/friends-playing', () => renderFriendsPlayingView(pageEl()));
  route('/currently-playing', () => renderCurrentlyPlayingView(pageEl()));
  route('/list/:id', (p) => renderListDetailView(pageEl(), p));
  // The inbox and threads tear their realtime subscriptions down the
  // moment you leave them, so they are rebuilt on every visit instead of
  // being kept in the back stack (a kept copy would be a dead one).
  route('/messages', () => renderMessagesView(pageEl()), { keep: false });
  route('/messages/new/:userId', (p) => renderMessageThreadView(pageEl(), { otherUserId: p.userId }), { keep: false });
  route('/messages/:id', (p) => renderMessageThreadView(pageEl(), { conversationId: p.id }), { keep: false });
  route('/me', () => renderProfileView(pageEl(), { username: state.profile.username }));
  route('/profile/:username', (p) => renderProfileView(pageEl(), p));
  route('/profile/:username/followers', (p) => renderConnectionsView(pageEl(), { username: p.username, kind: 'followers' }));
  route('/profile/:username/following', (p) => renderConnectionsView(pageEl(), { username: p.username, kind: 'following' }));
  route('/profile/:username/activity', (p) => renderActivityView(pageEl(), p));
  route('/profile/:username/log-list/:mode', (p) => renderLogListView(pageEl(), p));
  route('/game/:id/reviews', (p) => renderGameReviewsView(pageEl(), p));
  route('/review/:id', (p) => renderReviewView(pageEl(), p));
  route('/person/:qid', (p) => renderPersonView(pageEl(), p));
  route('/director/:slug', (p) => renderDirectorView(pageEl(), p));
  route('/studio/:companyId', (p) => renderStudioView(pageEl(), p));
  route('/settings', () => renderSettingsView(pageEl()));
  route('/notifications', () => renderNotificationsView(pageEl()));
  // Finding people to follow is the Players tab's job, not a page of its
  // own — this just opens Search already on that tab (see
  // paintSuggestedPeople in search-view.js).
  route('/people', () => renderSearchView(pageEl(), { initialTab: 'people' }));
  // A link straight to the composer: the entry becomes the feed (replaced,
  // not added, so Back never returns to a URL that reopens the sheet) and
  // the sheet opens over it once the feed is in place.
  route('/log', () => {
    window.addEventListener('hashchange', () => setTimeout(() => openLogComposer({ onSaved: refreshCurrentView }), 0), { once: true });
    navigate('/feed', { replace: true });
  }, { keep: false });
  // Replace, not push: pushing /feed on top of the bad URL meant Back
  // returned to it, which redirected straight forward again, so Back
  // looked like it did nothing.
  setNotFound(() => navigate('/feed', { replace: true }));
}

// Delegated handlers attached once to a node that survives every
// innerHTML re-render done by the individual views.
function wireGlobalChrome() {
  document.body.addEventListener('click', (e) => {
    const back = e.target.closest('[data-action="back"]');
    if (back) { e.preventDefault(); goBack(); }
    // Account/Browse on the signed-out nav (see navBar() in
    // components.js) aren't real routes — there's no bare "/browse"
    // page, it's a screen inside landing-view.js's own local state — so
    // these drop back into that shell on the matching screen instead of
    // navigating anywhere.
    const account = e.target.closest('[data-action="account"]');
    if (account) { e.preventDefault(); renderLandingView(appEl); }
    const browse = e.target.closest('[data-action="browse"]');
    if (browse) { e.preventDefault(); renderLandingView(appEl, { startScreen: 'browse' }); }
    // The three slots on the signed-out bar that genuinely need an
    // account — Log and Notifications — go straight to sign-up rather
    // than to a page that would only tell you to sign up.
    const wantsAccount = e.target.closest('[data-action="signup"]');
    if (wantsAccount) { e.preventDefault(); renderAuthView(appEl, { startMode: 'signup' }); }

    // The + in the tab bar. Opens the sheet in place — no navigation,
    // so you come back to exactly the screen you were on when you close
    // it, and nothing is re-fetched behind it.
    const wantsLog = e.target.closest('[data-action="log"]');
    if (wantsLog) {
      e.preventDefault();
      openLogComposer({ onSaved: refreshCurrentView });
    }

    // Tapping Search again while already on it: an <a href="#/search">
    // only fires hashchange when the hash actually CHANGES, so a second
    // tap while you're already there does nothing on its own — the
    // typed query and results just sit there. This is the one nav
    // destination worth resetting on a repeat tap (an open text search
    // is state a "start over" gesture should actually clear), so it's
    // handled explicitly rather than generalized to every tab.
    const searchTab = e.target.closest('.tabbar [data-route="/search"]');
    if (searchTab && location.hash.slice(1).split('?')[0] === '/search') {
      // Already here: nothing to do. Rebuilding the page made it blink.
      e.preventDefault();
    }
  });
}

// Every modal/sheet in the app (log entry, GIF picker, poster/avatar/
// message-image viewers, auth sheet, QR code, etc.) appends itself
// straight onto <body>, deliberately outside #app — that's what lets it
// sit above the tab bar and cover the whole screen. But it also means a
// route change (any hashchange: the browser's own back/forward buttons,
// or a link tapped from inside the modal) only ever re-renders #app —
// nothing tears the modal down, since it was never part of what got
// replaced. Left unhandled, that's exactly what made back "a mess": the
// screen underneath changes but the modal stays glued on top of it, and
// document.body.style.overflow stays 'hidden' forever since the modal's
// own close() (the only thing that resets it) never runs.
//
// Every such overlay's own class, kept in one place so this selector
// can't quietly go stale again the way it already did once — the first
// version of this fix only listed .modal-overlay and .poster-viewer,
// which missed .avatar-viewer (profile-view.js) and .image-viewer
// (message-thread-view.js) entirely, so back still stuck around on
// exactly those two screens.
const OVERLAY_SELECTOR = '.modal-overlay, .poster-viewer, .avatar-viewer, .image-viewer, .avatar-crop, .draw-overlay, .story-viewer';

// This is the same cleanup wireHardwareBack already did for Android's
// physical back button below — just generalized to every hashchange, so
// the browser's native back/forward buttons on web get it too.
// An overlay may have work to do on the way out — the game page's log
// sheet writes the draft you set before it goes. Yanking the node
// skipped that entirely, which is why backing out of that sheet lost
// whatever you had just tapped. Anything that sets `__dismiss` gets
// asked; anything that doesn't is removed as before.
function dismissOverlay(el) {
  if (typeof el.__dismiss === 'function') { el.__dismiss(); return; }
  el.remove();
}

function closeStrayOverlays() {
  const overlays = document.querySelectorAll(OVERLAY_SELECTOR);
  if (!overlays.length) return;
  overlays.forEach(dismissOverlay);
  document.body.style.overflow = '';
}

// One Back for the in-app arrow and the Android button alike: the
// previous history entry, whatever it is. Only when there is none (this
// screen was opened directly from a link or a notification) is there
// nowhere to go back to; the arrow then goes to the app's home rather
// than out of the app.
function goBack() {
  if (onOverlayEntry() || historyDepth() > 0) { history.back(); return; }
  if ((location.hash.slice(1) || '/feed') !== '/feed') navigate('/feed', { replace: true });
}

// Android's hardware/gesture back button inside a Capacitor build.
//
// The WebView there doesn't wire it to page history on its own — the
// default exits the app outright. This sends it through the same history
// as everything else, and only exits when there is genuinely no previous
// entry left. The TWA (android-app) and the plain WebView build
// (android-native) get this from the browser/WebView history directly.
//
// No-ops on the web build, where the plugin simply isn't present.
function wireHardwareBack() {
  const App = window.Capacitor?.Plugins?.App;
  if (!App?.addListener) return;
  App.addListener('backButton', () => {
    // Overlays opened where there is no routed page (the signed-out
    // funnel) have no history entry; close those directly.
    if (onOverlayEntry() || historyDepth() > 0) { history.back(); return; }
    // Overlays opened where there is no routed page (the signed-out
    // funnel) have no history entry of their own; close those directly.
    const overlays = document.querySelectorAll(OVERLAY_SELECTOR);
    if (overlays.length) {
      dismissOverlay(overlays[overlays.length - 1]);
      if (overlays.length === 1) document.body.style.overflow = '';
      return;
    }
    App.exitApp();
  });
}

// Catches the return trip from signInWithProvider()'s native branch (see
// auth.js): Google/Twitch/Discord redirect to playthruu://auth-callback
// once signed in, Android hands that URL to this listener via the
// custom scheme registered in AndroidManifest.xml, and the session
// Supabase left in its fragment is picked up from there. Supabase's own
// SIGNED_IN event (fired by setSession below) is what actually takes it
// from here — the same onAuthChange listener wired in boot() handles a
// native sign-in exactly like any other.
//
// The sign-in modal never got torn down for this (no page ever
// navigated away, unlike the web flow), so it's still sitting open on
// top of everything at this point — cleared explicitly rather than left
// blocking the now-signed-in app underneath it.
//
// No-ops on the web build, same reasoning as wireHardwareBack below.
async function wireAuthDeepLink() {
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith('playthruu://auth-callback')) return;
      try {
        const params = new URLSearchParams(url.split('#')[1] || '');
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        } else {
          toast('Sign-in did not complete. Try again.', 'error');
        }
      } catch {
        toast('Sign-in did not complete. Try again.', 'error');
      } finally {
        document.querySelectorAll(OVERLAY_SELECTOR).forEach((el) => el.remove());
        document.body.style.overflow = '';
        window.Capacitor?.Plugins?.Browser?.close().catch(() => {});
      }
    });
  } catch {
    // Web build: no Capacitor runtime, nothing to bind.
  }
}

async function loadSession(user) {
  state.user = user;
  // Opened before: go straight in with the saved profile and check it against
  // the server in the background, instead of showing a blank screen while
  // that request runs.
  const saved = cachedProfile(user.id);
  if (saved && !saved.is_suspended) {
    state.profile = saved;
    startApp(user);
    api.getProfile(user.id).then((fresh) => {
      state.profile = fresh;
      if (fresh?.is_suspended) renderSuspended();
    }).catch(() => {});
    return;
  }
  try {
    state.profile = await api.getProfile(user.id);
  } catch {
    // The profiles row is created by a DB trigger right after signup —
    // on a slow connection the client can win the race. Retry once.
    await new Promise((r) => setTimeout(r, 900));
    try {
      state.profile = await api.getProfile(user.id);
    } catch (err2) {
      toast('Signed in, but your profile is still being set up. Refresh in a moment.', 'error');
      return;
    }
  }
  // A suspended account never reaches the app. The database (see
  // migrations/2026-08-17_ban_enforcement.sql) is what actually stops
  // them writing — this screen is the human-facing half, so they know
  // why the app won't let them in rather than hitting silent failures.
  if (state.profile?.is_suspended) {
    renderSuspended();
    return;
  }
  startApp(user);
}

function startApp(user) {
  registerRoutes();
  startRouter();
  promptUsernameIfPlaceholder();
  startPresenceHeartbeat(user.id);

  // Archived (see MESSENGER_ARCHIVED, config.js): no nav tab points at
  // /messages any more, so a badge on it and a live subscription for it
  // would just be background work with nothing to show for it.
  if (!MESSENGER_ARCHIVED) {
    refreshMessageBadge();
    unsubscribeConversations?.();
    unsubscribeConversations = api.subscribeToConversations(user.id, refreshMessageBadge);
  }

  refreshNotifBadge();
  api.getNotificationPrefs(user.id).then((p) => { notifPrefs = p; }).catch(() => {});
  unsubscribeNotifications?.();
  unsubscribeNotifications = api.subscribeToNotifications(user.id, (row) => {
    unreadNotifCount += 1;
    applyNotifBadge();
    // A message notification also moves the Messages tab's own count,
    // which is driven by a different subscription that does not fire for
    // conversation_prefs changes - nudge it so both badges agree.
    if (row?.kind === 'message') refreshMessageBadge();
    maybeSystemNotify(row);
  });
  warmOtherTabs();
}

// The tab you land on paints from its own fetch, but every OTHER tab used
// to only start fetching at the moment you tapped it — which is exactly
// when its spinner was visible and in the way. These fill the same view
// caches those tabs read from before you get there, so the first open
// paints immediately instead of loading in front of you.
//
// Deliberately idle-scheduled and after the landing view is already up:
// this is spare-capacity work and must never compete with the fetches
// for the screen someone is actually looking at. Failures are ignored
// outright — a warm that doesn't land just means that tab loads the way
// it always used to.
//
// One more thing it will not do: spend somebody's mobile data on a
// screen they have not asked for. Data Saver on, or a connection the
// browser rates 2g, and none of this runs — the tabs then load exactly
// the way they did before any of it existed, which is the whole point
// of it being spare-capacity work.
function warmingIsWelcome() {
  const c = navigator.connection;
  if (!c) return true; // no information: assume a normal connection
  if (c.saveData) return false;
  return !['slow-2g', '2g'].includes(c.effectiveType);
}

function warmOtherTabs() {
  if (!warmingIsWelcome()) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
  idle(() => {
    if (!getCached(CACHE_KEYS.searchTrending)) {
      api.getWorldTrending(12)
        .then((games) => setCached(CACHE_KEYS.searchTrending, games))
        .catch(() => {});
    }
    warmDiscover();
    warmOwnProfile(state.profile);

    // The bell. Its first page is the same query for everybody with the
    // filters off, so it warms cleanly — and it is the tab people check
    // most often after the feed.
    if (state.user && !getCached(CACHE_KEYS.notifications)) {
      api.getActivityFeed(state.user.id, { scope: 'friends', includeYou: false, includeIncoming: false })
        .then((res) => setCached(CACHE_KEYS.notifications, res))
        .catch(() => {});
    }

    // "See more" off the feed's Trending strip. A wide IGDB query and
    // the slowest page in the app to open cold, which makes it the one
    // most worth having in hand before it is asked for.
    if (!getCached(CACHE_KEYS.trendingPage)) {
      api.getWorldTrending(36, 30)
        .then((games) => setCached(CACHE_KEYS.trendingPage, games))
        .catch(() => {});
    }
  });
}

// Records that this account is currently using the app, so the admin
// build can show who's online, when everyone else was last around, and
// — the usage half below — how many hours each account has spent in
// the app in total.
//
// Three things keep the presence half cheap. It only writes every
// PRESENCE_EVERY ms however often it's poked; it stops writing entirely
// while the app is in the background (a phone left on the feed overnight
// shouldn't look "online" until morning); and it's deliberately started
// AFTER the suspended-account check above returns, so a banned account
// never registers as present.
//
// Usage rides the same cadence rather than running its own timer.
// usageActiveSince marks when the tab last became visible; each tick
// (or the moment it goes hidden) banks the seconds since then via
// api.bumpUsage and resets the marker. Killing the tab outright rather
// than backgrounding it first loses at most the last few seconds —
// the same best-effort trade touchPresence already makes.
const PRESENCE_EVERY = 60_000;
let presenceTimer = null;
let lastPresenceWrite = 0;
let usageActiveSince = null;

function startPresenceHeartbeat(userId) {
  const flushUsage = () => {
    if (usageActiveSince == null) return;
    const seconds = Math.round((Date.now() - usageActiveSince) / 1000);
    usageActiveSince = document.visibilityState === 'visible' ? Date.now() : null;
    if (seconds > 0) api.bumpUsage(seconds);
  };

  const beat = (force = false) => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (!force && now - lastPresenceWrite < PRESENCE_EVERY) return;
    lastPresenceWrite = now;
    api.touchPresence(userId);
    flushUsage();
  };

  usageActiveSince = document.visibilityState === 'visible' ? Date.now() : null;
  beat(true);
  clearInterval(presenceTimer);
  presenceTimer = setInterval(beat, PRESENCE_EVERY);
  // Coming back to the app should register immediately rather than
  // waiting out the rest of an interval that ticked while hidden; going
  // to the background banks whatever usage time is owed before the
  // timer stops ticking on it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      usageActiveSince = Date.now();
      beat();
    } else {
      flushUsage();
    }
  });
}

// Shown in place of the whole app when the signed-in account is
// suspended. Deliberately a dead end: the only action is to sign out.
function renderSuspended() {
  appEl.innerHTML = `
    <div class="suspended-screen">
      <div class="suspended-card">
        <div class="suspended-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"></circle><path d="m5.6 5.6 12.8 12.8"></path>
          </svg>
        </div>
        <h1>Account suspended</h1>
        <p>Your Playthruu account has been suspended for breaking the community
        rules. While it's suspended you can't post, edit, follow, like, or
        change your profile.</p>
        <p class="suspended-screen__note">If you think this is a mistake, reach
        out to support.</p>
        <button class="btn btn--block" id="suspended-signout">Sign out</button>
      </div>
    </div>`;
  const btn = document.getElementById('suspended-signout');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await signOut(); } catch { btn.disabled = false; }
    });
  }
}

// Signing in through a provider never supplies a username, so the signup
// trigger falls back to "player_" + a fragment of the user id (see
// handle_new_user in schema.sql). That's a valid username, just not one
// anyone would choose, so the first time such an account appears it gets
// offered the chance to pick a real one.
async function promptUsernameIfPlaceholder() {
  const username = state.profile?.username || '';
  if (!/^player_[0-9a-f]{8}$/.test(username)) return;
  const { openUsernameClaim } = await import('./components.js');
  openUsernameClaim({
    // Seed from whatever the provider called them, cleaned into a legal
    // username, so most people can just accept the suggestion.
    suggested: (state.user?.user_metadata?.preferred_username
      || state.user?.user_metadata?.name
      || '')
      .toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 20),
    onCheck: (name) => api.usernameAvailable(name),
    onSave: async (name) => {
      const updated = await api.updateProfile(state.user.id, { username: name, display_name: name });
      state.profile = updated;
      refreshCurrentView();
    },
  });
}

function handleSignedOut() {
  unsubscribeConversations?.();
  unsubscribeConversations = null;
  unreadMessageCount = 0;
  applyMessageBadge();
  unsubscribeNotifications?.();
  unsubscribeNotifications = null;
  unreadNotifCount = 0;
  notifPrefs = api.NOTIFICATION_PREF_DEFAULTS;
  applyNotifBadge();
  clearViewCache();
  state.user = null;
  state.profile = null;
  // replaceState (not location.hash =) so this doesn't fire a
  // hashchange into a router that would try to render a protected view.
  history.replaceState({ idx: historyDepth() }, '', location.pathname + location.search);
  // None of the signed-in screens kept for Back may come back now.
  resetPages();
  // Reset routing to the anonymous fallback — registerRoutes() pointed
  // notFound at /feed for the session that just ended, and /feed's
  // handler assumes a signed-in user. Without this reset, hitting an
  // invalid path right after logging out would fall through to it and
  // crash trying to load data for a user that no longer exists.
  registerPublicRoutes();
  setNotFound(() => renderLandingView(appEl));
  // Back to the funnel, not straight to a bare login form — same as
  // opening the app signed out for the first time.
  renderLandingView(appEl);
}

// Press and hold any poster: the log sheet for that game opens straight
// away, a shortcut past the game page. One delegated listener covers every
// poster in the app (posterFrame in components.js). The game comes from
// the poster's own link when it has one; posters built from IGDB data
// alone (Bored grid, trending) are matched by title, the same lookup
// Search uses, and added to the catalogue if they are new.
function wirePosterLongPress() {
  // Held for half a second: the sheet slides up with a buzz, together.
  const HOLD_MS = 500;
  let timer = 0;
  let start = null;
  let swallowClick = false;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; };

  async function gameFor(frame) {
    const link = frame.closest('[href^="#/game/"]');
    const id = link?.getAttribute('href').match(/^#\/game\/([0-9a-f-]{36})$/)?.[1];
    if (id) return api.getGame(id);
    const title = (qs('img', frame)?.alt || '').replace(/ cover$/, '').trim();
    if (!title) return null;
    // IGDB-backed tiles carry their id: one catalogue lookup, no search.
    const tile = frame.closest('[data-igdb-id]');
    const igdbId = Number(tile?.dataset.igdbId);
    if (igdbId) {
      const cover = qs('img', frame)?.getAttribute('src') || '';
      return api.addGame({ igdb_id: igdbId, title, cover_url: cover.replace(/t_[a-z0-9_]+/, 't_cover_big'), release_year: Number(tile.dataset.year) || null }, state.user.id);
    }
    const { results: found = [] } = await api.searchGamesEverywhere(title, 5);
    const g = found.find((x) => (x.title || '').toLowerCase() === title.toLowerCase()) || found[0];
    if (!g) return null;
    return g.id ? g : api.addGame(g, state.user.id);
  }

  function press(target, x, y) {
    const frame = target.closest?.('.poster-frame');
    if (!frame || frame.closest('.modal-overlay, .draw-overlay')) return;
    cancel();
    start = { x, y };
    // Look the game up while the finger is still down, so the sheet is
    // ready the moment the hold completes instead of a beat after it.
    const lookup = state.user ? gameFor(frame) : null;
    lookup?.catch(() => {});
    timer = setTimeout(async () => {
      timer = 0; start = null;
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 1200);
      if (!state.user) { buzz([20]); promptSignIn('Sign in to log games.'); return; }
      // Open at once with what the poster already shows (title, cover,
      // year); the catalogue lookup started on press finishes behind the
      // sheet, and saving waits for it.
      const img = qs('img', frame);
      const tile = frame.closest('[data-year]');
      const standIn = {
        title: (img?.alt || '').replace(/ cover$/, '').trim(),
        cover_url: (img?.getAttribute('src') || '').replace(/t_[a-z0-9_]+/, 't_cover_big'),
        release_year: Number(tile?.dataset.year) || null,
      };
      buzz([20]);
      // Drop the pressed/focused state off the poster: once the sheet covers
      // it, no touchend/mouseup reaches it, so it stayed lifted after close.
      document.activeElement?.blur?.();
      openLogComposer({ game: standIn, resolveGame: lookup.then((g) => { if (!g) throw new Error('not found'); return g; }), onSaved: refreshCurrentView });
    }, HOLD_MS);
  }
  const moved = (x, y) => { if (start && Math.hypot(x - start.x, y - start.y) > 12) cancel(); };

  // Touch has its own listeners: a phone's pointer stream is cancelled by
  // the browser's own long-press handling (link preview, context menu)
  // well before a second is up, which is what made the hold unreliable.
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { cancel(); return; }
    press(e.target, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => moved(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  document.addEventListener('touchend', () => { if (timer) cancel(); }, { passive: true });
  document.addEventListener('mousedown', (e) => { if (e.button === 0) press(e.target, e.clientX, e.clientY); });
  document.addEventListener('mousemove', (e) => moved(e.clientX, e.clientY));
  document.addEventListener('mouseup', () => { if (timer) cancel(); });
  document.addEventListener('scroll', () => { if (timer) cancel(); }, { passive: true, capture: true });
  // Letting go after a hold must not also open the poster.
  document.addEventListener('click', (e) => {
    if (swallowClick && e.target.closest?.('.poster-frame, .discovery-tile, .trending-card, [href^="#/game/"]')) {
      e.preventDefault(); e.stopPropagation(); swallowClick = false;
    }
  }, true);
  // No context menu / link preview on a held poster.
  document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.poster-frame')) e.preventDefault(); });
}

async function boot() {
  wireGlobalChrome();
  wirePosterLongPress();
  trackOverlays({
    selector: OVERLAY_SELECTOR,
    dismiss: dismissOverlay,
    onAllClosed: () => { if (!document.querySelector(OVERLAY_SELECTOR)) document.body.style.overflow = ''; },
  });
  wireHardwareBack();
  wireAuthDeepLink();
  window.addEventListener('hashchange', applyMessageBadge);
  window.addEventListener('hashchange', applyNotifBadge);
  window.addEventListener('hashchange', closeStrayOverlays);
  // A page put back from the back stack still has the tab bar it was
  // built with; bring its badges up to date like a fresh one's.
  window.addEventListener('page:shown', () => { applyMessageBadge(); applyNotifBadge(); document.activeElement?.blur?.(); });
  // The hub clears the inbox server-side when it opens; this is how the
  // bell hears about it without polling.
  window.addEventListener('notifications:read', () => {
    unreadNotifCount = 0;
    applyNotifBadge();
  });
  // Settings writes straight to the DB, so the cached copy the realtime
  // handler reads has to be told when it changed.
  window.addEventListener('notifications:prefs', (e) => {
    if (e.detail) notifPrefs = e.detail;
  });
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    await loadSession(session.user);
  } else {
    // Search and individual game pages are real parts of the app a
    // signed-out visitor can browse (see landing-view.js) — only these
    // two are registered here, not the protected set, and anything else
    // (including a bare "/feed" default with no hash at all) falls
    // through to the landing funnel instead.
    registerPublicRoutes();
    setNotFound(() => renderLandingView(appEl));
    // A signed-out visitor's hash can be left over from earlier in the
    // same browser/app session — tapping Search or Discover sets
    // location.hash, and that persists across a full relaunch (the OS/
    // browser resumes the last URL, not the manifest's start_url), so
    // reopening the app was landing back on whichever of those was open
    // last instead of the entry screen. /search and /discover aren't
    // links anyone would ever share or deep-link to fresh, unlike
    // /game/:id — so only those two are treated as stale session state
    // and cleared before the router's first resolve.
    const hashPath = location.hash.slice(1).split('?')[0];
    if (hashPath === '/search' || hashPath === '/discover') {
      history.replaceState(null, '', location.pathname + location.search);
    }
    startRouter();
  }

  onAuthChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user && state.user?.id !== session.user.id) {
      await loadSession(session.user);
    } else if (event === 'SIGNED_OUT') {
      handleSignedOut();
    } else if (event === 'PASSWORD_RECOVERY') {
      // Fires when the password-reset email link lands back here — the
      // recovery token in the URL already proved this is the account
      // owner, so the only thing left to do is ask for a new password.
      openSetNewPasswordModal();
    }
  });
}

// Reached only via the PASSWORD_RECOVERY event above — a real session
// is already active by then (Supabase exchanged the email link's token
// for one), just not one anyone typed a password into, so this is the
// one place a new password is accepted with no "current password" check.
function openSetNewPasswordModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-overlay--glass';
  overlay.innerHTML = `
    <div class="modal">
      <header class="modal__header">
        <h2>Set a new password</h2>
      </header>
      <div class="modal__body">
        <p class="modal__hint">You're in — pick a new password to finish resetting it.</p>
        <form id="new-password-form">
          <label class="field field--icon">
            <span>New password</span>
            <div class="field__input-wrap">
              <span class="field__icon">${iconLock()}</span>
              <input type="password" name="password" placeholder="••••••••" autocomplete="new-password" required minlength="6">
            </div>
          </label>
          <button type="submit" class="btn btn--accent btn--block">Save password</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  // No close button, no backdrop-tap, no swipe-to-dismiss — leaving this
  // open with an unset password isn't a real state to land in, so unlike
  // the other modals here, this one only closes once it's actually done.

  qs('#new-password-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type="submit"]', overlay);
    const password = new FormData(e.target).get('password');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await updatePasswordAfterReset(password);
      toast('Password updated.', 'success');
      overlay.remove();
      document.body.style.overflow = '';
    } catch (err) {
      toast(err.message || 'Could not update your password.', 'error');
      btn.disabled = false;
      btn.textContent = 'Save password';
    }
  });
}

boot();
