import { signIn, signUp, signInWithProvider, sendPasswordReset } from '../auth.js';
import { toast, qs, qsa, enableSwipeToDismiss } from '../utils.js';
import { configured } from '../supabase-client.js';
import { getLoginBackground, openCreditedGame } from '../api.js';
import { iconUser, iconLock, iconMail, iconEye, iconEyeOff, iconClose, iconBack } from '../components.js';
import { renderLandingView } from './landing-view.js';
import { navigate } from '../router.js';
import { getTheme } from '../theme.js';

// Only providers actually switched on in Supabase belong here — a button
// for a disabled provider fails with an unhelpful error the moment it's
// tapped. To add another, enable it under
// Authentication -> Sign In / Providers, then add an entry here.
//
// Each one renders as a solid brand-coloured disc with a white mark, the
// way storefront badges do. Google is the exception: its brand terms
// require the four-colour "G" on white, so it carries its own fills and
// sits on a white disc rather than a coloured one.
const OAUTH_PROVIDERS = [
  {
    id: 'google',
    label: 'Google',
    bg: '#ffffff',
    icon: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z"/></svg>`,
  },
  {
    id: 'twitch',
    label: 'Twitch',
    bg: '#9146ff',
    icon: `<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M4.3 2 2.5 6.4v15.1h5.2V24h2.9l2.6-2.5h4.2l5.6-5.4V2zm2 2h13.8v10.7l-3.3 3.2h-4.4l-2.6 2.5v-2.5H6.3zm4.6 3v6h2V7zm5.3 0v6h2V7z"/></svg>`,
  },
  {
    id: 'discord',
    label: 'Discord',
    bg: '#5865f2',
    icon: `<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M19.3 5.4A16.8 16.8 0 0 0 15.1 4l-.2.4a15.6 15.6 0 0 1 3.7 1.9 13.3 13.3 0 0 0-11.2 0 15.6 15.6 0 0 1 3.7-1.9L10.9 4a16.8 16.8 0 0 0-4.2 1.4C4 9.3 3.3 13.1 3.6 16.8A16.9 16.9 0 0 0 8.8 20l1-1.4a11 11 0 0 1-1.7-.8l.4-.3a12.1 12.1 0 0 0 10.9 0l.4.3a11 11 0 0 1-1.7.8l1 1.4a16.9 16.9 0 0 0 5.2-3.2c.4-4.3-.7-8.1-2.9-11.4zM9.7 14.7c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1zm4.6 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1z"/></svg>`,
  },
];

