// A tiny session-lived cache so switching back to a tab you already
// visited (Feed, News, Messages, your own Profile) paints instantly from
// whatever was there last time instead of showing a spinner and waiting
// on a fresh fetch every single time — that "it reloads every time I
// switch tabs" was the actual complaint. Each view still refetches in
// the background right after painting the cached snapshot, so it always
// catches back up to anything genuinely new within a moment; this only
// removes the wait, not the eventual freshness.
//
// Holds whatever shape each view finds useful to cache — a rendered
// HTML string for views that just repaint a container wholesale (Feed,
// News), or raw fetched data for a view whose paint() depends on other
// local state too, like Messages' Messages/Requests sub-tab.
//
// Deliberately just a plain in-memory Map, not localStorage/IndexedDB —
// it only needs to survive switching tabs within the same open app
// session, not a full reload, and never persisting it means there's
// nothing stale to accidentally show a different signed-in user later.
const store = new Map();

// Shared so a view and the background warm-up in app.js can't drift onto
// two different spellings of the same key — a warm that writes 'messages'
// while the view reads 'messages-list' silently does nothing at all.
export const CACHE_KEYS = {
  messages: 'messages',
  searchTrending: 'search-idle-trending',
};

export function getCached(key) {
  return store.get(key) ?? null;
}

export function setCached(key, value) {
  store.set(key, value);
}

// Called on sign-out so the next account in on this device never has a
// chance of momentarily seeing the previous person's cached Feed/
// Messages/Profile flash on screen before their own data loads in.
export function clearViewCache() {
  store.clear();
}

// Dropped whenever a diary entry is created, changed or deleted.
//
// Both of these cache RENDERED MARKUP that has a game's status baked
// into it — the feed's "Currently playing" strip, the profile's
// Diary/Playing/Backlog tabs. Without this, marking a game played left
// every one of those painting the previous answer from cache on the way
// back, so the same game read as "playing" on one screen and "played"
// on another. Nothing was wrong with the data; each screen was just
// showing a different snapshot of it.
export function invalidateLogViews() {
  for (const key of [...store.keys()]) {
    if (key === 'feed' || key.startsWith('profile:')) store.delete(key);
  }
}
