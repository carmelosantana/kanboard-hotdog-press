// Layouts: the slot vocabulary, placement inside the safe area, and character budgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUTS, place, budget, MIN_FONT_SIZE, GLYPH_EM, LINE_HEIGHT,
} from '../../Assets/js/core/layouts.js';
import { LAYOUT_NAMES, newDog, validateDog } from '../../Assets/js/core/dog.js';
import { safeArea } from '../../Assets/js/core/impose.js';
import { panelSize } from '../../Assets/js/core/paper.js';

const EPS = 1e-9;
const PAPERS = ['a4', 'letter'];
const MARGINS = [6, 10];
const PAGES = [1, 3, 5, 8];

const SLOTS = {
  cover: ['title', 'subtitle', 'photo'],
  'back-cover': ['body', 'note'],
  'headline-body': ['title', 'body'],
  'photo-full': ['photo', 'caption'],
  'photo-caption': ['title', 'photo', 'body'],
  list: ['title', 'list'],
  quote: ['quote', 'attribution'],
  'two-up': ['title', 'photo', 'photo2', 'body'],
  freeform: [],
};

/** Every slot of a layout filled with something of its kind. */
function fill(layout) {
  const slots = {};
  for (const s of LAYOUTS[layout].slots) {
    if (s.kind === 'image') slots[s.name] = { asset: 'a1' };
    else if (s.kind === 'list') slots[s.name] = { items: ['one', 'two'] };
    else slots[s.name] = { text: `${s.name} text` };
  }
  return slots;
}

const inside = (item, sa, label) => {
  assert.ok(item.x >= sa.x - EPS, `${label} left`);
  assert.ok(item.y >= sa.y - EPS, `${label} top`);
  assert.ok(item.x + item.w <= sa.x + sa.w + EPS, `${label} right`);
  assert.ok(item.y + item.h <= sa.y + sa.h + EPS, `${label} bottom`);
  assert.ok(item.w > 0 && item.h > 0, `${label} size`);
};

test('LAYOUTS has exactly the nine layout names, in order', () => {
  assert.deepEqual(Object.keys(LAYOUTS), [...LAYOUT_NAMES]);
});

test('each layout has its slots in order', () => {
  for (const [name, slots] of Object.entries(SLOTS)) {
    assert.deepEqual(LAYOUTS[name].slots.map((s) => s.name), slots, name);
  }
});

test('every placed item lies inside the safe area of its page', () => {
  for (const layout of LAYOUT_NAMES) {
    for (const paper of PAPERS) {
      for (const margin_mm of MARGINS) {
        for (const page of PAGES) {
          const sa = safeArea(paper, margin_mm, page);
          const items = place(layout, fill(layout), paper, { margin_mm, page });
          assert.equal(items.length, SLOTS[layout].length, layout);
          for (const item of items) inside(item, sa, `${layout} ${paper} m${margin_mm} p${page} ${item.slot}`);
        }
      }
    }
  }
});

test('without a page, items fit inside every page\'s safe area', () => {
  for (const layout of LAYOUT_NAMES) {
    for (const paper of PAPERS) {
      const items = place(layout, fill(layout), paper, { margin_mm: 10 });
      for (let page = 1; page <= 8; page += 1) {
        for (const item of items) inside(item, safeArea(paper, 10, page), `${layout} ${paper} p${page} ${item.slot}`);
      }
    }
  }
});

test('placed items form a Dog that validates strictly', () => {
  for (const paper of PAPERS) {
    const dog = newDog({ paper });
    dog.assets = { a1: { kind: 'image', file_id: 1, w: 1300, h: 900 } };
    dog.pages.forEach((p, i) => {
      const layout = LAYOUT_NAMES[i];
      p.layout = layout;
      p.items = place(layout, fill(layout), paper, { margin_mm: dog.margin_mm, page: i + 1 });
    });
    const res = validateDog(dog, { mode: 'strict' });
    assert.deepEqual(res.errors ?? [], [], paper);
  }
});

test('items carry slot, by (default hand) and their style', () => {
  const items = place('cover', {
    title: { text: 'Plant Medicine', by: 'ai' },
    subtitle: { text: 'Issue 1' },
    photo: { asset: 'a1', by: 'import' },
  }, 'letter', { page: 1 });
  const [title, subtitle, photo] = items;
  assert.deepEqual(items.map((i) => i.slot), ['title', 'subtitle', 'photo']);
  assert.deepEqual(items.map((i) => i.by), ['ai', 'hand', 'import']);
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
  assert.equal(title.type, 'text');
  assert.equal(title.font, 'display');
  assert.equal(subtitle.font, 'body');
  assert.equal(title.color, 'toner');
  assert.equal(typeof title.align, 'string');
  assert.ok(title.size > subtitle.size);
  assert.deepEqual(title.runs, [{ text: 'Plant Medicine' }]);
  assert.equal(photo.type, 'image');
  assert.equal(photo.asset, 'a1');
  assert.equal(photo.fit, 'cover');
  assert.deepEqual(photo.focus, [0.5, 0.5]);
});

