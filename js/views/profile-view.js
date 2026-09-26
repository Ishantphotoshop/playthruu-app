import * as api from '../api.js';
import { state } from '../state.js';
import { MESSENGER_ARCHIVED } from '../config.js';
import {
  navBar, spinner, avatarImg, gameCard, showcaseGrid, SHOWCASE_MAX, ratingHistogram, wireRatingHistogram, posterFrame,
  emptyState, iconStamp, iconSettings, iconShare, iconQr, iconDotsMenu, iconClose, iconSearch, iconPlus, listCard, iconMessage,
  combinedGameResults, wireCombinedGameResults, openReportSheet, iconFlag, iconBlock,
} from '../components.js';
import { esc, formatDate, statusStamp, starRow, qs, qsa, toast, debounce, pulseLogTab, igdbSized, enableSwipeToDismiss, promptSignIn } from '../utils.js';
import { refreshCurrentView, navigate } from '../router.js';
import { wirePullToRefresh } from './feed-view.js';
import { openNewListForm } from './lists-view.js';
import { getCached, setCached } from '../cache.js';

// The seven requests a profile page needs, kept as one in-flight promise
// so the background warm-up on sign-in (see warmOwnProfile) and the view
// itself can share a single round of them: whichever asks first starts
// the work, the other one joins it instead of firing a duplicate set.
// Short-lived on purpose — this is here to bridge "warmed a moment ago,
// opened just now", not to serve a stale profile later in the session.
// The view still repaints from whatever it resolves to, exactly as
// before, so nothing here changes what ends up on screen.
const PROFILE_BUNDLE_TTL = 60_000;
let profileBundleCache = null; // { id, at, promise }

// Called after anything that changes a profile's own bundle out from under
// it (connecting/disconnecting PSN, etc.) so the next visit fetches live
// data instead of the pre-change snapshot warmOwnProfile() cached at sign-in.
export function invalidateProfileBundleCache(profileId) {
  if (profileBundleCache && profileBundleCache.id === profileId) {
    profileBundleCache = null;
  }
}

// Saving, editing or deleting a diary entry changes the diary, the
// backlog, the currently-playing row and every stat on this page at
// once — so the whole bundle goes, whoever's profile it belongs to (a
// like or a follow can change somebody else's too). api.js fires this
// from createLog/updateLog/deleteLog; see noteLogChanged() there.
window.addEventListener('logs:changed', () => { profileBundleCache = null; });

function profileBundle(profile) {
  const fresh = profileBundleCache
    && profileBundleCache.id === profile.id
    && Date.now() - profileBundleCache.at < PROFILE_BUNDLE_TTL;
  if (fresh) {
    const { promise } = profileBundleCache;
    profileBundleCache = null; // one-shot: the next visit gets live data
    return promise;
  }
  return Promise.all([
    api.getUserStats(profile.id),
    api.getFollowCounts(profile.id),
    api.getLogsForUser(profile.id, { limit: 200 }),
    api.getFavorites(profile.id),
    api.getRatingBreakdown(profile.id),
    api.getListsForUser(profile.id),
    state.user ? api.isFollowing(state.user.id, profile.id) : Promise.resolve(false),
    // Empty array for the (still overwhelmingly common) case of nobody
    // having connected a PlayStation account — one indexed query against
    // a table that's usually empty for this user, not worth splitting
    // into its own after-first-paint fetch the way cast/director is.
    api.getImportedGames(profile.id),
  ]);
}