const ROTATE_MS = 5000;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Popup shown when "Continue with" is tapped — a plain list of the
// providers. Uses the app's shared .modal-overlay so it looks like every
// other sheet and is dismissed by the same Android back-button handler.
function openProviderPopup() {
  const overlay = document.createElement('div');
  // Plain, not glass — the whole login screen behind blurs directly
  // instead (see the class toggle below), which works reliably
  // everywhere unlike backdrop-filter on the popup itself, which
  // never composited correctly on a real device across several
  // attempts.
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--providers">
      <header class="modal__header">
        <h2>Continue with</h2>
        <button class="modal__close" data-close aria-label="Close">${iconClose()}</button>
      </header>
      <div class="modal__body">
        <div class="provider-list">
          ${OAUTH_PROVIDERS.map((p) => `
            <button type="button" class="provider-row" data-provider="${p.id}">
              <span class="provider-row__disc" style="--orb-bg:${p.bg}">${p.icon}</span>
              <span class="provider-row__label">Continue with ${p.label}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  // Blur the whole login screen behind the popup — art, wordmark,
  // form fields, all of it — not just the popup itself. A plain CSS
  // filter on the real screen element, which doesn't depend on
  // backdrop-filter compositing at all.
  const screen = qs('.auth-screen');
  if (screen) screen.classList.add('auth-screen--blurred');

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (screen) screen.classList.remove('auth-screen--blurred');
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qsa('[data-close]', overlay).forEach((b) => b.addEventListener('click', close));
  enableSwipeToDismiss(qs('.modal', overlay), close);

  qsa('[data-provider]', overlay).forEach((btn) => {
    btn.addEventListener('click', async () => {
      // On success the browser leaves for the provider, so nothing after
      // this runs. Buttons only re-enable if the redirect never fired.
      qsa('[data-provider]', overlay).forEach((b) => { b.disabled = true; });
      try {
        await signInWithProvider(btn.dataset.provider);
      } catch (err) {
        toast(err.message || 'Could not start that sign-in.', 'error');
        qsa('[data-provider]', overlay).forEach((b) => { b.disabled = false; });
      }
    });
  });
}

// Same modal shell as openProviderPopup above — just ask for the email
// and send the reset link. Supabase itself decides whether that email
// actually has an account; this never confirms or denies either way, so
// it can't be used to check who's registered.
function openForgotPasswordPopup() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal-overlay--glass';
  overlay.innerHTML = `
    <div class="modal">
      <header class="modal__header">
        <h2>Reset your password</h2>
        <button class="modal__close" data-close aria-label="Close">${iconClose()}</button>
      </header>
      <div class="modal__body">
        <p class="modal__hint">Enter the email on your account and we'll send you a link to set a new password.</p>
        <form id="forgot-password-form">
          <label class="field field--icon">
            <span>Email</span>
            <div class="field__input-wrap">
              <span class="field__icon">${iconMail()}</span>
              <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
            </div>
          </label>
          <button type="submit" class="btn btn--accent btn--block">Send reset link</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const close = () => {
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  qsa('[data-close]', overlay).forEach((b) => b.addEventListener('click', close));
  enableSwipeToDismiss(qs('.modal', overlay), close);

  qs('#forgot-password-form', overlay).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type="submit"]', overlay);
    const email = new FormData(e.target).get('email');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await sendPasswordReset(email);
      toast('Check your email for a reset link.', 'success');
      close();
    } catch (err) {
      toast(err.message || 'Could not send that reset link.', 'error');
      btn.disabled = false;
      btn.textContent = 'Send reset link';
    }
  });
}