test('ids are unique across pages', () => {
  const a = place('headline-body', fill('headline-body'), 'a4', { page: 2 });
  const b = place('headline-body', fill('headline-body'), 'a4', { page: 3 });
  const ids = [...a, ...b].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a list slot is one text item with a bulleted run per line', () => {
  const [, list] = place('list', { title: { text: 'Kit' }, list: { items: ['cup', 'kettle'] } }, 'a4', { page: 4 });
  assert.equal(list.type, 'text');
  assert.equal(list.slot, 'list');
  assert.deepEqual(list.runs, [{ text: '• cup' }, { text: '• kettle' }]);
});

test('unfilled slots are left out; freeform places nothing', () => {
  const items = place('photo-caption', { body: { text: 'just words' } }, 'letter', { page: 6 });
  assert.deepEqual(items.map((i) => i.slot), ['body']);
  assert.deepEqual(place('freeform', {}, 'letter', { page: 6 }), []);
});

test('unknown layouts and slots throw', () => {
  assert.throws(() => place('poster', {}, 'a4'), /Unknown layout/);
  assert.throws(() => place('quote', { title: { text: 'x' } }, 'a4'), /Unknown slot/);
  assert.throws(() => place('freeform', { title: { text: 'x' } }, 'a4'), /Unknown slot/);
  assert.throws(() => budget('poster', 'title', 'a4'), /Unknown layout/);
  assert.throws(() => budget('quote', 'title', 'a4'), /Unknown slot/);
});

test('every text slot is at least MIN_FONT_SIZE', () => {
  assert.equal(typeof MIN_FONT_SIZE, 'number');
  assert.ok(MIN_FONT_SIZE > 0 && MIN_FONT_SIZE < 0.1);
  for (const layout of LAYOUT_NAMES) {
    for (const s of LAYOUTS[layout].slots) {
      if (s.kind !== 'image') assert.ok(s.size >= MIN_FONT_SIZE, `${layout}.${s.name}`);
    }
  }
});

test('budget is a non-negative integer; image slots get 0', () => {
  for (const layout of LAYOUT_NAMES) {
    for (const s of LAYOUTS[layout].slots) {
      for (const paper of PAPERS) {
        const n = budget(layout, s.name, paper, { margin_mm: 6, page: 3 });
        assert.ok(Number.isInteger(n) && n >= 0, `${layout}.${s.name}`);
        if (s.kind === 'image') assert.equal(n, 0, `${layout}.${s.name}`);
        else assert.ok(n > 0, `${layout}.${s.name}`);
      }
    }
  }
});

test('budget follows box size, font size and the glyph-width constant', () => {
  const paper = 'letter';
  const page = 1;
  const items = place('headline-body', fill('headline-body'), paper, { margin_mm: 6, page });
  const body = items.find((i) => i.slot === 'body');
  const { w, h } = panelSize(paper);
  const font = body.size * h;
  const perLine = Math.floor((body.w * w) / (GLYPH_EM * font));
  const lines = Math.floor((body.h * h) / (LINE_HEIGHT * font));
  assert.equal(budget('headline-body', 'body', paper, { margin_mm: 6, page }), perLine * lines);
});

test('a wider margin never raises a budget', () => {
  for (const paper of PAPERS) {
    const narrow = budget('back-cover', 'body', paper, { margin_mm: 0, page: 5 });
    const wide = budget('back-cover', 'body', paper, { margin_mm: 10, page: 5 });
    assert.ok(wide < narrow, `${paper}: margin 10 should cost characters`);
  }
});

test('ids are fresh: page-less placements merge into a valid Dog and re-placing gives new ids', () => {
  const dog = newDog({ paper: 'a4' });
  dog.assets = { a1: { kind: 'image', file_id: 1, w: 1300, h: 900 } };
  dog.pages[0].layout = 'two-up';
  dog.pages[0].items = [...place('two-up', fill('two-up'), 'a4'), ...place('two-up', fill('two-up'), 'a4')];
  assert.deepEqual(validateDog(dog, { mode: 'strict' }).errors ?? [], []);

  const first = place('quote', fill('quote'), 'letter', { page: 2 }).map((i) => i.id);
  const again = place('quote', fill('quote'), 'letter', { page: 2 }).map((i) => i.id);
  assert.equal(new Set([...first, ...again]).size, first.length + again.length);
});

test('a slot filled with null counts as unfilled', () => {
  const items = place('headline-body', { title: null, body: { text: 'words' } }, 'a4', { page: 3 });
  assert.deepEqual(items.map((i) => i.slot), ['body']);
});
