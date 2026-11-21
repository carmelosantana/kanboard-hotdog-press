// A tiny element builder for the editor's DOM glue. Text goes in as text nodes, never as HTML.

/**
 * h('button', {class: 'x', onclick: fn, 'aria-label': 'y'}, 'text', child)
 * @param {string} tag
 * @param {Record<string, any>} [attrs] `on*` keys add listeners; `class`, `dataset` and booleans are handled
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** A device-pixel-sharp canvas: CSS size w × h, backing store × devicePixelRatio, context scaled to CSS px. */
export function sizeCanvas(canvas, w, h) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/**
 * Downloads `blob` as `name` through a hidden <a download> with a blob: href (a link, never a blob: <img>, which
 * Kanboard's CSP refuses). The URL is revoked a minute later.
 * @param {Blob} blob
 * @param {string} name
 */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