// imported_games stores minutes (see the migration's own reasoning —
// rounding to hours at import time would throw away detail). Rounded to
// one decimal past 1h so a badge reads "84.5h" rather than a false-
// precise "84.48333...h"; under an hour reads in minutes outright,
// since "0.1h" says less than "6m" does.
function formatImportedHours(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, '')}h`;
}

// Called from app.js once a session is up, so tapping through to your own
// profile for the first time doesn't start seven requests from cold.
export function warmOwnProfile(profile) {
  if (!profile?.id) return;
  const promise = profileBundle(profile);
  promise.catch(() => {}); // a failed warm must not surface as unhandled
  profileBundleCache = { id: profile.id, at: Date.now(), promise };
}

export async function renderProfileView(root, { username }) {
  const isOwn = state.profile && username === state.profile.username;
  const cacheKey = `profile:${username}`;
  // Painting last visit's profile immediately (instead of a spinner)
  // removes the wait when bouncing back to your own profile tab — all
  // seven fetches below still run and fully re-render + re-wire the page
  // exactly as before, this just fills the gap while that's in flight.
  // The cached snapshot itself has no listeners wired yet (it's just
  // copied markup), so it's briefly non-interactive until that finishes.
  const cachedProfile = getCached(cacheKey);
  // Own and visitor profiles now share the exact same masthead bar —
  // @handle centred, one control on each side — rather than the old
  // split where a visitor got a completely different docked topBar()
  // with a visible back arrow. The back arrow is gone entirely: hardware
  // back (Capacitor's backButton listener in app.js) and the browser's
  // own back button already call history.back() regardless of any
  // on-screen button, so removing it loses no way back, only a second,
  // redundant one. The left slot on a visitor's page is an inert
  // same-size spacer, not a button, so the handle still lands dead
  // centre (flex:1 between two equal 50px boxes) with nothing to press.
  //
  // .profile-top is a SIBLING of #profile-body, not nested inside it —
  // it used to be a child, and the real fetch below replaces
  // #profile-body's entire innerHTML once it lands, which silently wiped
  // the button out the moment real data arrived (it only ever survived
  // the brief spinner/cached-paint window before that).
  //
  // position: fixed, not absolute (2026-09-26 fix): absolute here was
  // correct on paper — #app is position:relative and never scrolls, so
  // an absolute child of a sibling of #profile-body should stay put
  // regardless of #profile-body's own scrolling — and it held up under
  // every scroll test run against it. It still visibly scrolled away on
  // a real phone, which an absolute/relative containing-block chain
  // can't explain from CSS alone (compositing quirks in a mobile WebView
  // are the usual cause, and they don't show up in a desktop browser).
  // Rather than chase a bug invisible to the tools available here, this
  // switches to the exact technique the bottom tab bar already uses
  // (position: fixed; left: 50%; transform: translateX(-50%); width:
  // 100%; max-width: 560px) — genuinely pinned to the viewport, not to
  // any element's containing-block status, and proven correct on both
  // mobile (where the viewport IS the app) and a wide desktop browser
  // (where #app is a centred, capped-width column).
  //
  // The gear/dots are painted in the same pass as the spinner, so on a
  // cold load they used to sit there alone against an empty screen for
  // as long as the fetch took — controls floating over nothing. They
  // start faded instead and arrive WITH the profile they belong to. A
  // warm cache paints real content immediately, so there is nothing to
  // wait for and it is shown straight away.
  root.innerHTML = `
      <div class="profile-top profile-top--masthead${cachedProfile ? '' : ' profile-top--pending'}">
        ${isOwn
          ? `<button type="button" class="profile-top__btn profile-top__btn--start" id="profile-menu" aria-label="Share">${iconQr()}</button>`
          : `<span class="profile-top__btn" aria-hidden="true"></span>`}
        <span class="profile-top__name">@${esc(username)}</span>
        ${isOwn
          ? `<a class="profile-top__btn profile-top__btn--end" href="#/settings" aria-label="Settings">${iconSettings()}</a>`
          : `<button type="button" class="profile-top__btn profile-top__btn--end" id="profile-more" aria-label="More">${iconDotsMenu()}</button>`}
      </div>
      <div class="view-body view-body--no-topbar" id="profile-body">
       ${cachedProfile || spinner()}
     </div>` + navBar(isOwn ? '/me' : '');
  const body = qs('#profile-body', root);
  wirePullToRefresh(body);

  // Whatever happens next — real data or an error — the gear becomes
  // usable. Kept in one place so no later branch can strand it faded.
  const revealCornerAction = () => {
    qs('.profile-top', root)?.classList.remove('profile-top--pending');
  };

  try {
    const profile = isOwn ? state.profile : await api.getProfileByUsername(username);
    const [stats, counts, logs, favorites, breakdown, lists, following, importedGames] = await profileBundle(profile);

    const diary = logs.filter((l) => l.status === 'played' || l.status === 'dropped');
    const backlog = logs.filter((l) => l.status === 'backlog');
    // logs itself is ordered by played_date first (right for the diary),
    // but "playing" entries never have a played_date, so that ordering
    // is meaningless for them — they'd sort as a block by created_at
    // instead, which stays put even when an old backlog entry is what
    // just got marked "playing". Re-sorted by updated_at (bumped by a DB
    // trigger on every change) so whichever game was most recently
    // marked playing actually shows first.
    const playing = logs
      .filter((l) => l.status === 'playing')
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    const showcaseSlots = favorites.length
      ? favorites.slice(0, SHOWCASE_MAX).map((f) => {
          const match = logs.find((l) => l.game_id === f.game_id);
          return { game: f.games, rating: match?.rating, reviewed: !!match?.review };
        })
      : diary.slice(0, SHOWCASE_MAX).map((l) => ({ game: l.games, rating: l.rating, reviewed: !!l.review }));

    // Streak archived, not deleted (2026-09-26) — the number is still
    // computed below via stats.streak (see getUserStats/computeLogStreak
    // in api.js) and the CSS for .profile-header__streak is untouched.
    // Bringing the badge back is restoring the conditional span this used
    // to render alongside the hours badge — which has since moved from
    // its own pill (.profile-header__badges/.profile-header__hours,
    // 2026-09-26; still in styles.css, also unused now) to sitting
    // below the name (.profile-header__hours-inline, below).

    body.innerHTML = `
      <div class="profile-header profile-header--hero">
        <button class="profile-header__avatar-btn" id="avatar-enlarge" aria-label="View profile photo">
          ${avatarImg(profile, 92)}
        </button>
        <h1 class="profile-header__name-text">${esc(profile.display_name || profile.username)}</h1>
        ${stats.totalHours > 0 ? `<p class="profile-header__hours-inline">(${stats.totalHours.toLocaleString('en-US')} hrs)</p>` : ''}
        ${profile.bio ? `
          <div class="profile-header__bio-wrap">
            <p class="profile-header__bio" id="profile-bio">${esc(profile.bio)}</p>
            <button type="button" class="profile-header__bio-more" id="profile-bio-more"
                    aria-controls="profile-bio" aria-expanded="false"
                    aria-label="Show full bio" hidden><span></span><span></span><span></span></button>
          </div>` : ''}
        <div class="profile-header__stats">
          <a href="#/profile/${esc(profile.username)}/log-list/logged" class="profile-header__stat"><b>${stats.logged}</b><span>Games</span></a>
          <a href="#/profile/${esc(profile.username)}/followers" class="profile-header__stat"><b>${counts.followers}</b><span>Followers</span></a>
          <a href="#/profile/${esc(profile.username)}/following" class="profile-header__stat"><b>${counts.following}</b><span>Following</span></a>
        </div>
        ${!isOwn && state.user
          ? `<div class="profile-header__actions">
               <button class="btn btn--pill ${following ? 'btn--ghost' : 'btn--accent'}" id="follow-btn" data-following="${following}">${following ? 'Following' : 'Follow'}</button>
               ${MESSENGER_ARCHIVED ? '' : `<button class="icon-btn" id="message-user" aria-label="Message ${esc(profile.username)}" title="Message">${iconMessage()}</button>`}
             </div>`
          : ''}
      </div>

      <div class="segmented segmented--wide" id="profile-tabs">
        <button class="segmented__item segmented__item--active" data-tab="profile">Profile</button>
        <button class="segmented__item" data-tab="journal">Journal</button>
        <button class="segmented__item" data-tab="wanttoplay">Backlog</button>
        <button class="segmented__item" data-tab="lists">Lists</button>
      </div>

      <div id="profile-tab-content"></div>
    `;

    // Most-recently-played first, for the horizontal "Recently played" strip.
    const recentlyPlayed = diary
      .slice()
      .sort((a, b) => new Date(b.played_date || 0) - new Date(a.played_date || 0))
      .slice(0, 10);

    // ---- tab content renderers (all working off data already fetched above) ----
    const renderProfileTab = () => `
      <h2 class="section-heading">${favorites.length ? `Top ${SHOWCASE_MAX}` : 'Recently completed'}</h2>
      ${showcaseSlots.length ? showcaseGrid(showcaseSlots) : emptyState('Nothing completed yet.', { icon: iconStamp() })}

      ${recentlyPlayed.length ? `
        <h2 class="section-heading">Recently played</h2>
        <div class="recent-played-row">
          ${recentlyPlayed.map((l) => `
            <a href="#/game/${l.games.id}" class="recent-played-item" aria-label="${esc(l.games.title)}">
              ${posterFrame(l.games.cover_url, l.games.title, 'recent-played-item__cover')}
            </a>`).join('')}
        </div>` : ''}

      ${importedGames.length ? `
        <h2 class="section-heading">PlayStation library</h2>
        <div class="recent-played-row">
          ${importedGames.filter((g) => g.games).map((g) => `
            <a href="#/game/${g.games.id}" class="recent-played-item" aria-label="${esc(g.games.title)}">
              ${posterFrame(g.games.cover_url, g.name, 'recent-played-item__cover')}
              <span class="recent-played-item__hours">${formatImportedHours(g.playtime_minutes)}</span>
            </a>`).join('')}
        </div>` : ''}

      <div class="feed-section-head">
        <h2 class="section-heading">Currently playing</h2>
        ${isOwn ? `<button type="button" class="icon-btn icon-btn--small" id="add-playing" aria-label="Add a game you're currently playing">${iconSearch()}</button>` : ''}
      </div>
      ${playing.length
        ? `<div class="recent-played-row" id="playing-grid">${playing.map((l) => `
            <div class="playing-slot">
              <a href="#/game/${l.games.id}" class="recent-played-item" aria-label="${esc(l.games.title)}">
                ${posterFrame(l.games.cover_url, l.games.title, 'recent-played-item__cover')}
              </a>
              ${isOwn ? `<button type="button" class="playing-slot__remove" data-remove-log="${l.id}" aria-label="Remove from currently playing">${iconClose()}</button>` : ''}
            </div>`).join('')}</div>`
        : isOwn
          ? `<p class="muted playing-empty-hint">Nothing yet — tap the search icon above to add a game you're playing right now.</p>`
          : ''}

      <h2 class="section-heading">Ratings</h2>
      ${/* `total` and `average` are not optional extras here: with total
           left at its default of 0, ratingHistogram returns its "No
           ratings yet" empty state unconditionally — which is why this
           panel showed nothing on every profile, however many games the
           person had actually rated. stats.avgRating is already computed
           over exactly the same rows the breakdown counts. */ ''}
      ${ratingHistogram(breakdown, {
        average: stats.avgRating,
        total: Object.values(breakdown).reduce((sum, n) => sum + n, 0),
      })}

      <div class="stat-links stat-links--vertical">
        <a href="#/profile/${esc(profile.username)}/log-list/completed" class="stat-link">
          <b>${stats.totalPlayed}<span class="stat-link__year">/${stats.thisYear}</span></b><span>Completed (total/year)</span>
        </a>
        <a href="#/profile/${esc(profile.username)}/log-list/logged" class="stat-link"><b>${stats.logged}</b><span>Logged</span></a>
        <a href="#/profile/${esc(profile.username)}/log-list/reviews" class="stat-link"><b>${stats.reviews}</b><span>Reviews</span></a>
        <button type="button" class="stat-link" data-jump-tab="wanttoplay"><b>${stats.backlog}</b><span>Want to Play</span></button>
      </div>
    `;

    const renderJournalTab = () => `
      <h2 class="section-heading">Journal</h2>
      ${diary.length ? `
        <div class="diary-list">
          ${diary.map((l) => `
            <a href="#/game/${l.games.id}" class="diary-row">
              <img src="${esc(igdbSized(l.games.cover_url, 'cover_small') || '')}" alt="" class="diary-row__cover" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
              <div class="diary-row__main">
                <div class="diary-row__title">${esc(l.games.title)}</div>
                <div class="diary-row__meta">${l.played_date ? formatDate(l.played_date) : ''} ${l.rating ? starRow(l.rating, { size: 13 }) : ''}</div>
              </div>
              ${statusStamp(l.status)}
            </a>`).join('')}
        </div>` : emptyState(
          isOwn ? 'No journal entries yet. Log a game once you\'ve played it.' : 'No journal entries yet.',
          isOwn ? { icon: iconStamp(), actionLabel: 'Log your first game', actionRoute: '/log' } : { icon: iconStamp() }
        )}
    `;

    // Poster grid, three across (like the discover screen) — a want-to-play
    // pile reads best as cover art you browse, not a text list.
    const renderWantToPlayTab = () => `
      <h2 class="section-heading">Want to Play</h2>
      ${backlog.length ? `
        <div class="poster-grid3">
          ${backlog.map((l) => `
            <a href="#/game/${l.games.id}" class="poster-grid3__item">
              ${posterFrame(l.games.cover_url, l.games.title, 'poster-grid3__cover')}
            </a>`).join('')}
        </div>` : emptyState(
        'Nothing on the want-to-play list yet.',
        isOwn ? { icon: iconStamp(), actionLabel: 'Find a game', actionRoute: '/search' } : { icon: iconStamp() }
      )}
    `;

    const renderListsTab = () => `
      <div class="feed-section-head">
        <h2 class="section-heading">Lists</h2>
        ${isOwn ? `<button type="button" class="icon-btn icon-btn--small" id="new-list-btn" aria-label="New list">${iconPlus()}</button>` : ''}
      </div>
      ${lists.length ? `
        <div class="list-cards">
          ${lists.map(listCard).join('')}
        </div>` : emptyState(isOwn ? 'No lists yet. Make one for your favourite roguelikes, cozy games, anything.' : `${username} hasn't made any public lists yet.`, { icon: iconStamp() })}
    `;

    const tabRenderers = { profile: renderProfileTab, journal: renderJournalTab, wanttoplay: renderWantToPlayTab, lists: renderListsTab };
    const contentEl = qs('#profile-tab-content', body);

    function paintTab(tab) {
      contentEl.innerHTML = tabRenderers[tab]();
      wireRatingHistogram(contentEl);
      const followBtn = qs('#follow-btn', body);
      if (followBtn) wireFollowBtn(followBtn, profile);
      qsa('[data-jump-tab]', contentEl).forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.jumpTab;
          qsa('.segmented__item', qs('#profile-tabs', body)).forEach((b) => b.classList.toggle('segmented__item--active', b.dataset.tab === target));
          paintTab(target);
        });
      });
      const addPlayingBtn = qs('#add-playing', contentEl);
      if (addPlayingBtn) addPlayingBtn.addEventListener('click', openQuickAddPlaying);
      const newListBtn = qs('#new-list-btn', contentEl);
      if (newListBtn) newListBtn.addEventListener('click', openNewListForm);
      qsa('[data-remove-log]', contentEl).forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          if (!confirm('Remove this from currently playing?')) return;
          try {
            await api.deleteLog(btn.dataset.removeLog);
            refreshCurrentView();
          } catch (err) {
            toast(err.message || 'Could not remove that.', 'error');
          }
        });
      });
    }

    qsa('.segmented__item', qs('#profile-tabs', body)).forEach((btn) => {
      btn.addEventListener('click', () => {
        qsa('.segmented__item', qs('#profile-tabs', body)).forEach((b) => b.classList.toggle('segmented__item--active', b === btn));
        paintTab(btn.dataset.tab);
      });
    });

    paintTab('profile');

    // ---- header actions ----
    const shareUrl = `${location.origin}${location.pathname}#/profile/${profile.username}`;

    const shareProfile = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: `${profile.display_name || profile.username} on Playthruu`, url: shareUrl }); }
        catch { /* user cancelled the share sheet — nothing to do */ }
      } else {
        try { await navigator.clipboard.writeText(shareUrl); toast('Profile link copied.', 'success'); }
        catch { toast(shareUrl, 'info'); }
      }
    };

    // Share and the QR code used to be two chips pinned to the top right
    // of the header itself. They are behind the menu now, which is what
    // frees that corner — and what lets settings have the left one
    // without three controls fighting over the same strip.
    qs('#profile-menu', root)?.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      // No Cancel row. There are three ways out already — drag it down,
      // tap the backdrop, or press back — and a row that only closes the
      // sheet is a fourth that takes up the space of a real action.
      overlay.innerHTML = `
        <div class="sheet comment-sheet" data-swipe-handle>
          <div class="sheet__grip" aria-hidden="true"></div>
          <div class="comment-sheet__list">
            <button type="button" class="sheet-row" data-act="share">${iconShare()}<span>Share profile</span></button>
            <button type="button" class="sheet-row" data-act="qr">${iconQr()}<span>Show QR code</span></button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      const close = () => { overlay.remove(); document.body.style.overflow = ''; };
      // Back tears overlays down centrally without calling close(), so
      // the hook is what puts body scroll back. See app.js.
      overlay.__dismiss = close;
      enableSwipeToDismiss(qs('.comment-sheet', overlay), close);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) return close();
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        close();
        if (btn.dataset.act === 'share') shareProfile();
        if (btn.dataset.act === 'qr') openQrModal(shareUrl, profile);
      });
    });
    qs('#avatar-enlarge', body).addEventListener('click', () => openAvatarLightbox(profile));

    // The bio clamps to two lines. Whether there is a third to reveal is
    // not something the markup can know — it depends on the rendered line
    // count, which depends on the viewport AND on whether Manrope has
    // finished loading, since the fallback face sets to a different
    // width. So the toggle is offered only after measuring, and measured
    // again once fonts settle; a bio that fits stays a plain paragraph
    // with nothing to tap.
    const bioEl = qs('#profile-bio', body);
    const bioMore = qs('#profile-bio-more', body);
    if (bioEl && bioMore) {
      let expanded = false;
      const toggle = () => {
        expanded = !expanded;
        bioEl.classList.toggle('is-expanded', expanded);
        bioMore.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        // The control is three dots either way, so the state it is in has
        // to be said rather than drawn.
        bioMore.setAttribute('aria-label', expanded ? 'Show less of bio' : 'Show full bio');
      };
      const measure = () => {
        if (expanded) return;
        const overflows = bioEl.scrollHeight - bioEl.clientHeight > 1;
        bioMore.hidden = !overflows;
        bioEl.classList.toggle('is-clampable', overflows);
      };
      bioMore.addEventListener('click', toggle);
      // Tapping the text itself does the same thing, which is what was
      // asked for; the button is what keeps it reachable by keyboard.
      bioEl.addEventListener('click', () => { if (!bioMore.hidden) toggle(); });
      measure();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
      window.addEventListener('resize', measure);
    }

    if (!MESSENGER_ARCHIVED) {
      qs('#message-user', body)?.addEventListener('click', () => navigate(`/messages/new/${profile.id}`));
    }

    // Visitor's top-bar "more" — Block and Report, moved out of the
    // header's own icon row and into a sheet, matching the own-profile
    // masthead's Share/QR sheet exactly (same overlay markup, same
    // swipe-to-dismiss, no Cancel row).
    qs('#profile-more', root)?.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="sheet comment-sheet" data-swipe-handle>
          <div class="sheet__grip" aria-hidden="true"></div>
          <div class="comment-sheet__list">
            <button type="button" class="sheet-row" data-act="block">${iconBlock()}<span>Block @${esc(profile.username)}</span></button>
            <button type="button" class="sheet-row" data-act="report">${iconFlag()}<span>Report @${esc(profile.username)}</span></button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      const close = () => { overlay.remove(); document.body.style.overflow = ''; };
      overlay.__dismiss = close;
      enableSwipeToDismiss(qs('.comment-sheet', overlay), close);
      overlay.addEventListener('click', async (e) => {
        if (e.target === overlay) return close();
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        close();
        if (!state.user) { promptSignIn(btn.dataset.act === 'block' ? 'Sign in to block this account.' : 'Sign in to report this account.'); return; }
        if (btn.dataset.act === 'report') {
          openReportSheet({
            targetType: 'profile',
            targetId: profile.id,
            subject: `@${profile.username}`,
            onSubmit: api.reportContent,
          });
        } else if (btn.dataset.act === 'block') {
          // Blocking also unfollows in both directions — leaving a follow
          // edge in place after a block means the person you blocked keeps
          // appearing in your feed, which defeats the point.
          if (!confirm(`Block @${profile.username}? You won't see their reviews, and you'll both stop following each other.`)) return;
          try {
            await api.blockUser(profile.id);
            await Promise.allSettled([
              api.unfollow(state.user.id, profile.id),
              api.unfollow(profile.id, state.user.id),
            ]);
            api.invalidateBlockedCache();
            toast(`Blocked @${profile.username}.`, 'success');
            navigate('/feed');
          } catch (err) {
            toast(err.message || 'Could not block that user.', 'error');
          }
        }
      });
    });

    setCached(cacheKey, body.innerHTML);
    revealCornerAction();
  } catch (err) {
    // A cached version of this profile is already showing — leave it up
    // rather than replacing it with an error over a background refresh
    // hiccup (the pull-to-refresh above still works if they want to retry).
    if (!cachedProfile) body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this profile: ${esc(err.message)}</p>`;
    revealCornerAction();
  }
}

