import { qs } from '../utils.js';

const OUTPUT_SIZE = 600;
const MAX_ZOOM = 4;

// Square crop/align step for a newly-picked avatar photo, shown before
// it ever gets uploaded — until this existed, a non-square photo just
// got uploaded as-is, so every avatar and view of it (the circle chip
// everywhere, the full-size lightbox) inherited whatever odd aspect
// ratio the source photo happened to have. Resolves with a square JPEG
// Blob once the user applies, or null if they cancel — the caller
// decides what to do with either.
//
// Rebuilt to match Instagram's own "new profile photo" screen after
// actually checking how it works, not guessing: a SQUARE frame with
// camera-viewfinder corner brackets (not a circle — the circle is only
// how it displays afterward, everywhere else in the app), a plain
// black backdrop, and pinch/drag/wheel only — no zoom slider at all.
export function openAvatarCropModal(file) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'avatar-crop';
    overlay.innerHTML = `
      <header class="avatar-crop__header">
        <button type="button" class="avatar-crop__cancel">Cancel</button>
        <h2>New profile photo</h2>
        <button type="button" class="avatar-crop__apply">Done</button>
      </header>
      <div class="avatar-crop__stage-wrap">
        <div class="avatar-crop__stage">
          <img class="avatar-crop__img" draggable="false" alt="">
          <div class="avatar-crop__grid" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <i class="avatar-crop__corner avatar-crop__corner--tl" aria-hidden="true"></i>
          <i class="avatar-crop__corner avatar-crop__corner--tr" aria-hidden="true"></i>
          <i class="avatar-crop__corner avatar-crop__corner--bl" aria-hidden="true"></i>
          <i class="avatar-crop__corner avatar-crop__corner--br" aria-hidden="true"></i>
        </div>
      </div>
      <p class="avatar-crop__hint">Drag to reposition — pinch or scroll to zoom</p>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const img = qs('.avatar-crop__img', overlay);
    const stage = qs('.avatar-crop__stage', overlay);
    const grid = qs('.avatar-crop__grid', overlay);
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    // Rule-of-thirds grid, shown only while actively framing the shot
    // (dragging, pinching, wheel-zooming) rather than sitting on screen
    // permanently — the same "only while adjusting" treatment
    // Instagram/Photoshop/Lightroom's own crop tools use.
    let gridHideTimer = null;
    function showGrid() {
      grid.classList.add('avatar-crop__grid--visible');
      clearTimeout(gridHideTimer);
      gridHideTimer = setTimeout(() => grid.classList.remove('avatar-crop__grid--visible'), 500);
    }

    let naturalW = 0, naturalH = 0, baseScale = 1;
    // zoom is a multiplier ON TOP of baseScale (baseScale alone = the
    // photo just barely covers the square frame with no gaps, zoom 1).
    // tx/ty are the photo's top-left corner, in stage px.
    let zoom = 1, tx = 0, ty = 0;

    const stageSize = () => stage.getBoundingClientRect().width;

    // Keeps the frame always fully covered by the photo — panned or
    // zoomed out too far would otherwise reveal empty space at an edge.
    function clampPan() {
      const S = stageSize();
      const dispW = naturalW * baseScale * zoom;
      const dispH = naturalH * baseScale * zoom;
      tx = Math.min(0, Math.max(S - dispW, tx));
      ty = Math.min(0, Math.max(S - dispH, ty));
    }

    function render() {
      const dispW = naturalW * baseScale * zoom;
      const dispH = naturalH * baseScale * zoom;
      img.style.width = `${dispW}px`;
      img.style.height = `${dispH}px`;
      img.style.transform = `translate(${tx}px, ${ty}px)`;
    }

    // Re-zooms while keeping whatever point was under (px, py) fixed in
    // place, instead of always zooming toward the frame's centre —
    // standard "zoom under the cursor/pinch centre" feel.
    function zoomTo(nextZoom, px, py) {
      const prevZoom = zoom;
      zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      const ratio = zoom / prevZoom;
      tx = px - (px - tx) * ratio;
      ty = py - (py - ty) * ratio;
      clampPan();
      render();
    }

    img.addEventListener('load', () => {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      const S = stageSize();
      baseScale = S / Math.min(naturalW, naturalH);
      zoom = 1;
      const dispW = naturalW * baseScale;
      const dispH = naturalH * baseScale;
      tx = (S - dispW) / 2;
      ty = (S - dispH) / 2;
      clampPan();
      render();
    });

    // --- pointer drag-to-pan + pinch-to-zoom ---
    const points = new Map();
    let startDist = 0, startZoom = 1, startTx = 0, startTy = 0, startMid = null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    stage.addEventListener('pointerdown', (e) => {
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      const pts = [...points.values()];
      if (pts.length === 2) { startDist = dist(pts[0], pts[1]); startMid = mid(pts[0], pts[1]); }
      startZoom = zoom; startTx = tx; startTy = ty;
    });

    stage.addEventListener('pointermove', (e) => {
      if (!points.has(e.pointerId)) return;
      const prev = points.get(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...points.values()];
      showGrid();

      if (pts.length >= 2 && startDist > 0) {
        e.preventDefault();
        const next = dist(pts[0], pts[1]) / startDist;
        zoom = Math.min(MAX_ZOOM, Math.max(1, startZoom * next));
        const m = mid(pts[0], pts[1]);
        if (startMid) { tx = startTx + (m.x - startMid.x); ty = startTy + (m.y - startMid.y); }
        clampPan();
        render();
      } else if (pts.length === 1) {
        e.preventDefault();
        tx += e.clientX - prev.x;
        ty += e.clientY - prev.y;
        clampPan();
        render();
      }
    });

    const release = (e) => { points.delete(e.pointerId); if (points.size < 2) startDist = 0; };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    // Desktop mouse users have no pinch gesture — wheel is the
    // equivalent, zooming toward wherever the cursor is.
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      showGrid();
      const rect = stage.getBoundingClientRect();
      zoomTo(zoom - e.deltaY * 0.0025, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
      document.body.style.overflow = '';
    }

    qs('.avatar-crop__cancel', overlay).addEventListener('click', () => { cleanup(); resolve(null); });

    qs('.avatar-crop__apply', overlay).addEventListener('click', () => {
      // Map the visible frame back to a region of the ORIGINAL image at
      // full resolution — the on-screen photo is scaled by
      // baseScale*zoom for display, so dividing that back out gives the
      // real source-pixel crop rectangle to draw from.
      const S = stageSize();
      const effScale = baseScale * zoom;
      const sx = -tx / effScale;
      const sy = -ty / effScale;
      const sSize = S / effScale;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      canvas.toBlob((blob) => {
        cleanup();
        resolve(blob);
      }, 'image/jpeg', 0.92);
    });
  });
}
