import * as api from '../api.js';
import { state } from '../state.js';
import {
  topBar, navBar, spinner, avatarImg, gameCard, showcaseGrid, SHOWCASE_MAX, ratingHistogram, wireRatingHistogram, posterFrame,
  emptyState, iconStamp, iconSettings, iconShare, iconQr, iconClose, iconSearch, iconPlus, listCard, iconFlame, iconMessage,
  combinedGameResults, wireCombinedGameResults, openReportSheet, iconFlag, iconBlock,
} from '../components.js';
import { esc, formatDate, statusStamp, starRow, qs, qsa, toast, debounce, pulseLogTab } from '../utils.js';
import { refreshCurrentView, navigate } from '../router.js';
import { wirePullToRefresh } from './feed-view.js';
import { openNewListForm } from './lists-view.js';
import { getCached, setCached } from '../cache.js';

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
  // Own profile drops the header bar entirely, same as Search/Messages —
  // just the settings icon floating in the corner of the content itself.
  // Someone else's profile still needs the back button and their actual
  // name, so that case keeps its real topBar untouched.
  root.innerHTML = (isOwn ? '' : topBar(username, { back: true })) +
    `<div class="view-body${isOwn ? ' view-body--no-topbar' : ''}" id="profile-body">
       ${isOwn ? `<a class="view-body__corner-action" href="#/settings" aria-label="Settings">${iconSettings()}</a>` : ''}
       ${cachedProfile || spinner()}
     </div>` + navBar(isOwn ? '/me' : '');
  const body = qs('#profile-body', root);
  wirePullToRefresh(body);

  try {
    const profile = isOwn ? state.profile : await api.getProfileByUsername(username);
    const [stats, counts, logs, favorites, breakdown, lists, following] = await Promise.all([
      api.getUserStats(profile.id),
      api.getFollowCounts(profile.id),
      api.getLogsForUser(profile.id, { limit: 200 }),
      api.getFavorites(profile.id),
      api.getRatingBreakdown(profile.id),
      api.getListsForUser(profile.id),
      state.user ? api.isFollowing(state.user.id, profile.id) : Promise.resolve(false),
    ]);

    const diary = logs.filter((l) => l.status === 'played' || l.status === 'dropped');
    const backlog = logs.filter((l) => l.status === 'backlog');
    const playing = logs.filter((l) => l.status === 'playing');

    const showcaseSlots = favorites.length
      ? favorites.slice(0, SHOWCASE_MAX).map((f) => {
          const match = logs.find((l) => l.game_id === f.game_id);
          return { game: f.games, rating: match?.rating, reviewed: !!match?.review };
        })
      : diary.slice(0, SHOWCASE_MAX).map((l) => ({ game: l.games, rating: l.rating, reviewed: !!l.review }));

    const pronounLabel = profile.pronouns === 'custom' ? profile.pronouns_custom : profile.pronouns;

    body.innerHTML = `
      <div class="profile-header profile-header--hero">
        <div class="profile-header__share-row profile-header__share-row--corner">
          <button class="icon-btn" id="share-profile" aria-label="Share profile">${iconShare()}</button>
          <button class="icon-btn" id="show-qr" aria-label="Show QR code">${iconQr()}</button>
        </div>
        <button class="profile-header__avatar-btn" id="avatar-enlarge" aria-label="View profile photo">
          ${avatarImg(profile, 96)}
        </button>
        <h1>${esc(profile.display_name || profile.username)}</h1>
        <p class="profile-header__username">@${esc(profile.username)}${pronounLabel ? ` · ${esc(pronounLabel)}` : ''}</p>
        ${profile.bio ? `<p class="profile-header__bio">${esc(profile.bio)}</p>` : ''}
        ${stats.totalHours > 0 || stats.streak >= 2 ? `
          <div class="profile-header__badges">
            ${stats.totalHours > 0 ? `<span class="profile-header__hours">${stats.totalHours.toLocaleString('en-US')}h logged</span>` : ''}
            ${stats.streak >= 2 ? `<span class="profile-header__streak">${iconFlame()}${stats.streak} day streak</span>` : ''}
          </div>` : ''}
        ${!isOwn && state.user
          ? `<div class="profile-header__actions">
               <button class="btn ${following ? 'btn--ghost' : 'btn--accent'}" id="follow-btn" data-following="${following}">${following ? 'Following' : 'Follow'}</button>
               <button class="icon-btn" id="message-user" aria-label="Message ${esc(profile.username)}" title="Message">${iconMessage()}</button>
               <button class="icon-btn" id="block-user" aria-label="Block ${esc(profile.username)}" title="Block">${iconBlock()}</button>
               <button class="icon-btn" id="report-user" aria-label="Report ${esc(profile.username)}" title="Report">${iconFlag()}</button>
             </div>`
          : ''}
      </div>

      <div class="segmented segmented--wide" id="profile-tabs">
        <button class="segmented__item segmented__item--active" data-tab="profile">Profile</button>
        <button class="segmented__item" data-tab="journal">Journal</button>
        <button class="segmented__item" data-tab="wanttoplay">Want to Play</button>
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
            <a href="#/game/${l.games.id}" class="recent-played-item">
              ${posterFrame(l.games.cover_url, l.games.title, 'recent-played-item__cover')}
            </a>`).join('')}
        </div>` : ''}

      <div class="feed-section-head">
        <h2 class="section-heading">Currently playing</h2>
        ${isOwn ? `<button type="button" class="icon-btn icon-btn--small" id="add-playing" aria-label="Add a game you're currently playing">${iconSearch()}</button>` : ''}
      </div>
      ${playing.length
        ? `<div class="recent-played-row" id="playing-grid">${playing.map((l) => `
            <div class="playing-slot">
              <a href="#/game/${l.games.id}" class="recent-played-item">
                ${posterFrame(l.games.cover_url, l.games.title, 'recent-played-item__cover')}
              </a>
              ${isOwn ? `<button type="button" class="playing-slot__remove" data-remove-log="${l.id}" aria-label="Remove from currently playing">${iconClose()}</button>` : ''}
            </div>`).join('')}</div>`
        : isOwn
          ? `<p class="muted playing-empty-hint">Nothing yet — tap the search icon above to add a game you're playing right now.</p>`
          : ''}

      <h2 class="section-heading">Ratings</h2>
      ${ratingHistogram(breakdown)}

      <div class="stat-links stat-links--vertical">
        <a href="#/profile/${esc(profile.username)}/log-list/completed" class="stat-link">
          <b>${stats.totalPlayed}<span class="stat-link__year">/${stats.thisYear}</span></b><span>Completed (total/year)</span>
        </a>
        <a href="#/profile/${esc(profile.username)}/log-list/logged" class="stat-link"><b>${stats.logged}</b><span>Logged</span></a>
        <a href="#/profile/${esc(profile.username)}/log-list/reviews" class="stat-link"><b>${stats.reviews}</b><span>Reviews</span></a>
        <button type="button" class="stat-link" data-jump-tab="wanttoplay"><b>${stats.backlog}</b><span>Want to Play</span></button>
        <a href="#/profile/${esc(profile.username)}/followers" class="stat-link"><b>${counts.followers}</b><span>Followers</span></a>
        <a href="#/profile/${esc(profile.username)}/following" class="stat-link"><b>${counts.following}</b><span>Following</span></a>
      </div>
    `;

    const renderJournalTab = () => `
      <h2 class="section-heading">Journal</h2>
      ${diary.length ? `
        <div class="diary-list">
          ${diary.map((l) => `
            <a href="#/game/${l.games.id}" class="diary-row">
              <img src="${esc(l.games.cover_url || '')}" alt="" class="diary-row__cover" onerror="this.style.visibility='hidden'">
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
        </div>` : emptyState(isOwn ? 'No lists yet. Make one for your favorite roguelikes, cozy games, anything.' : `${username} hasn't made any public lists yet.`, { icon: iconStamp() })}
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
    qs('#share-profile', body).addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: `${profile.display_name || profile.username} on Playthruu`, url: shareUrl }); }
        catch { /* user cancelled the share sheet — nothing to do */ }
      } else {
        try { await navigator.clipboard.writeText(shareUrl); toast('Profile link copied.', 'success'); }
        catch { toast(shareUrl, 'info'); }
      }
    });

    qs('#show-qr', body).addEventListener('click', () => openQrModal(shareUrl, profile));
    qs('#avatar-enlarge', body).addEventListener('click', () => openAvatarLightbox(profile));

    qs('#message-user', body)?.addEventListener('click', () => navigate(`/messages/new/${profile.id}`));

    qs('#report-user', body)?.addEventListener('click', () => {
      openReportSheet({
        targetType: 'profile',
        targetId: profile.id,
        subject: `@${profile.username}`,
        onSubmit: api.reportContent,
      });
    });

    qs('#block-user', body)?.addEventListener('click', async () => {
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
    });

    setCached(cacheKey, body.innerHTML);
  } catch (err) {
    // A cached version of this profile is already showing — leave it up
    // rather than replacing it with an error over a background refresh
    // hiccup (the pull-to-refresh above still works if they want to retry).
    if (!cachedProfile) body.innerHTML = `<p class="muted" style="padding:24px">Couldn't load this profile: ${esc(err.message)}</p>`;
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
// of the screen, with the same gesture set as the game-poster viewer —
// double-tap to zoom, pinch to zoom, and drag to pan once zoomed in.
function openAvatarLightbox(profile) {
  if (!profile.avatar_url) return;
  const overlay = document.createElement('div');
  overlay.className = 'avatar-viewer';
  overlay.innerHTML = `
    <button class="avatar-viewer__close" aria-label="Close">${iconClose()}</button>
    <div class="avatar-viewer__stage">
      <img src="${esc(profile.avatar_url)}" alt="${esc(profile.username)}" class="avatar-viewer__img" draggable="false">
    </div>
    <p class="avatar-viewer__hint">Pinch or double-tap to zoom</p>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const img = qs('.avatar-viewer__img', overlay);
  const MIN = 1, MAX = 4;
  let scale = 1, tx = 0, ty = 0;

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
  };

  // Keeps the image from being dragged off-screen: the further it's
  // zoomed, the more slack there is to pan within.
  const clamp = () => {
    const r = img.getBoundingClientRect();
    const maxX = Math.max(0, (r.width - overlay.clientWidth) / 2);
    const maxY = Math.max(0, (r.height - overlay.clientHeight) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  };

  const close = () => { overlay.remove(); document.body.style.overflow = ''; };
  qs('.avatar-viewer__close', overlay).addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    // Only the backdrop dismisses — never the photo itself.
    if (e.target === overlay || e.target.classList.contains('avatar-viewer__stage')) close();
  });

  let lastTap = 0;
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTap < 300) {
      scale = scale > 1 ? 1 : 2.4;
      if (scale === 1) { tx = 0; ty = 0; } else { clamp(); }
      apply();
    }
    lastTap = now;
  });

  // --- pointer gestures -------------------------------------------
  // Tracked by pointerId so a second finger landing mid-drag switches
  // cleanly from panning to pinching without the image jumping.
  const points = new Map();
  let startDist = 0, startScale = 1, startTx = 0, startTy = 0, startMid = null;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  overlay.addEventListener('pointerdown', (e) => {
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    overlay.setPointerCapture(e.pointerId);
    const pts = [...points.values()];
    if (pts.length === 2) {
      startDist = dist(pts[0], pts[1]);
      startMid = mid(pts[0], pts[1]);
    }
    startScale = scale; startTx = tx; startTy = ty;
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!points.has(e.pointerId)) return;
    const prev = points.get(e.pointerId);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...points.values()];

    if (pts.length >= 2 && startDist > 0) {
      e.preventDefault();
      const next = dist(pts[0], pts[1]) / startDist;
      scale = Math.min(MAX, Math.max(MIN, startScale * next));
      const m = mid(pts[0], pts[1]);
      if (startMid) { tx = startTx + (m.x - startMid.x); ty = startTy + (m.y - startMid.y); }
      if (scale === 1) { tx = 0; ty = 0; } else clamp();
      apply();
    } else if (pts.length === 1 && scale > 1) {
      e.preventDefault();
      tx += e.clientX - prev.x;
      ty += e.clientY - prev.y;
      clamp();
      apply();
    }
  });

  const release = (e) => {
    points.delete(e.pointerId);
    if (points.size < 2) startDist = 0;
    if (scale <= 1) { tx = 0; ty = 0; apply(); }
  };
  overlay.addEventListener('pointerup', release);
  overlay.addEventListener('pointercancel', release);

  apply();
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
