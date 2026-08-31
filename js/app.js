import { supabase } from './supabase-client.js';
import { onAuthChange, signOut, updatePasswordAfterReset } from './auth.js';
import { getTheme, applyTheme } from './theme.js';
import * as api from './api.js';
import { state } from './state.js';
import { route, setNotFound, startRouter, navigate, refreshCurrentView } from './router.js';
import { renderLandingView, seedPinnedGames } from './views/landing-view.js';
import { renderFeedView } from './views/feed-view.js';
import { renderSearchView } from './views/search-view.js';
import { renderDiscoverView } from './views/discover-view.js';
import { renderListDetailView } from './views/lists-view.js';
import { renderMessagesView } from './views/messages-view.js';
import { renderMessageThreadView } from './views/message-thread-view.js';
import { renderProfileView } from './views/profile-view.js';
import { renderConnectionsView } from './views/connections-view.js';
import { renderActivityView } from './views/activity-view.js';
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
import { openLogModal } from './views/log-modal.js';
import { toast, qs } from './utils.js';
import { clearViewCache } from './cache.js';
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
  } catch {
    // Transient failure — keep showing the last known count rather than
    // flickering the badge off over a single dropped request.
  }
  applyMessageBadge();
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
  route('/game/:id', (p) => renderGameView(appEl, p));
  // Viewing a game that isn't in the catalogue yet — see the note on
  // renderGameView's `igdbId` mode in game-view.js for why this exists
  // as its own route rather than reusing /game/:id.
  route('/game/igdb/:igdbId', (p) => renderGameView(appEl, { igdbId: Number(p.igdbId) }));
  route('/search', () => renderSearchView(appEl));
  route('/discover', () => renderDiscoverView(appEl));
}

function registerRoutes() {
  if (routesRegistered) return;
  routesRegistered = true;
  registerPublicRoutes();
  route('/feed', () => renderFeedView(appEl));
  route('/news', () => renderFeedView(appEl, { initialTab: 'news' }));
  route('/friends-playing', () => renderFriendsPlayingView(appEl));
  route('/currently-playing', () => renderCurrentlyPlayingView(appEl));
  route('/list/:id', (p) => renderListDetailView(appEl, p));
  route('/messages', () => renderMessagesView(appEl));
  route('/messages/new/:userId', (p) => renderMessageThreadView(appEl, { otherUserId: p.userId }));
  route('/messages/:id', (p) => renderMessageThreadView(appEl, { conversationId: p.id }));
  route('/me', () => renderProfileView(appEl, { username: state.profile.username }));
  route('/profile/:username', (p) => renderProfileView(appEl, p));
  route('/profile/:username/followers', (p) => renderConnectionsView(appEl, { username: p.username, kind: 'followers' }));
  route('/profile/:username/following', (p) => renderConnectionsView(appEl, { username: p.username, kind: 'following' }));
  route('/profile/:username/activity', (p) => renderActivityView(appEl, p));
  route('/profile/:username/log-list/:mode', (p) => renderLogListView(appEl, p));
  route('/game/:id/reviews', (p) => renderGameReviewsView(appEl, p));
  route('/review/:id', (p) => renderReviewView(appEl, p));
  route('/person/:qid', (p) => renderPersonView(appEl, p));
  route('/director/:slug', (p) => renderDirectorView(appEl, p));
  route('/studio/:companyId', (p) => renderStudioView(appEl, p));
  route('/settings', () => renderSettingsView(appEl));
  route('/log', () => {
    history.replaceState(null, '', '#/feed');
    renderFeedView(appEl).then(() => openLogModal({ onSaved: refreshCurrentView }));
  });
  setNotFound(() => navigate('/feed'));
}

// Delegated handlers attached once to a node that survives every
// innerHTML re-render done by the individual views.
function wireGlobalChrome() {
  document.body.addEventListener('click', (e) => {
    const back = e.target.closest('[data-action="back"]');
    if (back) { e.preventDefault(); history.back(); }
    // Account/Browse on the signed-out nav (see navBar() in
    // components.js) aren't real routes — there's no bare "/browse"
    // page, it's a screen inside landing-view.js's own local state — so
    // these drop back into that shell on the matching screen instead of
    // navigating anywhere.
    const account = e.target.closest('[data-action="account"]');
    if (account) { e.preventDefault(); renderLandingView(appEl); }
    const browse = e.target.closest('[data-action="browse"]');
    if (browse) { e.preventDefault(); renderLandingView(appEl, { startScreen: 'browse' }); }
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
const OVERLAY_SELECTOR = '.modal-overlay, .poster-viewer, .avatar-viewer, .image-viewer';

// This is the same cleanup wireHardwareBack already did for Android's
// physical back button below — just generalized to every hashchange, so
// the browser's native back/forward buttons on web get it too.
function closeStrayOverlays() {
  const overlays = document.querySelectorAll(OVERLAY_SELECTOR);
  if (!overlays.length) return;
  overlays.forEach((el) => el.remove());
  document.body.style.overflow = '';
}

// Android's hardware/gesture back button.
//
// Inside the packaged app the WebView doesn't wire this up to page
// history on its own — the default is to exit the app outright, so a
// single back press from anywhere in the app closed it instead of
// returning to the previous screen. This routes back presses through
// the same history the in-app back arrows use, and only actually leaves
// the app from the feed (the root screen), which is the behaviour
// Android users expect.
//
// No-ops on the web build, where the browser's own back button already
// does the right thing and the plugin simply isn't present.
async function wireHardwareBack() {
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      const onRootScreen = (location.hash.slice(1) || '/feed') === '/feed';
      // Multiple overlays can stack (e.g. "Add to list" opened from a
      // button inside the log modal) — appendChild always adds to the
      // end of <body>, so the LAST match here is the topmost/most
      // recently opened one, not the first. A single back press should
      // only dismiss that one layer, not reach past it to whatever a
      // querySelector's first match happened to be.
      const overlays = document.querySelectorAll(OVERLAY_SELECTOR);
      if (overlays.length) {
        overlays[overlays.length - 1].remove();
        if (overlays.length === 1) document.body.style.overflow = '';
        return;
      }
      if (canGoBack && !onRootScreen) history.back();
      else App.exitApp();
    });
  } catch {
    // Web build: no Capacitor runtime, nothing to bind.
  }
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
  registerRoutes();
  startRouter();
  promptUsernameIfPlaceholder();

  refreshMessageBadge();
  unsubscribeConversations?.();
  unsubscribeConversations = api.subscribeToConversations(user.id, refreshMessageBadge);
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
  clearViewCache();
  state.user = null;
  state.profile = null;
  // replaceState (not location.hash =) so this doesn't fire a
  // hashchange into a router that would try to render a protected view.
  history.replaceState(null, '', location.pathname + location.search);
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

async function boot() {
  // The [data-theme] attribute itself is already set by the inline
  // script in index.html (before first paint, to avoid a flash) — this
  // just brings the native status-bar colour (<meta name="theme-color">)
  // in line with it too, which that early script can't do since the
  // meta tag isn't in the DOM yet at that point in <head>.
  applyTheme(getTheme());
  wireGlobalChrome();
  wireHardwareBack();
  wireAuthDeepLink();
  window.addEventListener('hashchange', applyMessageBadge);
  window.addEventListener('hashchange', closeStrayOverlays);

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
