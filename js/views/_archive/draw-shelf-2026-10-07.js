  function openDraw() {
    if (!games.length) { toast('Still loading this collection. Try again in a second.'); return; }
    const collection = activeCollection();
    if (drawn.collection !== collection.id) { drawn.collection = collection.id; drawn.keys.clear(); }
    const overlay = document.createElement('div');
    overlay.className = 'draw-overlay';
    overlay.innerHTML = `
      <button type="button" class="modal__close draw-close" data-close aria-label="Close">&times;</button>
      <div class="draw" role="dialog" aria-label="Random pick from ${esc(collection.label)}">
        <div class="draw-scene">
          <div class="draw-stage"></div>
        </div>
        <div class="draw-info" aria-live="polite">
          <h2 class="draw-title"><span></span></h2>
          <i class="draw-rule"></i>
          <p class="draw-meta"></p>
          <div class="draw-crew"></div>
        </div>
        <div class="draw-actions">
          <button type="button" class="draw-act draw-act--go" data-open><span>Open<br>the game</span></button>
          <button type="button" class="draw-act" data-save><span>Want<br>to play</span></button>
          <button type="button" class="draw-act" data-draw><span>Draw<br>again</span></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const drawEl = qs('.draw', overlay);
    const stage = qs('.draw-stage', overlay);
    const infoEl = qs('.draw-info', overlay);
    const titleEl = qs('.draw-title span', overlay);
    const ruleEl = qs('.draw-rule', overlay);
    const metaEl = qs('.draw-meta', overlay);
    const crewEl = qs('.draw-crew', overlay);
    const acts = qsa('.draw-act', overlay);
    // People you follow, fetched once per draw session; each pick's friend
    // activity is looked up while its case is being pulled out.
    const followingP = state.user ? api.getFollowingIdSet(state.user.id).catch(() => new Set()) : Promise.resolve(new Set());
    let crew = [];
    const btnDraw = qs('[data-draw]', overlay);
    const btnOpen = qs('[data-open]', overlay);
    const btnSave = qs('[data-save]', overlay);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const keyOf = (g) => g.igdb_id ?? g.id ?? g.title;
    const anims = [];
    let token = 0;
    let busy = false;
    let skip = false;
    let pick = null;      // the game showing
    let current = null;   // the case that is out of the shelf

    // One tween helper. The element's inline style is the source of truth:
    // every animation writes its final values there and cancels itself, so
    // nothing is left holding a fill and the live tilt below can take over
    // the same transform without fighting it.
    const dur = (ms) => (reduce ? 1 : ms);
    function tween(el, keyframes, opt, final) {
      const a = el.animate(keyframes, { fill: 'both', ...opt, duration: dur(opt.duration), delay: reduce ? 0 : (opt.delay || 0) });
      anims.push(a);
      return a.finished.then(() => {
        if (final) Object.assign(el.style, final);
        a.cancel();
      }, () => { /* cancelled by close() */ }).then(() => {
        const k = anims.indexOf(a);
        if (k >= 0) anims.splice(k, 1);
      });
    }
    const pause = (ms) => (skip || reduce ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      token++;
      stopTilt();
      offTilt();
      anims.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } });
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', close);
      window.removeEventListener('resize', onResize);
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', close);
    overlay.__dismiss = () => close();
    qs('[data-close]', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.draw-case')) return;
      if (busy) { skip = true; anims.forEach((a) => { try { a.finish(); } catch { /* already gone */ } }); return; }
      if (e.target === overlay || e.target === drawEl || e.target.classList.contains('draw-scene') || e.target === stage) close();
    });

    const genreOf = (g) => (g.genre || '').split(',')[0].replace('Role-playing (RPG)', 'RPG').trim();
    const artOf = (g) => (g.cover_url ? igdbSized(g.cover_url, 'cover_big') : placeholderCover(g.title));

    // Games for the shelf. The ones already on screen first - their covers
    // are decoded and in cache, so the shelf is instant - topped up from
    // the same deep random pool the old draw used, so a long session keeps
    // turning up things the grid never showed.
    const seen = drawn.keys;
    const localPick = () => {
      let fresh = games.filter((g) => !seen.has(keyOf(g)));
      if (!fresh.length) fresh = games.slice();
      return fresh[Math.floor(Math.random() * fresh.length)];
    };
    if (drawPool.id !== collection.id) { drawPool.id = collection.id; drawPool.games = []; }
    const pool = drawPool.games;
    function freshGame() {
      if (pool.length < 3) refillDrawPool().catch(() => {});
      const g = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : localPick();
      seen.add(keyOf(g));
      return g;
    }
    const friendsFor = (g) => followingP.then((ids) => api.getFriendActivityForGame(g, ids)).catch(() => []);

    // ------------------------------------------------------------ layout
    // Cases stand edge on, like books: each is a real box and the face
    // turned to you is its SPINE. Every case is built at the size it will
    // be when it is out and scaled down on the shelf, never the other way
    // round - a cover scaled up from thumbnail size arrives soft, which is
    // the one thing this moment cannot afford.
    // 3:4, which is what IGDB serves every cover at. The case was 0.72
    // before - close to a real DVD case, but a hair narrower than the art,
    // so every cover was being cropped a few percent at the sides and read
    // as squashed. Matching the artwork exactly means nothing is cut and
    // nothing is stretched.
    const RATIO = 0.75;   // width / height of a game case
    const TURN = 87;      // deg: edge on, with a sliver of cover showing
    const N = 12;         // cases on the shelf
    const PERSP = 1100;   // matches the scene's perspective, in css
    // The shelf is set back and the cover is held forward, and the gap
    // between the two is what stops the shelf passing through the cover
    // when it turns: a cover turning end over end sweeps half its own
    // height in Z, and at this size that is about 130px either way.
    const SHELF_Z = -90;
    // Looked down on, slightly. The cases tip back on their heels and the
    // plank opens its top surface toward you, which is what makes a row of
    // spines read as standing ON something rather than floating in front of
    // it. It is done here rather than by moving the camera on purpose: the
    // camera belongs to the whole scene, and the one case that is out has
    // to stay square on to be looked at.
    const PITCH = 9;
    const FEAT_Z = 120;
    let M = null;
    function measure() {
      const vw = overlay.clientWidth || window.innerWidth;
      const vh = overlay.clientHeight || window.innerHeight;
      // What is left once the title block, the buttons and the padding are out.
      const availH = Math.max(190, vh - 56 - 24 - 56 - 108 - 24);
      const fw = Math.min(224, vw * 0.56, availH * 0.8 * RATIO);
      const fh = fw / RATIO;
      const fd = Math.max(13, Math.round(fw * 0.115));
      // The row is laid out to run PAST both edges of the screen, so the
      // shelf reads as part of a longer one rather than a tray with both
      // ends in view. The twelve cases fill that width, and their scale
      // falls out of the spacing: from the side a case is its spine plus
      // the sliver of cover the few degrees of turn leave showing, and
      // that has to come to just under one step - any more and each cover
      // stacks over the next case's spine and the spines disappear.
      // Set back, the shelf is drawn smaller, so the spacing is worked out
      // where it is actually seen - on screen - and converted back.
      const back = PERSP / (PERSP - SHELF_Z);
      const step = Math.max(24, (vw * 1.08) / N / back);
      const sliver = Math.cos(TURN * Math.PI / 180);
      const s = Math.max(0.28, Math.min(0.56, (step - 3 / back) / (fd + fw * sliver)));
      const sh = fh + 26;
      const restBottom = sh - 26;
      return { n: N, fw, fh, fd, s, step, sh, restBottom, restY: restBottom - fh, featY: (sh - fh) / 2 - 10, vw };
    }
    const mid = () => (M.n - 1) / 2;
    const slotX = (i) => (i - mid()) * M.step;
    // Each case is turned to face the camera rather than the screen. A row
    // of parallel cases does not read as spines: the camera sits in the
    // middle, so the ones out at the ends are seen at an angle and the
    // perspective gives back several degrees of cover - enough that a
    // shelf of spines looked like a shelf of covers. Taking the viewing
    // angle out of each case's own turn makes every spine equally square
    // on, and the 90 - TURN that is left is the sliver of cover you see
    // down the near edge of all of them.
    const slotA = (i) => TURN - Math.atan(slotX(i) / (PERSP - SHELF_Z)) * 180 / Math.PI;
    const restT = (i, lift = 0) => `translate3d(${slotX(i)}px, ${M.restY - lift}px, ${SHELF_Z}px) rotateX(${PITCH}deg) rotateY(${slotA(i)}deg) scale(${M.s})`;
    const tipT = (i) => `translate3d(${slotX(i)}px, ${M.restY - 10}px, ${SHELF_Z + 16}px) rotateX(${PITCH - 11}deg) rotateY(${slotA(i) - 4}deg) scale(${M.s})`;
    const outT = (i) => `translate3d(${slotX(i)}px, ${M.restY - 6}px, ${SHELF_Z + 120}px) rotateX(${Math.round(PITCH / 3) - 6}deg) rotateY(${slotA(i) - 14}deg) scale(${M.s * 1.06})`;
    // Held forward, and scaled back by exactly what being that much nearer
    // magnifies it, so the cover arrives the size it was designed to be
    // instead of swelling into the title underneath it.
    const featT = () => `translate3d(0px, ${M.featY}px, ${FEAT_Z}px) rotateY(0deg) scale(${((PERSP - FEAT_Z) / PERSP).toFixed(4)})`;
    const casesEl = () => qsa('.draw-case', stage);

    function applyLayout() {
      M = measure();
      stage.style.setProperty('--sh', `${M.sh}px`);
      stage.style.setProperty('--fw', `${M.fw}px`);
      stage.style.setProperty('--fh', `${M.fh}px`);
      stage.style.setProperty('--fd', `${M.fd}px`);
      // The plank is exactly as long as the row of cases, so it never
      // shows a bare end with nothing standing on it. Both run past the
      // edges of the screen together.
      const span = M.n * M.step * 1.02;
      const board = qs('.draw-board', stage);
      // Big enough to put the whole shelf in shadow, small enough that its
      // edges never reach the title or the buttons below.
      const dim = qs('.draw-dim', stage);
      if (dim) Object.assign(dim.style, { width: `${span}px`, height: `${M.sh * 1.18}px`, top: `${-M.sh * 0.09}px`, marginLeft: `${span * -0.5}px` });
      // The cases stand ON the shelf, not in front of it: it starts a few
      // pixels under their feet, so there is no hairline of nothing
      // between the two - which is what made them look like they were
      // floating half in the air.
      if (board) Object.assign(board.style, { width: `${span}px`, marginLeft: `${span * -0.5}px`, top: `${M.restBottom - 5}px` });
      // Hinged along its back edge, so the pitch opens the top surface
      // toward you instead of sinking the whole plank.
      if (board) {
        board.style.transformOrigin = '50% 0';
        board.style.transform = `translateZ(${SHELF_Z - 2}px) rotateX(${PITCH}deg)`;
      }
      if (dim) dim.style.transform = `translateZ(${SHELF_Z + 40}px)`;
      casesEl().forEach((c, i) => {
        if (c === current) { c.style.transform = featT(); baseT = featT(); } else c.style.transform = restT(i);
      });
    }
    let resizeRaf = 0;
    function onResize() {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => { if (!busy) applyLayout(); });
    }
    window.addEventListener('resize', onResize);

    // ------------------------------------------------------------- shelf
    const caseHTML = (i) => `
      <button type="button" class="draw-case" data-i="${i}" aria-label="Pick this one">
        <span class="draw-case__face draw-case__front"><img alt="" decoding="async"><i class="draw-case__hinge"></i><i class="draw-case__sheen"></i></span>
        <span class="draw-case__face draw-case__spine">${iconBrandMark()}</span>
        <span class="draw-case__face draw-case__edge"></span>
        <span class="draw-case__face draw-case__back"></span>
      </button>`;

    const gameOf = new WeakMap();
    function fill(el, g) {
      gameOf.set(el, g);
      const img = qs('.draw-case__front img', el);
      if (img.dataset.src !== artOf(g)) { img.dataset.src = artOf(g); img.src = artOf(g); }
      el.setAttribute('aria-label', `Pick ${g.title}`);
    }

    function buildShelf() {
      M = measure();
      const onScreen = games.filter((g) => g.cover_url).sort(() => Math.random() - 0.5);
      stage.innerHTML = `${Array.from({ length: M.n }, (_, i) => caseHTML(i)).join('')}<i class="draw-dim"></i><i class="draw-board"></i>`;
      const cs = casesEl();
      cs.forEach((el, i) => fill(el, onScreen[i % Math.max(1, onScreen.length)] || localPick()));
      current = null;
      applyLayout();
    }

    // ------------------------------------------------------------ result
    function hideResult() {
      drawEl.classList.remove('is-landed');
      acts.forEach((b) => { b.disabled = true; });
      crewEl.innerHTML = '';
      infoEl.style.opacity = '0';
      titleEl.style.opacity = '0';
      ruleEl.style.transform = 'scaleX(0)';
      metaEl.style.opacity = '0';
      crewEl.style.opacity = '0';
    }

    const crewLabel = (c) => (c.status === 'played' ? (c.rating ? `Played ★${Number(c.rating)}` : 'Played') : c.status === 'playing' ? 'Playing now' : 'Wants to play');
    function crewHTML() {
      return crew.slice(0, 3).map((c) => {
        const name = c.profile.display_name || c.profile.username || 'Friend';
        const face = c.profile.avatar_url
          ? `<img src="${esc(c.profile.avatar_url)}" alt="" decoding="async">`
          : `<b>${esc(name[0].toUpperCase())}</b>`;
        return `<button type="button" class="draw-friend" data-user="${esc(c.profile.username || '')}"><span class="draw-friend__face">${face}</span><span>${esc(name)} · ${crewLabel(c)}</span></button>`;
      }).join('');
    }

    // The title is the last thing to arrive: it wipes in from the left
    // while the letters pull together, a short rule draws under it, and
    // the details follow a beat behind.
    function revealInfo() {
      titleEl.textContent = pick.title;
      metaEl.textContent = [pick.release_year, genreOf(pick)].filter(Boolean).join(' · ');
      crewEl.innerHTML = crewHTML();
      infoEl.style.opacity = '1';
      const wipe = tween(titleEl, [
        { opacity: 0, clipPath: 'inset(0 100% 0 0)', letterSpacing: '0.26em', transform: 'translateY(8px)' },
        { opacity: 1, clipPath: 'inset(0 0% 0 0)', letterSpacing: '0.01em', transform: 'translateY(0)' },
      ], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' }, { opacity: '1', clipPath: 'none', letterSpacing: '0.01em', transform: 'none' });
      tween(ruleEl, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 500, delay: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }, { transform: 'scaleX(1)' });
      [metaEl, crewEl].forEach((el, i) => tween(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, delay: 360 + i * 90, easing: 'ease-out' }, { opacity: '1', transform: 'none' }));
      return wipe;
    }

    // --------------------------------------------------------- the pull
    // One element, one unbroken move, the way a case actually comes off a
    // shelf: a finger hooks the top edge and tips it toward you, it slides
    // forward out of the row, hangs there a moment, and only then turns to
    // show its cover. No swap, no second card - the spine you touched is
    // the cover you end up looking at.
    async function pullOut(el, my) {
      const i = Number(el.dataset.i);
      pick = gameOf.get(el);
      const friendsP = friendsFor(pick);
      // The shelf runs on small art; the one being held gets the big file,
      // swapped in only once it has decoded so the cover never visibly
      // jumps from one resolution to the other while it is turning.
      if (pick.cover_url) {
        const big = igdbSized(pick.cover_url, '1080p');
        const im = new Image();
        im.decoding = 'async';
        im.src = big;
        im.decode().then(() => {
          if (gameOf.get(el) === pick) qs('.draw-case__front img', el).src = big;
        }).catch(() => {});
      }
      busy = true;
      hideResult();
      stopTilt();
      el.style.zIndex = '6';
      stage.classList.add('is-picking');

      // The shelf falls into shadow while this one is handled. This is a
      // scrim set just in front of the row, NOT opacity on the cases: an
      // opacity below 1 flattens a preserve-3d subtree, which collapses a
      // case's spine to nothing and turns the shelf into paper slivers.
      tween(qs('.draw-dim', stage), [{ opacity: 0 }, { opacity: 1 }], { duration: 440, easing: 'ease-out' }, { opacity: '1' });

      // One unbroken move: a finger hooks the top edge and tips it toward
      // you, it comes out of the row, and it turns to face you on the way
      // in. No stop between taking it and seeing what it is.
      buzz(8);
      await tween(el, [
        { transform: restT(i), offset: 0 },
        { transform: tipT(i), offset: 0.22, easing: 'cubic-bezier(.3,.9,.4,1)' },
        { transform: outT(i), offset: 0.48, easing: 'cubic-bezier(.3,.6,.4,1)' },
        { transform: featT(), offset: 1 },
      ], { duration: 1020, easing: 'cubic-bezier(.3,.08,.2,1)' }, { transform: featT() });
      if (my !== token) return false;

      current = el;
      baseT = featT();
      crew = await Promise.race([friendsP, new Promise((r) => setTimeout(() => r([]), 700))]);
      if (my !== token) return false;
      busy = false;
      stage.classList.remove('is-picking');
      drawEl.classList.add('is-landed');
      acts.forEach((b) => { b.disabled = false; });
      setSaved(false);
      saved = null;
      tween(qs('.draw-actions', overlay), [{ opacity: 0 }, { opacity: 1 }], { duration: 240 }, { opacity: '1' });
      startTilt(el);
      revealInfo();
      return true;
    }

    // Back into its place, and a different game put on it, so the shelf
    // never shows the same thing twice in a session.
    async function putBack(el, my) {
      const i = Number(el.dataset.i);
      stopTilt();
      current = null;
      el.style.zIndex = '';
      tween(qs('.draw-dim', stage), [{ opacity: 1 }, { opacity: 0 }], { duration: 340 }, { opacity: '0' });
      await tween(el, [{ transform: featT() }, { transform: outT(i) }, { transform: restT(i) }], { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: restT(i) });
      if (my !== token) return;
      fill(el, freshGame());
    }

    async function open(shuffle) {
      const my = ++token;
      busy = true; skip = false;
      hideResult();
      if (shuffle) {
        buildShelf();
        const cs = casesEl();
        // Stocked from the middle outward, each case dropping into place.
        // Transform only, for the same reason the dimming above is a scrim:
        // a case that fades in is a case with no thickness while it fades.
        await Promise.all(cs.map((c, i) => tween(c, [
          { transform: restT(i, -34) },
          { transform: restT(i) },
        ], { duration: 420, delay: Math.abs(i - mid()) * 34, easing: 'cubic-bezier(.2,.8,.2,1)' }, { transform: restT(i) })));
        if (my !== token) return;
      }
      const cs = casesEl();
      await pullOut(cs[Math.floor(Math.random() * cs.length)], my);
    }

    // Tap any spine to take that one instead of waiting for the shuffle.
    stage.addEventListener('click', async (e) => {
      const el = e.target.closest('.draw-case');
      if (!el || busy) return;
      if (el === current) return;
      const my = ++token;
      // Clear the old title before the old case goes back, not after: the
      // name of the game you have just moved on from should not sit under
      // the shelf while the next one is being pulled.
      busy = true;
      hideResult();
      if (current) { await putBack(current, my); if (my !== token) return; }
      await pullOut(el, my);
    });

    btnDraw.addEventListener('click', async () => {
      if (busy || !current) return;
      const my = ++token;
      busy = true; skip = false;
      hideResult();
      buzz(6);
      const back = current;
      stage.classList.add('is-picking');
      await putBack(back, my);
      if (my !== token) return;
      stage.classList.remove('is-picking');
      const cs = casesEl().filter((c) => c !== back);
      await pullOut(cs[Math.floor(Math.random() * cs.length)], my);
    });
    crewEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.draw-friend');
      if (!chip?.dataset.user || busy) return;
      close();
      navigate(`/profile/${encodeURIComponent(chip.dataset.user)}`);
    });
    btnOpen.addEventListener('click', async () => {
      if (busy || !pick) return;
      if (!state.user) { promptSignIn('Sign in to open games.'); return; }
      buzz(8);
      btnOpen.disabled = true;
      try {
        const saved = await api.addGame(pick, state.user.id);
        close();
        navigate(`/game/${saved.id}`);
      } catch (err) {
        toast(err.message || 'Could not open that game.', 'error');
        btnOpen.disabled = false;
      }
    });
    // Want to play is a toggle. The button turns green the moment you tap
    // it and the backlog entry is written behind it; tap again and the
    // entry this made is removed. Nothing reloads, and a failure puts the
    // button back. A game you had already logged is left exactly as it was.
    let saved = null;     // { logId, pickKey } once in the backlog
    let saving = false;
    const setSaved = (on) => {
      btnSave.classList.toggle('draw-act--saved', on);
      btnSave.setAttribute('aria-pressed', on ? 'true' : 'false');
      qs('span', btnSave).innerHTML = on ? 'On your<br>list ✓' : 'Want<br>to play';
    };
    btnSave.addEventListener('click', async () => {
      if (busy || !pick || saving) return;
      if (!state.user) { promptSignIn('Sign in to save games.'); return; }
      const g = pick;
      saving = true;
      if (saved && saved.pickKey === keyOf(g)) {
        const was = saved;
        saved = null;
        setSaved(false);
        buzz(6);
        try {
          await api.deleteLog(was.logId);
          markPagesStale();
        } catch (err) {
          if (pick === g) { saved = was; setSaved(true); }
          toast(err.message || 'Could not remove that.', 'error');
        }
        saving = false;
        return;
      }
      setSaved(true);
      buzz([10, 40, 14]);
      try {
        const game = await api.addGame(g, state.user.id);
        const had = await api.getOwnLogForGame(state.user.id, game.id);
        if (had && had.status !== 'backlog') {
          if (pick === g) setSaved(false);
          toast(`${game.title} is already in your diary.`);
        } else {
          const log = had || await api.createLog({ game_id: game.id, user_id: state.user.id, status: 'backlog', is_public: true });
          if (pick === g) saved = { logId: log.id, pickKey: keyOf(g) };
          markPagesStale();
          pulseLogTab();
        }
      } catch (err) {
        if (pick === g) setSaved(false);
        toast(err.message || 'Could not save that game.', 'error');
      }
      saving = false;
    });

    // ------------------------------------------------------------- live
    // Once a cover is out it is a thing in your hand: it holds its place in
    // the air and the phone moves around it, all the way round if you turn
    // far enough - turn the phone over and you are looking at the back of
    // the case. The pose it starts from is whatever grip you were in when
    // it arrived, so there is no "correct" way to be holding the phone.
    //
    // The reading goes through a quaternion and is applied as a matrix
    // rather than two Euler angles: pulled apart into rotateX/rotateY the
    // turn fights itself past a quarter turn and the cover flips instead of
    // carrying on round. One rAF loop, one element, and it stops the moment
    // the motion settles.
    const EASE = 0.045;   // s of smoothing between readings
    const D2R = Math.PI / 180;
    let baseT = '';
    let tiltEl = null;
    let rest = null;      // the pose the phone was in when the cover arrived
    let qt = [1, 0, 0, 0];
    let qc = [1, 0, 0, 0];
    let raf = 0; let lastFrame = 0;
    const mul = (a, b) => [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
    // deviceorientation angles (Z-X'-Y'') as a quaternion, per the spec
    const quat = (alpha, beta, gamma) => {
      const x = (beta * D2R) / 2; const y = (gamma * D2R) / 2; const z = (alpha * D2R) / 2;
      const cX = Math.cos(x); const cY = Math.cos(y); const cZ = Math.cos(z);
      const sX = Math.sin(x); const sY = Math.sin(y); const sZ = Math.sin(z);
      return [cX * cY * cZ - sX * sY * sZ, sX * cY * cZ - cX * sY * sZ, cX * sY * cZ + sX * cY * sZ, cX * cY * sZ + sX * sY * cZ];
    };
    const norm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
    const mat = (q) => {
      const [w, x, y, z] = q;
      const m = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
      ];
      return `matrix3d(${m.map((v) => v.toFixed(5)).join(',')})`;
    };
    const frame = (t) => {
      raf = 0;
      const dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 1 / 60;
      lastFrame = t;
      const k = 1 - Math.exp(-dt / EASE);
      // Shortest way round, so a turn past the back never unwinds the long way.
      const dot = qc[0] * qt[0] + qc[1] * qt[1] + qc[2] * qt[2] + qc[3] * qt[3];
      const sgn = dot < 0 ? -1 : 1;
      qc = norm(qc.map((v, i) => v + (qt[i] * sgn - v) * k));
      const still = Math.abs(Math.abs(dot) - 1) < 1e-6;
      if (still) { qc = qt.slice(); lastFrame = 0; }
      if (tiltEl) tiltEl.style.transform = Math.abs(qc[0]) > 0.99999 ? baseT : `${baseT} ${mat(qc)}`;
      if (!still) raf = requestAnimationFrame(frame);
    };
    const aimQ = (q) => { qt = norm(q); if (!raf) raf = requestAnimationFrame(frame); };
    const onOrient = (e) => {
      if (!tiltEl || e.beta == null) return;
      const q = quat(e.alpha || 0, e.beta, e.gamma || 0);
      if (!rest) { rest = q; return; }
      aimQ(mul([rest[0], -rest[1], -rest[2], -rest[3]], q));
    };
    // Desktop: the pointer stands in for the phone, a half turn corner to
    // corner, so the same cover can be looked around with a mouse.
    const onMouse = (e) => {
      if (!tiltEl || e.pointerType === 'touch') return;
      const ax = -(e.clientY / innerHeight - 0.5) * 180 * D2R;
      const ay = (e.clientX / innerWidth - 0.5) * 180 * D2R;
      aimQ(mul([Math.cos(ax / 2), Math.sin(ax / 2), 0, 0], [Math.cos(ay / 2), 0, Math.sin(ay / 2), 0]));
    };
    function startTilt(el) {
      if (reduce) return;
      tiltEl = el; rest = null;
    }
    function stopTilt() {
      tiltEl = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; qt = [1, 0, 0, 0]; qc = [1, 0, 0, 0]; lastFrame = 0;
    }
    const offTilt = () => {
      window.removeEventListener('pointermove', onMouse);
      window.removeEventListener('deviceorientation', onOrient);
    };
    if (!reduce) {
      window.addEventListener('pointermove', onMouse, { passive: true });
      const DOE = window.DeviceOrientationEvent;
      if (typeof DOE?.requestPermission === 'function') {
        // iOS asks once, and only from a tap: this one.
        DOE.requestPermission().then((r) => { if (r === 'granted') window.addEventListener('deviceorientation', onOrient); }).catch(() => {});
      } else if (DOE) {
        window.addEventListener('deviceorientation', onOrient);
      }
    }

    open(true);
  }
