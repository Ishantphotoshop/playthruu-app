// Initializes the Supabase client once and shares it across the app.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured =
  SUPABASE_URL && !SUPABASE_URL.includes('YOUR_') &&
  SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('YOUR_');

// If config.js hasn't been filled in yet, we still export a client
// object so the app doesn't crash on load — every real call will
// fail gracefully and the UI shows a "not connected yet" state
// instead of a blank white screen.
export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');
