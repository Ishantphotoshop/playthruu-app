// Native haptics in the app shell, the Vibration API on Android browsers.
// iOS Safari has no web vibration, so this is silent there.
export function buzz(pattern = 8) {
  const haptics = window.Capacitor?.Plugins?.Haptics;
  if (haptics) { haptics.impact({ style: 'LIGHT' }).catch(() => {}); return; }
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
