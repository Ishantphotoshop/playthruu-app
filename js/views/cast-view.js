import * as api from '../api.js';
import { esc, qs, qsa } from '../utils.js';

// The Cast tab on a game page: who voiced and who performed each
// character. Replaces the old Wikidata lookup, which ran live from the
// browser on every visit and knew about almost nothing outside the very
// biggest releases. This reads our own tables instead — filled the first
// time anyone opens a game's Cast tab, from public web pages, by the
// fetch-cast Edge Function (see supabase/functions/fetch-cast).
//
// That first lookup genuinely takes a few seconds: it searches, reads
// pages and extracts names. So the tab shows skeleton rows rather than a
// spinner — the shape of what is coming is more reassuring than a
// circle, and it is the same wait only ever paid once per game, by
// whoever happens to open it first.
//
// Everything on screen says where it came from: the sources are one tap
// away at the bottom. A name only one site carried is still shown — one
// decent source is worth more than an empty tab — it simply sits below
// the ones several sites agreed on.
//
// Portraits come from Wikipedia and are saved alongside the name (the
// URL, not the picture). Most voice actors have no article, so the
// initial-letter tile is the normal case rather than a failure, which is
// exactly how the director credit on this same page already behaves.

// Per-tab memory only — a tab switch away and back must not refetch, but
// a reload should, since another visitor's lookup may have filled the
// table in the meantime.
const memory = new Map();

const ROLE_LABEL = {
  voice: 'Voice',
  mocap: 'Mocap',
  voice_and_mocap: 'Voice + mocap',
};

function skeletonRows(n = 5) {
  return `<div class="cast-list">${Array.from({ length: n }, () => `
    <div class="cast-row cast-row--skeleton">
      <span class="skeleton cast-row__photo"></span>
      <div class="cast-row__who">
        <div class="skeleton skeleton--line" style="width:58%"></div>
        <div class="skeleton skeleton--line skeleton--line-sm" style="width:36%;margin-top:6px"></div>
      </div>
    </div>`).join('')}</div>`;
}

// Same treatment as the director's portrait, down to the onerror swap:
// a Commons file that 404s or refuses to be hotlinked falls back to the
// letter tile instead of leaving a broken-image box in the list.
function facePic(entry) {
  const initial = esc((entry.person || '?').charAt(0).toUpperCase());
  return entry.photo
    ? `<img class="cast-row__photo" src="${esc(entry.photo)}" alt="" loading="lazy"
            onerror="this.outerHTML='<span class=\'cast-row__photo cast-row__photo--initial\'>${initial}</span>'">`
    : `<span class="cast-row__photo cast-row__photo--initial">${initial}</span>`;
}

function castRowHtml(entry) {
  const role = ROLE_LABEL[entry.role_type] || '';
  return `
    <div class="cast-row">
      ${facePic(entry)}
      <div class="cast-row__who">
        <span class="cast-row__name">${esc(entry.person)}</span>
        ${entry.character ? `<span class="cast-row__char">${esc(entry.character)}</span>` : ''}
      </div>
      ${role ? `<span class="cast-tag">${esc(role)}</span>` : ''}
    </div>`;
}

function sourcesHtml(cast) {
  const urls = [...new Set(cast.flatMap((c) => c.source_urls || []))];
  if (!urls.length) return '';
  return `
    <details class="cast-sources">
      <summary class="cast-sources__summary">Sources (${urls.length})</summary>
      <ul class="cast-sources__list">
        ${urls.map((u) => {
          let host = u;
          try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* keep the raw string */ }
          return `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(host)}</a></li>`;
        }).join('')}
      </ul>
    </details>`;
}

// The ones with a face and a character, that several sites agreed on,
// first — that is what someone opened this tab to look at. `verified` no
// longer shows as a label anywhere, but it is still the best signal of
// which credits to lead with.
function order(cast) {
  const rank = (c) => (c.verified ? 0 : 4) + (c.character ? 0 : 2) + (c.photo ? 0 : 1);
  return [...cast].sort((a, b) => rank(a) - rank(b) || a.person.localeCompare(b.person));
}

const CAST_SHOWN = 8;

export async function paintCast(slot, game) {
  const igdbId = Number(game?.igdb_id);
  if (!slot) return;
  if (!Number.isInteger(igdbId) || igdbId <= 0) {
    slot.innerHTML = `<p class="gd-empty">No cast found yet for this game.</p>`;
    return;
  }

  const cached = memory.get(igdbId);
  if (cached) { render(cached); return; }

  slot.innerHTML = skeletonRows();
  let result;
  try {
    result = await api.getGameCast(igdbId);
  } catch {
    if (!slot.isConnected) return;
    slot.innerHTML = `<p class="gd-empty">Couldn't load the cast right now. Try again in a moment.</p>`;
    return;
  }
  if (!slot.isConnected) return; // tab switched, or the page was left
  // 'busy' means somebody else's lookup is already running (or today's
  // budget is spent): not an answer, so it is deliberately NOT cached —
  // reopening the tab in a minute asks again and usually gets it.
  if (result.status !== 'busy') memory.set(igdbId, result);
  render(result);

  function render({ status, cast }) {
    if (status === 'busy') {
      slot.innerHTML = `<p class="gd-empty">Looking this one up — check back in a minute.</p>`;
      return;
    }
    if (status === 'error') {
      slot.innerHTML = `<p class="gd-empty">Couldn't load the cast right now. Try again in a moment.</p>`;
      return;
    }
    if (!cast.length) {
      slot.innerHTML = `<p class="gd-empty">No cast found yet.</p>`;
      return;
    }
    const rows = order(cast);
    const extra = rows.length - CAST_SHOWN;
    slot.innerHTML = `
      <div class="cast-list">${rows.map(castRowHtml).join('')}</div>
      ${extra > 0 ? `<button type="button" class="gd-showmore" data-cast-more>Show more (${extra})</button>` : ''}
      ${sourcesHtml(cast)}
      <p class="cast-foot">Cast info gathered from public web sources</p>`;
    if (extra > 0) {
      qsa('.cast-row', slot).forEach((row, i) => { if (i >= CAST_SHOWN) row.hidden = true; });
      qs('[data-cast-more]', slot).addEventListener('click', (e) => {
        qsa('.cast-row', slot).forEach((row) => { row.hidden = false; });
        e.currentTarget.remove();
      });
    }
  }
}