function wireFollowBtn(followBtn, profile) {
  followBtn.addEventListener('click', async () => {
    const currentlyFollowing = followBtn.dataset.following === 'true';
    followBtn.disabled = true;
    try {
      if (currentlyFollowing) await api.unfollow(state.user.id, profile.id);
      else await api.follow(state.user.id, profile.id);
      refreshCurrentView();
    } catch (err) {
      toast(err.message || 'Could not update follow status.', 'error');
      followBtn.disabled = false;
    }
  });
}

// Full-screen profile photo: a centred panel that spans the full width
// of the screen. Deliberately gesture-free — a profile picture is a
// single small square with nothing in it to inspect up close, so the
// zoom/pan handling this used to carry only got in the way of the one
// thing people actually do here, which is look at it and dismiss it.
function openAvatarLightbox(profile) {
  if (!profile.avatar_url) return;
  const overlay = document.createElement('div');
  overlay.className = 'avatar-viewer';
  overlay.innerHTML = `
    <button class="avatar-viewer__close" aria-label="Close">${iconClose()}</button>
    <div class="avatar-viewer__stage">
      <img src="${esc(profile.avatar_url)}" alt="${esc(profile.username)}" class="avatar-viewer__img" draggable="false">
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  qs('.avatar-viewer__close', overlay).addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
}

function openQrModal(shareUrl, profile) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(shareUrl)}`;
  overlay.innerHTML = `
    <div class="modal modal--qr">
      <header class="modal__header">
        <h2>Scan to view profile</h2>
        <button class="modal__close" data-close>${iconClose()}</button>
      </header>
      <div class="modal__body qr-modal__body">
        <img src="${qrSrc}" alt="QR code linking to ${esc(profile.username)}'s profile" width="260" height="260">
        <p class="muted">@${esc(profile.username)}</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qs('[data-close]', overlay).addEventListener('click', close);
}

// Lightweight picker for "currently playing" — deliberately skips the
// full log form (rating/review/date) since marking something as playing
// is a low-commitment, one-tap action, not a completed-game review.
function openQuickAddPlaying() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--tall">
      <header class="modal__header">
        <h2>Add to currently playing</h2>
        <button class="modal__close" data-close>${iconClose()}</button>
      </header>
      <div class="modal__body">
        <label class="field"><span>Search for a game</span><input type="text" id="playing-search" autocomplete="off" placeholder="Start typing a title…"></label>
        <div id="playing-results"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qs('[data-close]', overlay).addEventListener('click', close);

  const input = qs('#playing-search', overlay);
  const results = qs('#playing-results', overlay);

  async function addPlaying(gameId) {
    try {
      await api.createLog({ user_id: state.user.id, game_id: gameId, status: 'playing', is_public: true });
      pulseLogTab();
      close();
      toast('Added to currently playing.', 'success');
      refreshCurrentView();
    } catch (err) {
      toast(err.message || 'Could not add that game.', 'error');
    }
  }

  const doSearch = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    results.innerHTML = spinner();
    try {
      const { results: found } = await api.searchGamesEverywhere(q);
      results.innerHTML = combinedGameResults(found);
      wireCombinedGameResults(results, found, {
        onLocal: (g) => addPlaying(g.id),
        onRemote: async (g) => addPlaying((await api.addGame(g, state.user.id)).id),
      });
    } catch (err) {
      results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
    }
  }, 350);
  input.addEventListener('input', doSearch);
  input.focus();
}
