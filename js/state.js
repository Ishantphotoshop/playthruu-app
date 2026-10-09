// Single shared mutable object holding the current session.
// Views import this instead of passing user/profile through every call.
//
// The profile is also kept in localStorage whenever it is set, so the next
// launch can open straight onto the home screen with it instead of waiting
// on a network round-trip first (see loadSession in app.js).
const PROFILE_KEY = 'pt_profile';
let profile = null;

export const state = {
  user: null,     // Supabase auth user (has .id, .email)
  get profile() { return profile; },
  set profile(p) {
    profile = p;
    try {
      if (p && p.id) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
      else localStorage.removeItem(PROFILE_KEY);
    } catch { /* storage unavailable: just no fast start next time */ }
  },
};

// The profile saved by the last session, if it belongs to this user.
export function cachedProfile(userId) {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    return p && p.id === userId ? p : null;
  } catch { return null; }
}

export function isLoggedIn() {
  return !!state.user;
}
