// A recording stand-in for CanvasRenderingContext2D: every method call and property set is logged in order.

/** Glyph width as a fraction of the font size, so text measures predictably. */
export const FAKE_EM = 0.5;

/**
 * `ctx.calls` is a list of `[method, ...args]` and `['set', prop, value]`. Properties read back what was set.
 * `measureText(s)` is `s.length × FAKE_EM × font px`, the px taken from the current `font`.
 */
export function fakeContext() {
  const state = { font: '10px sans-serif' };
  const calls = [];
  const target = {
    calls,
    measureText(text) {
      calls.push(['measureText', text]);
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
      return { width: [...text].length * FAKE_EM * px };
    },
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop in state) return state[prop];
      if (typeof prop !== 'string') return undefined;
      return (...args) => { calls.push([prop, ...args]); };
    },
    set(t, prop, value) {
      calls.push(['set', prop, value]);
      state[prop] = value;
      return true;
    },
  });
}

/** The calls named `name`, as their argument lists. */
export const callsOf = (ctx, name) => ctx.calls.filter((c) => c[0] === name).map((c) => c.slice(1));
/** The values set on `prop`, in order. */
export const setsOf = (ctx, prop) => ctx.calls.filter((c) => c[0] === 'set' && c[1] === prop).map((c) => c[2]);
/** A drawable stand-in for a decoded image. */
export const drawable = (width, height, name = 'img') => ({ width, height, name });