export function renderAuthView(root, { startMode = 'signin' } = {}) {
  // Lets a caller (the landing page's "Sign up" vs "Log in" buttons)
  // land directly on the right form instead of always opening on signin.
  let mode = startMode === 'signup' ? 'signup' : 'signin';
  let currentUrl = null;
  let currentTitle = null;
  let activeLayer = 'a';
  let rotateTimer = null;
  let passwordVisible = false;

  // Puts whatever we've already loaded onto layer "a" instantly (no
  // fade) — used right after a repaint (e.g. switching signin/signup),
  // since that's a fresh DOM, not an actual image change.
  function showCurrentInstant() {
    activeLayer = 'a';
    const el = qs('.auth-screen__art--a', root);
    if (el && currentUrl) el.style.backgroundImage = `url("${currentUrl}")`;
    const btn = qs('#auth-credit', root);
    const label = qs('#auth-credit-game', root);
    if (label) label.textContent = currentTitle || '';
    if (btn) btn.hidden = !currentTitle;
  }

  // Fades the credit label out, swaps the text once it's invisible, then
  // fades it back in — timed to roughly line up with the art's own
  // 1.1s crossfade so the two never feel like separate, unrelated swaps.
  // currentTitle (what a tap actually resolves and navigates to) is set
  // HERE, not in crossfadeTo — it used to update the instant a new photo
  // started loading, well before the visible label caught up 650ms
  // later. For that whole window the button still displayed the
  // previous game's name while a tap would silently open the NEXT one —
  // exactly the "Art from Indika" that actually opened Doki Doki
  // Literature Club" bug. Now currentTitle changes at the same moment
  // the visible text does, so whatever's on screen is always what a tap
  // actually opens.
  function fadeCreditTo(title) {
    const btn = qs('#auth-credit', root);
    const label = qs('#auth-credit-game', root);
    if (!btn || !label) return;
    if (!title) { currentTitle = null; btn.hidden = true; return; }
    if (label.textContent === title) { currentTitle = title; return; } // same game already showing
    btn.hidden = false;
    btn.classList.add('is-fading');
    setTimeout(() => {
      if (!qs('#auth-credit-game', root)) return; // view torn down mid-fade
      label.textContent = title;
      currentTitle = title;
      btn.classList.remove('is-fading');
    }, 650);
  }

  // Netflix-style crossfade: paint the new image onto the hidden layer,
  // fade it in while fading the old one out, then that becomes "active".
  function crossfadeTo(url, title) {
    const nextLetter = activeLayer === 'a' ? 'b' : 'a';
    const nextEl = qs(`.auth-screen__art--${nextLetter}`, root);
    const currentEl = qs(`.auth-screen__art--${activeLayer}`, root);
    if (!nextEl) return;
    nextEl.style.backgroundImage = `url("${url}")`;
    nextEl.classList.add('is-active');
    if (currentEl) currentEl.classList.remove('is-active');
    activeLayer = nextLetter;
    currentUrl = url;
    fadeCreditTo(title);
    // Fired the moment the image starts showing, not on tap — the photo
    // sits on screen for ROTATE_MS (5s) before the next rotation, which
    // is normally plenty of time for the search + addGame round trip to
    // finish quietly in the background. openCreditedGame caches by
    // title, so if a tap lands before this resolves it just joins the
    // same in-flight request instead of starting a second one.
    if (title) openCreditedGame(title).catch(() => {});
  }

  // Preloads the actual image bytes before crossfading, so it never
  // fades in a half-loaded/blank frame.
  function loadAndCrossfade() {
    getLoginBackground().then(({ url, title } = {}) => {
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        if (!qs('.auth-screen__art--a', root)) { clearInterval(rotateTimer); return; } // view was torn down
        crossfadeTo(url, title);
      };
      img.src = url;
    }).catch(() => {});
  }

  // Tapping the credit resolves the title to a real catalogue entry and
  // opens its page — same lookup the landing-page poster wall uses. Most
  // of these are niche titles nobody's opened in the app yet, so the
  // common failure isn't a bad match, it's the same anonymous-write wall
  // openGame() hits in landing-view.js: adding a genuinely new game to
  // the catalogue needs an account, and this screen is exactly where to
  // get one — so that's the message, not a generic "something broke".
  async function openCredit() {
    const btn = qs('#auth-credit', root);
    if (!btn || btn.disabled || !currentTitle) return;
    const title = currentTitle;
    btn.disabled = true;
    const label = qs('#auth-credit-game', root);
    const originalLabel = label?.textContent;
    if (label) label.textContent = 'Opening…';
    try {
      const gameId = await openCreditedGame(title);
      if (rotateTimer) clearInterval(rotateTimer);
      navigate(`/game/${gameId}`);
    } catch {
      toast(`Sign up to open ${title} — it's new to Playthruu.`, 'info');
      btn.disabled = false;
      if (label) label.textContent = originalLabel;
    }
  }

  function paint() {
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-screen__art-wrap">
          <div class="auth-screen__art auth-screen__art--a is-active"></div>
          <div class="auth-screen__art auth-screen__art--b"></div>
        </div>

        <button type="button" class="auth-screen__back" id="auth-back-to-landing" aria-label="Back">${iconBack()}</button>
        <button type="button" class="auth-screen__credit" id="auth-credit" hidden>Art from <span id="auth-credit-game"></span></button>

        <div class="auth-screen__content">
        <div class="auth-screen__brand">
          <div class="auth-screen__brand-row">
            <img src="icons/${getTheme() === 'light' ? 'mark-orange' : 'mark-blue'}.svg" alt="" class="auth-screen__mark">
            <h1>PlayThruu</h1>
          </div>
          <p>LOG it. Rate it. Review it. Remember it</p>
        </div>

        ${!configured ? `
          <div class="auth-screen__warning">
            <strong>Not connected yet.</strong> Add your Supabase URL and anon key to
            <code>js/config.js</code> before signing up — see README.md.
          </div>` : ''}

        <form class="auth-form" id="auth-form">
          ${mode === 'signup' ? `
            <label class="field field--icon">
              <span>Username</span>
              <div class="field__input-wrap">
                <span class="field__icon">${iconUser()}</span>
                <input type="text" name="username" placeholder="yourusername" autocomplete="username" required minlength="1" maxlength="20" pattern="[a-zA-Z0-9._]+">
              </div>
            </label>` : ''}
          <label class="field field--icon">
            <span>${mode === 'signup' ? 'Email' : 'Username/Email'}</span>
            <div class="field__input-wrap">
              <span class="field__icon">${mode === 'signup' ? iconMail() : iconUser()}</span>
              <input type="text" name="identifier" placeholder="${mode === 'signup' ? 'you@example.com' : 'Username or email'}" autocomplete="${mode === 'signup' ? 'email' : 'username'}" required>
            </div>
          </label>
          <label class="field field--icon field--password">
            <span>Password</span>
            <div class="field__input-wrap">
              <span class="field__icon">${iconLock()}</span>
              <input type="${passwordVisible ? 'text' : 'password'}" name="password" id="password-input" placeholder="••••••••" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required minlength="6">
              <button type="button" class="field__toggle" id="toggle-password" aria-label="${passwordVisible ? 'Hide password' : 'Show password'}">${passwordVisible ? iconEyeOff() : iconEye()}</button>
            </div>
          </label>
          ${mode === 'signin' ? `<button type="button" class="auth-form__forgot" id="forgot-password">Forgot password?</button>` : ''}
          <button type="submit" class="btn btn--accent btn--block">${mode === 'signup' ? 'Settle in' : 'LOGin'}</button>
        </form>

        <div class="auth-divider"><span>or</span></div>
        <button type="button" class="auth-continue" id="social-trigger" aria-label="Continue with a social account">
          <span class="auth-continue__label">Continue with</span>
          <span class="auth-continue__orbs" aria-hidden="true">
            ${OAUTH_PROVIDERS.map((p) => `<span class="auth-orb-mini" style="--orb-bg:${p.bg}">${p.icon}</span>`).join('')}
          </span>
        </button>

        <p class="auth-screen__switch">
          ${mode === 'signup'
            ? `Already have an account? <button type="button" class="auth-screen__switch-link" id="switch-mode">Log in</button>`
            : `Don't have an account? <button type="button" class="auth-screen__switch-link" id="switch-mode">Sign up</button>`}
        </p>
        </div>
      </div>`;

    showCurrentInstant();

    // Tapping "Continue with" opens a popup listing the providers, so the
    // login art isn't cluttered with brand marks by default.
    const socialTrigger = qs('#social-trigger', root);
    if (socialTrigger) socialTrigger.addEventListener('click', openProviderPopup);

    qs('#toggle-password', root).addEventListener('click', () => {
      passwordVisible = !passwordVisible;
      const input = qs('#password-input', root);
      const btn = qs('#toggle-password', root);
      input.type = passwordVisible ? 'text' : 'password';
      btn.innerHTML = passwordVisible ? iconEyeOff() : iconEye();
      btn.setAttribute('aria-label', passwordVisible ? 'Hide password' : 'Show password');
      input.focus();
    });

    qs('#forgot-password', root)?.addEventListener('click', openForgotPasswordPopup);

    qs('#switch-mode', root).addEventListener('click', () => {
      mode = mode === 'signup' ? 'signin' : 'signup';
      passwordVisible = false;
      paint();
    });

    qs('#auth-back-to-landing', root)?.addEventListener('click', () => {
      if (rotateTimer) clearInterval(rotateTimer);
      renderLandingView(root);
    });

    qs('#auth-credit', root)?.addEventListener('click', openCredit);

    qs('#auth-form', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qs('button[type="submit"]', root);
      const data = Object.fromEntries(new FormData(e.target));
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Please wait…';
      try {
        if (mode === 'signup') {
          await signUp(data.identifier, data.password, data.username);
          toast('Account created! Check your email if confirmation is required.', 'success');
        } else {
          await signIn(data.identifier, data.password);
        }
        // auth state listener in app.js takes over from here
      } catch (err) {
        toast(err.message || 'Something went wrong.', 'error');
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  }

  paint();
  loadAndCrossfade(); // first real image, fading in from blank

  // Rotates the backdrop every 5s, Netflix-browse style. Self-cleans:
  // if this view's DOM is gone (user logged in/out, navigated away)
  // the next tick notices the art layer is missing and clears itself
  // instead of running forever in the background. Skipped entirely if
  // the OS-level "reduce motion" preference is on — first image just
  // stays put rather than auto-rotating.
  if (!reduceMotion) {
    rotateTimer = setInterval(() => {
      if (!qs('.auth-screen__art--a', root)) { clearInterval(rotateTimer); return; }
      loadAndCrossfade();
    }, ROTATE_MS);
  }
}
