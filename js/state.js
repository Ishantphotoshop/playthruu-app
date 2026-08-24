// Single shared mutable object holding the current session.
// Views import this instead of passing user/profile through every call.
export const state = {
  user: null,     // Supabase auth user (has .id, .email)
  profile: null,  // matching row from public.profiles
};

export function isLoggedIn() {
  return !!state.user;
}
