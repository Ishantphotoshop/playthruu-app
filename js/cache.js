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
