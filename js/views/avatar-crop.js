import { iconClose, iconCheck } from '../components.js';
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
// Two copies of the same <img> render in lockstep (identical width/
// height/transform applied to both every frame): a dimmed one filling
// the whole canvas so you can see what falls outside the kept area,
// and a full-brightness one clipped to the circular frame on top of
// it. Gesture handling (pointer-id tracked pinch + pan, wheel for
// desktop) mirrors openAvatarLightbox in profile-view.js.
export function openAvatarCropModal(file) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'avatar-crop';
    overlay.innerHTML = `
      <header class="avatar-crop__header">
        <button type="button" class="avatar-crop__cancel" aria-label="Cancel">${iconClose()}</button>
        <h2>Adjust photo</h2>
        <button type="button" class="avatar-crop__apply" aria-label="Save">${iconCheck()}</button>
      </header>
      <div class="avatar-crop__stage-wrap">
        <div class="avatar-crop__canvas">
          <img class="avatar-crop__img avatar-crop__img--dim" draggable="false" alt="">
          <div class="avatar-crop__stage">
            <img class="avatar-crop__img avatar-crop__img--sharp" draggable="false" alt="">
          </div>
          <div class="avatar-crop__ring" aria-hidden="true"></div>
        </div>
      </div>
      <div class="avatar-crop__controls">
        <input type="range" class="avatar-crop__zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom">
      </div>
      <p class="avatar-crop__hint">Drag to reposition — pinch, scroll, or use the slider to zoom</p>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const imgDim = qs('.avatar-crop__img--dim', overlay);
    const imgSharp = qs('.avatar-crop__img--sharp', overlay);
    const canvas = qs('.avatar-crop__canvas', overlay);
    const stage = qs('.avatar-crop__stage', overlay);
    const zoomSlider = qs('.avatar-crop__zoom', overlay);
    const objectUrl = URL.createObjectURL(file);
    imgDim.src = objectUrl;
    imgSharp.src = objectUrl;

    let naturalW = 0, naturalH = 0, baseScale = 1;
    // zoom is a multiplier ON TOP of baseScale (baseScale alone = the
    // photo just barely covers the circular FRAME with no gaps, zoom
    // 1). tx/ty are the photo's top-left corner, relative to the
    // frame's own origin — everything below is sized/positioned off
    // the frame (.avatar-crop__stage), never the bigger canvas, so the
    // crop maths (and the exported image) are identical to a version
    // of this with no dimmed-backdrop layer at all.
    let zoom = 1, tx = 0, ty = 0;

    const frameSize = () => stage.getBoundingClientRect().width;
    // How far the frame's own top-left corner sits inside the bigger
    // canvas that the dimmed copy fills — the frame is centred inside
    // it, so this is just half the leftover space on each axis.
    const frameOffset = () => (canvas.getBoundingClientRect().width - frameSize()) / 2;

    // Keeps the frame always fully covered by the photo — panned or
    // zoomed out too far would otherwise reveal empty space at an edge.
    function clampPan() {
      const S = frameSize();
      const dispW = naturalW * baseScale * zoom;
      const dispH = naturalH * baseScale * zoom;
      tx = Math.min(0, Math.max(S - dispW, tx));
      ty = Math.min(0, Math.max(S - dispH, ty));
    }

    function render() {
      const dispW = naturalW * baseScale * zoom;
      const dispH = naturalH * baseScale * zoom;
      const off = frameOffset();
      for (const [img, dx, dy] of [[imgSharp, tx, ty], [imgDim, tx + off, ty + off]]) {
        img.style.width = `${dispW}px`;
        img.style.height = `${dispH}px`;
        img.style.transform = `translate(${dx}px, ${dy}px)`;
      }
    }

    // Re-zooms while keeping whatever point was under (px, py) fixed in
    // place, instead of always zooming toward the frame's centre —
    // standard "zoom under the cursor/pinch centre" feel. (px, py) is
    // always in frame-relative coordinates, same as tx/ty.
    function zoomTo(nextZoom, px, py) {
      const prevZoom = zoom;
      zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
      const ratio = zoom / prevZoom;
      tx = px - (px - tx) * ratio;
      ty = py - (py - ty) * ratio;
      zoomSlider.value = zoom;
      clampPan();
      render();
    }

    imgSharp.addEventListener('load', () => {
      naturalW = imgSharp.naturalWidth;
      naturalH = imgSharp.naturalHeight;
      const S = frameSize();
      baseScale = S / Math.min(naturalW, naturalH);
      zoom = 1;
      const dispW = naturalW * baseScale;
      const dispH = naturalH * baseScale;
      tx = (S - dispW) / 2;
      ty = (S - dispH) / 2;
      clampPan();
      render();
    });

    // --- pointer drag-to-pan + pinch-to-zoom (bound to the frame, but
    // dragging anywhere on the dimmed canvas works too — it's the same
    // photo, so it should feel like one continuous surface). ---
    const points = new Map();
    let startDist = 0, startZoom = 1, startTx = 0, startTy = 0, startMid = null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    canvas.addEventListener('pointerdown', (e) => {
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      const pts = [...points.values()];
      if (pts.length === 2) { startDist = dist(pts[0], pts[1]); startMid = mid(pts[0], pts[1]); }
      startZoom = zoom; startTx = tx; startTy = ty;
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!points.has(e.pointerId)) return;
      const prev = points.get(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...points.values()];

      if (pts.length >= 2 && startDist > 0) {
        e.preventDefault();
        const next = dist(pts[0], pts[1]) / startDist;
        zoom = Math.min(MAX_ZOOM, Math.max(1, startZoom * next));
        zoomSlider.value = zoom;
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
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    // Desktop mouse users have no pinch gesture — wheel is the
    // equivalent, zooming toward wherever the cursor is (converted to
    // frame-relative coordinates, same space tx/ty live in).
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomTo(zoom - e.deltaY * 0.0025, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    zoomSlider.addEventListener('input', () => {
      const center = frameSize() / 2;
      zoomTo(Number(zoomSlider.value), center, center);
    });

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      overlay.remove();
      document.body.style.overflow = '';
    }

    qs('.avatar-crop__cancel', overlay).addEventListener('click', () => { cleanup(); resolve(null); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(null); } });

    qs('.avatar-crop__apply', overlay).addEventListener('click', () => {
      // Map the visible frame back to a region of the ORIGINAL image at
      // full resolution — the on-screen photo is scaled by
      // baseScale*zoom for display, so dividing that back out gives the
      // real source-pixel crop rectangle to draw from. Unaffected by
      // the dimmed backdrop layer — this always reads off the frame-
      // relative tx/ty, exactly as before that layer existed.
      const S = frameSize();
      const effScale = baseScale * zoom;
      const sx = -tx / effScale;
      const sy = -ty / effScale;
      const sSize = S / effScale;

      const canvasEl = document.createElement('canvas');
      canvasEl.width = OUTPUT_SIZE;
      canvasEl.height = OUTPUT_SIZE;
      const ctx = canvasEl.getContext('2d');
      ctx.drawImage(imgSharp, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      canvasEl.toBlob((blob) => {
        cleanup();
        resolve(blob);
      }, 'image/jpeg', 0.92);
    });
  });
}
