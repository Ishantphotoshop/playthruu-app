import * as api from '../api.js';
import { state } from '../state.js';
import { topBar, navBar, avatarImg, combinedGameResults, wireCombinedGameResults, iconCamera, iconDrag, iconClose, iconPlus } from '../components.js';
import { esc, toast, qs, qsa, debounce, placeholderCover, enableSwipeToDismiss } from '../utils.js';
import { changePassword, changeEmail, signOut } from '../auth.js';
import { getTheme, setTheme } from '../theme.js';
import { openAvatarCropModal } from './avatar-crop.js';

const PRONOUN_OPTIONS = ['he/his', 'she/her', 'they/their', 'custom'];

export function renderSettingsView(root) {
  const p = state.profile;
  // Local working copy of favorites (game rows), reordered/edited in
  // memory and only persisted to Supabase when "Save favorites" is hit.
  let favorites = [];

  root.innerHTML = topBar('Settings', { back: true }) + `
    <div class="view-body settings2" id="settings-body">

      <section class="set-account">
        <div class="avatar-upload__preview set-account__avatar" id="avatar-preview">${avatarImg(p, 64)}</div>
        <div class="set-account__meta">
          <h2 class="set-account__name">${esc(p.display_name || p.username || 'You')}</h2>
          <p class="set-account__handle">@${esc(p.username || '')}</p>
        </div>
        <label class="set-account__photo">
          ${iconCamera()}<span>Edit</span>
          <input type="file" accept="image/*" id="avatar-file" class="sr-only-file-input">
        </label>
      </section>

      <p class="set-group__title">Profile</p>
      <div class="set-card">
        <form class="set-form" id="info-form">
          <label class="set-field"><span class="set-field__label">Display name</span><input name="display_name" value="${esc(p.display_name || '')}" maxlength="40" placeholder="Your name"></label>
          <label class="set-field"><span class="set-field__label">Email</span><input name="email" type="email" value="${esc(state.user?.email || '')}" placeholder="you@example.com"></label>
          <label class="set-field"><span class="set-field__label">Bio</span><textarea name="bio" rows="3" maxlength="200" placeholder="A line about you">${esc(p.bio || '')}</textarea></label>
          <label class="set-field">
            <span class="set-field__label">Pronouns</span>
            <select name="pronouns" id="pronouns-select">
              <option value="">Prefer not to say</option>
              ${PRONOUN_OPTIONS.map(o => `<option value="${o}" ${p.pronouns === o ? 'selected' : ''}>${o === 'custom' ? 'Custom' : o}</option>`).join('')}
            </select>
          </label>
          <label class="set-field" id="pronouns-custom-field" style="${p.pronouns === 'custom' ? '' : 'display:none'}">
            <span class="set-field__label">Custom pronouns</span>
            <input name="pronouns_custom" value="${esc(p.pronouns_custom || '')}" placeholder="e.g. xe/xem" maxlength="30">
          </label>
          <button type="submit" class="btn btn--accent btn--block">Save profile</button>
        </form>
      </div>

      <p class="set-group__title">Favourite games <span class="set-group__hint">Top 3</span></p>
      <div class="set-card set-card--pad">
        <div id="favorites-list" class="favorites-list"><div class="spinner"></div></div>
        <button type="button" class="btn btn--accent btn--block" id="save-favorites" style="display:none">Save favourites</button>
      </div>

      <p class="set-group__title">Privacy</p>
      <div class="set-card">
        <form class="set-form" id="privacy-form">
          <label class="set-field">
            <span class="set-field__label">Who can comment on my reviews</span>
            <select name="comment_permission">
              <option value="anyone" ${p.comment_permission === 'anyone' ? 'selected' : ''}>Anyone</option>
              <option value="friends" ${p.comment_permission === 'friends' ? 'selected' : ''}>Friends (people I follow back)</option>
              <option value="only_me" ${p.comment_permission === 'only_me' ? 'selected' : ''}>Only me</option>
              <option value="no_one" ${p.comment_permission === 'no_one' ? 'selected' : ''}>No one</option>
            </select>
          </label>
          <button type="submit" class="btn btn--accent btn--block">Save privacy</button>
        </form>
        <p class="set-hint">Controls who's allowed to leave a comment on your reviews.</p>
      </div>

      <p class="set-group__title">Appearance</p>
      <div class="set-card set-card--pad">
        <div class="segmented" id="theme-toggle">
          <button type="button" class="segmented__item${getTheme() === 'dark' ? ' segmented__item--active' : ''}" data-theme-choice="dark">Dark</button>
          <button type="button" class="segmented__item${getTheme() === 'light' ? ' segmented__item--active' : ''}" data-theme-choice="light">Light</button>
        </div>
      </div>

      <p class="set-group__title">Security</p>
      <div class="set-card">
        <form class="set-form" id="password-form">
          <label class="set-field"><span class="set-field__label">Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="set-field"><span class="set-field__label">New password</span><input name="next" type="password" autocomplete="new-password" required minlength="6"></label>
          <button type="submit" class="btn btn--ghost btn--block">Change password</button>
        </form>
        <button type="button" class="set-rowbtn" id="logout-btn">Log out</button>
      </div>

      <p class="set-group__title set-group__title--danger">Danger zone</p>
      <div class="set-card">
        <button type="button" class="set-rowbtn set-rowbtn--danger" id="delete-account-btn">Delete my account</button>
        <p class="set-hint">Removes your account and everything attached to it — your diary, reviews, ratings, lists and follows. This cannot be undone.</p>
      </div>

      <p class="set-credit">Game data via <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB.com</a> · Playthruu</p>
    </div>` + navBar('');

  const body = qs('#settings-body', root);

  // ---- appearance (theme) ----
  qsa('#theme-toggle .segmented__item', body).forEach((btn) => {
    btn.addEventListener('click', () => {
      const chosen = setTheme(btn.dataset.themeChoice);
      qsa('#theme-toggle .segmented__item', body).forEach((b) => {
        b.classList.toggle('segmented__item--active', b.dataset.themeChoice === chosen);
      });
    });
  });

  // ---- avatar upload ----
  // The crop step (opened before anything uploads) is what guarantees
  // every avatar_url actually IS square — previously the raw picked
  // file went straight to storage, whatever its real aspect ratio was.
  qs('#avatar-file', body).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // lets picking the exact same file again re-fire change
    if (!file) return;
    const cropped = await openAvatarCropModal(file);
    if (!cropped) return; // user cancelled — original avatar untouched
    const preview = qs('#avatar-preview', body);
    const prevHtml = preview.innerHTML;
    preview.innerHTML = '<div class="spinner"></div>';
    try {
      const squareFile = new File([cropped], 'avatar.jpg', { type: 'image/jpeg' });
      const url = await api.uploadAvatar(state.user.id, squareFile);
      const updated = await api.updateProfile(state.user.id, { avatar_url: url });
      state.profile = updated;
      preview.innerHTML = avatarImg(updated, 84);
      toast('Profile photo updated.', 'success');
    } catch (err) {
      preview.innerHTML = prevHtml;
      toast(err.message || 'Could not upload that photo. Try again in a moment.', 'error');
    }
  });

  // ---- personal info ----
  qs('#pronouns-select', body).addEventListener('change', (e) => {
    qs('#pronouns-custom-field', body).style.display = e.target.value === 'custom' ? '' : 'none';
  });

  qs('#info-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const newEmail = form.get('email')?.trim();
    const profileUpdates = {
      display_name: form.get('display_name')?.trim() || null,
      bio: form.get('bio')?.trim() || null,
      pronouns: form.get('pronouns') || null,
      pronouns_custom: form.get('pronouns') === 'custom' ? (form.get('pronouns_custom')?.trim() || null) : null,
    };
    const btn = qs('button[type="submit"]', e.target);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      if (newEmail && newEmail !== state.user.email) {
        await changeEmail(newEmail);
        toast('Check your new email address for a confirmation link.', 'info');
      }
      const updated = await api.updateProfile(state.user.id, profileUpdates);
      state.profile = updated;
      toast('Personal info saved.', 'success');
    } catch (err) {
      toast(err.message || 'Could not save changes.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save profile';
    }
  });

  // ---- privacy ----
  qs('#privacy-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const comment_permission = new FormData(e.target).get('comment_permission');
    const btn = qs('button[type="submit"]', e.target);
    btn.disabled = true;
    try {
      state.profile = await api.updateProfile(state.user.id, { comment_permission });
      toast('Privacy setting saved.', 'success');
    } catch (err) {
      toast(err.message || 'Could not save that setting.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---- top 5 favorites ----
  loadFavorites();
  async function loadFavorites() {
    try {
      const rows = await api.getFavorites(state.user.id);
      favorites = rows.map((r) => r.games);
      paintFavorites();
    } catch (err) {
      qs('#favorites-list', body).innerHTML = `<p class="muted">Couldn't load favorites: ${esc(err.message)}</p>`;
    }
  }

  function paintFavorites() {
    const list = qs('#favorites-list', body);
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const g = favorites[i];
      rows.push(g ? `
        <div class="favorite-row" data-index="${i}">
          <span class="favorite-row__handle" data-drag-handle>${iconDrag()}</span>
          <img class="favorite-row__cover" src="${esc(g.cover_url || placeholderCover(g.title))}" alt="">
          <span class="favorite-row__title">${esc(g.title)}</span>
          <button type="button" class="favorite-row__remove" data-remove-index="${i}" aria-label="Remove">${iconClose()}</button>
        </div>` : `
        <button type="button" class="favorite-row favorite-row--empty" data-add-index="${i}">
          ${iconPlus()} <span>Add a favorite</span>
        </button>`);
    }
    list.innerHTML = rows.join('');
    qs('#save-favorites', body).style.display = favorites.length ? '' : 'none';

    qsa('[data-add-index]', list).forEach((btn) => {
      btn.addEventListener('click', () => openFavoritePicker(Number(btn.dataset.addIndex)));
    });
    qsa('[data-remove-index]', list).forEach((btn) => {
      btn.addEventListener('click', () => {
        favorites.splice(Number(btn.dataset.removeIndex), 1);
        paintFavorites();
      });
    });
    wireFavoriteDrag(list);
  }

  function wireFavoriteDrag(list) {
    let draggedEl = null;

    qsa('[data-drag-handle]', list).forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        draggedEl = handle.closest('.favorite-row[data-index]');
        if (!draggedEl) return;
        draggedEl.classList.add('favorite-row--dragging');
        handle.setPointerCapture(e.pointerId);
      });

      handle.addEventListener('pointermove', (e) => {
        if (!draggedEl) return;
        // Re-read live DOM order every move instead of tracking a stale
        // index — insertBefore below repositions the real node (rather
        // than re-rendering), which is what keeps the pointer capture
        // (and this whole drag gesture) alive across multiple swaps.
        const rows = qsa('.favorite-row[data-index]', list);
        const under = rows.find((r) => {
          if (r === draggedEl) return false;
          const box = r.getBoundingClientRect();
          return e.clientY >= box.top && e.clientY <= box.bottom;
        });
        if (!under) return;
        const fromIndex = rows.indexOf(draggedEl);
        const toIndex = rows.indexOf(under);
        if (fromIndex === toIndex) return;
        if (fromIndex < toIndex) list.insertBefore(draggedEl, under.nextSibling);
        else list.insertBefore(draggedEl, under);
        const [moved] = favorites.splice(fromIndex, 1);
        favorites.splice(toIndex, 0, moved);
      });

      const endDrag = () => {
        if (draggedEl) draggedEl.classList.remove('favorite-row--dragging');
        draggedEl = null;
        paintFavorites();
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    });
  }

  function openFavoritePicker(slotIndex) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal--tall">
        <header class="modal__header">
          <h2>Add a favorite</h2>
          <button class="modal__close" data-close>${iconClose()}</button>
        </header>
        <div class="modal__body">
          <label class="field"><span>Search for a game</span><input type="text" id="fav-search" autocomplete="off" placeholder="Start typing a title…"></label>
          <div id="fav-results"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    qs('[data-close]', overlay).addEventListener('click', close);
    enableSwipeToDismiss(qs('.modal', overlay), close);

    const input = qs('#fav-search', overlay);
    const results = qs('#fav-results', overlay);
    const doSearch = debounce(async () => {
      const q = input.value.trim();
      if (!q) { results.innerHTML = ''; return; }
      results.innerHTML = '<div class="spinner"></div>';
      try {
        const { results: found } = await api.searchGamesEverywhere(q);
        results.innerHTML = combinedGameResults(found);
        wireCombinedGameResults(results, found, {
          onLocal: (g) => { favorites[slotIndex] = g; paintFavorites(); close(); },
          onRemote: async (g) => {
            const saved = await api.addGame(g, state.user.id);
            favorites[slotIndex] = saved;
            paintFavorites();
            close();
          },
        });
      } catch (err) {
        results.innerHTML = `<p class="muted">Couldn't search right now: ${esc(err.message)}</p>`;
      }
    }, 350);
    input.addEventListener('input', doSearch);
    input.focus();
  }

  qs('#save-favorites', body).addEventListener('click', async () => {
    const btn = qs('#save-favorites', body);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api.setFavorites(state.user.id, favorites.map((g) => g.id));
      toast('Favorites saved.', 'success');
    } catch (err) {
      toast(err.message || 'Could not save favorites.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save favorites';
    }
  });

  // ---- password ----
  qs('#password-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const btn = qs('button[type="submit"]', e.target);
    btn.disabled = true;
    btn.textContent = 'Changing…';
    try {
      await changePassword(form.get('current'), form.get('next'));
      toast('Password changed.', 'success');
      e.target.reset();
    } catch (err) {
      toast(err.message || 'Could not change your password.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Change password';
    }
  });

  // ---- logout ----
  qs('#logout-btn', body).addEventListener('click', async () => {
    const btn = qs('#logout-btn', body);
    btn.disabled = true;
    btn.textContent = 'Logging out…';
    try {
      await signOut();
      // app.js's SIGNED_OUT listener takes over from here and shows the login screen
    } catch (err) {
      toast(err.message || 'Could not log out.', 'error');
      btn.disabled = false;
      btn.textContent = 'Log out';
    }
  });

  // Deletion is irreversible and cascades, so it asks twice: once for
  // intent, then for the username typed out in full. A single confirm()
  // is too easy to dismiss by reflex for something this destructive.
  qs('#delete-account-btn', body).addEventListener('click', async () => {
    const btn = qs('#delete-account-btn', body);
    const username = state.profile?.username || '';
    if (!confirm('Delete your account permanently? Your diary, reviews, ratings and lists will all be removed.')) return;
    const typed = prompt(`This cannot be undone.\n\nType your username (${username}) to confirm:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== username.toLowerCase()) {
      toast("That didn't match your username — nothing was deleted.", 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      await api.deleteAccount();
      // deleteAccount() signs out on success; app.js's SIGNED_OUT
      // listener then swaps in the auth screen.
    } catch (err) {
      toast(err.message || 'Could not delete your account.', 'error');
      btn.disabled = false;
      btn.textContent = 'Delete my account';
    }
  });
}
