// Mustard: compile markdown to the Dog, export it back, and round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { compileMustard, exportMustard } from '../../Assets/js/core/mustard.js';
import { validateDog, newDog, MAX_DOG_BYTES } from '../../Assets/js/core/dog.js';
import { place, BULLET } from '../../Assets/js/core/layouts.js';

const DIR = new URL('../fixtures/mustard/', import.meta.url);
const FIXTURES = readdirSync(DIR).filter((f) => f.endsWith('.mustard.md')).sort();
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');
const EPS = 1e-6;

const textOf = (item) => item.runs.map((r) => r.text).join('\n');
const slotItem = (page, slot) => page.items.find((i) => i.slot === slot);
const slotText = (page, slot) => textOf(slotItem(page, slot));
const front = (body, extra = '') => `---\nmustard: 1\ntitle: T\npaper: letter\n${extra}---\n\n${body}`;
const pageOf = (layout, body, attrs = '') => `::: page {layout=${layout}${attrs}}\n${body}\n:::\n`;
const compileOne = (layout, body, opts) => compileMustard(front(pageOf(layout, body)), opts);
const strict = (dog) => validateDog(dog, { mode: 'strict' });

/** What a round trip must keep: page ids and layouts, item ids, slots and slot text. */
function shape(dog) {
  return dog.pages.map((p) => ({
    id: p.id,
    layout: p.layout,
    items: p.items.map((i) => ({ id: i.id, type: i.type, slot: i.slot, text: i.runs ? textOf(i) : undefined })),
  }));
}

test('there are fixtures, including the Plant Medicine sample', () => {
  assert.ok(FIXTURES.includes('plant-medicine.mustard.md'));
  assert.ok(FIXTURES.length >= 3);
});

for (const name of FIXTURES) {
  test(`${name} compiles to a strict-valid Dog without errors`, () => {
    for (const paper of ['letter', 'a4']) {
      const { dog, errors } = compileMustard(read(name), { paper });
      assert.deepEqual(errors, [], paper);
      assert.deepEqual(strict(dog).errors ?? [], [], paper);
      assert.equal(dog.pages.length, 8);
    }
  });

  test(`${name} round-trips ids, slot text, layouts and geometry`, () => {
    const first = compileMustard(read(name)).dog;
    const { text } = exportMustard(first);
    const second = compileMustard(text);
    assert.deepEqual(second.errors, []);
    assert.deepEqual(shape(second.dog), shape(first));
    assert.equal(second.dog.title, first.title);
    assert.equal(second.dog.issue, first.issue);
    first.pages.forEach((p, n) => p.items.forEach((item, i) => {
      const again = second.dog.pages[n].items[i];
      for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(again[k] - item[k]) < EPS, `${item.id}.${k}`);
      for (const k of ['by', 'attrs', 'focus', 'rot', 'locked']) assert.deepEqual(again[k], item[k], `${item.id}.${k}`);
    }));
    // Exporting the re-compiled Dog gives the same text: export is a fixed point.
    assert.equal(exportMustard(second.dog).text, text);
  });
}

test('the Plant Medicine sample: eight pages from the draft plan, Spanish first, placeholders for photos', () => {
  const { dog, warnings } = compileMustard(read('plant-medicine.mustard.md'));
  assert.equal(dog.title, 'Medicina de plantas en Puerto Rico');
  assert.equal(dog.issue, 1);
  assert.equal(dog.paper, 'letter');
  assert.deepEqual(dog.pages.map((p) => p.layout), [
    'cover', 'headline-body', 'photo-caption', 'quote', 'headline-body', 'list', 'headline-body', 'back-cover',
  ]);
  assert.equal(slotText(dog.pages[0], 'title'), 'Medicina de plantas');
  assert.match(slotText(dog.pages[7], 'body'), /^No es consejo médico \/ Not medical advice\n/);
  // Each bilingual block opens in Spanish.
  assert.match(slotText(dog.pages[1], 'body'), /^Raíces, ancestros/);
  assert.match(slotText(dog.pages[1], 'body'), /\n\nRoots, ancestors/);
  const placeholders = Object.values(dog.assets).filter((a) => a.kind === 'placeholder').map((a) => a.name).sort();
  assert.deepEqual(placeholders, ['cohoba.jpg', 'portada.jpg']);
  // The only warnings are the two unknown photos: everything fits its budget on both papers.
  assert.deepEqual(warnings.map((w) => w.path), ['pages/0/items/2/asset', 'pages/2/items/1/asset']);
  assert.deepEqual(compileMustard(read('plant-medicine.mustard.md'), { paper: 'a4' }).warnings.length, 2);
});

test('front matter: version, title, paper, look and margin; opts.paper is only the default', () => {
  const { dog, warnings, errors } = compileMustard(read('attributes.mustard.md'), { paper: 'letter' });
  assert.deepEqual(errors, []);
  assert.equal(dog.title, 'Attributes: a "test" zine');
  assert.equal(dog.paper, 'a4');
  assert.equal(dog.margin_mm, 8);
  assert.equal(dog.look, 'night');
  assert.ok(!warnings.some((w) => w.path === 'mustard'));

  const plain = compileMustard(pageOf('freeform', ''), { paper: 'a4' });
  assert.equal(plain.dog.paper, 'a4');
  assert.equal(plain.dog.title, '');
  assert.equal(plain.dog.look, 'kraft');
  assert.equal(Object.hasOwn(plain.dog, 'issue'), false);
  assert.ok(plain.warnings.some((w) => w.path === 'mustard'));
  assert.equal(compileMustard(pageOf('freeform', '')).dog.paper, 'letter');
});

test('front matter: scalars, quoted strings, comments and a flow list', () => {
  const text = [
    '---', '# a comment', 'mustard: 1', "title: 'It''s \"here\"' # trailing", 'look: copy-shop',
    'kept: [k1, "st 2"]', 'colour: red', '---', '',
  ].join('\n');
  const { dog, warnings, errors } = compileMustard(text);
  assert.deepEqual(errors, []);
  assert.equal(dog.title, 'It\'s "here"');
  assert.equal(dog.look, 'copy-shop');
  assert.ok(warnings.some((w) => w.path === 'colour' && /unknown/.test(w.message)));
  assert.ok(warnings.some((w) => w.path === 'kept'));
  assert.equal(compileMustard('---\ntitle: "a\\"b\\\\c"\n---\n').dog.title, 'a"b\\c');
  // issue is a string or a whole number, and round-trips either way.
  for (const issue of ['"Spring 2027"', '12', '"12"']) {
    const one = compileMustard(`---\nmustard: 1\nissue: ${issue}\n---\n`);
    assert.deepEqual(one.errors, []);
    assert.equal(compileMustard(exportMustard(one.dog).text).dog.issue, one.dog.issue);
  }
  assert.equal(compileMustard('---\nissue: "12"\n---\n').dog.issue, '12');
  assert.deepEqual(compileMustard('---\nissue: -1\n---\n').errors.map((e) => e.path), ['issue']);
});

test('front matter errors: another Mustard version, an unknown paper, a margin out of range', () => {
  assert.deepEqual(compileMustard('---\nmustard: 2\n---\n').errors.map((e) => e.path), ['mustard']);
  const bad = compileMustard('---\nmustard: 1\npaper: legal\nmargin_mm: 11\n---\n');
  assert.deepEqual(bad.errors.map((e) => e.path), ['paper', 'margin_mm']);
  assert.equal(bad.dog.paper, 'letter');
  assert.equal(bad.dog.margin_mm, 6);
  assert.deepEqual(strict(bad.dog).errors ?? [], []);
});

test('the formats example: slots filled in order, images resolved through assets, blanks added', () => {
  const assets = { a1: { kind: 'image', file_id: 412, w: 1300, h: 1950, name: 'elder.jpg' } };
  const { dog, warnings, errors } = compileMustard(read('example.mustard.md'), { assets });
  assert.deepEqual(errors, []);
  const [cover, elder, list, quote, free] = dog.pages;
  assert.equal(slotText(cover, 'title'), 'Plant Medicine');
  assert.equal(slotText(cover, 'subtitle'), 'Notes from the backyard apothecary');
  const photo = slotItem(cover, 'photo');
  assert.equal(photo.asset, 'a1');
  assert.deepEqual(dog.assets.a1, assets.a1);
  assert.deepEqual(photo.focus, [0.5, 0.35]);
  assert.deepEqual(photo.attrs, { alt: 'Elderberries on the vine' });
  assert.equal(slotText(elder, 'title'), 'Elder');
  assert.equal(slotText(elder, 'body'), 'Flowers in June, berries in August. Never eat them raw.');
  const bullets = ['Calendula', 'Lemon balm', 'Chamomile'].map((t) => `${BULLET} ${t}`);
  assert.deepEqual(slotItem(list, 'list').runs.map((r) => r.text), bullets);
  assert.equal(slotText(quote, 'quote'), 'The garden is the first pharmacy.');
  // Every compiled item is by import.
  assert.ok(dog.pages.flatMap((p) => p.items).every((i) => i.by === 'import'));

  // Unknown image: a placeholder asset and a warning.
  const ph = slotItem(elder, 'photo');
  assert.deepEqual(dog.assets[ph.asset], { kind: 'placeholder', name: 'elderflower.jpg' });
  assert.doesNotMatch(ph.asset, /^[0-9]+$/);
  assert.ok(warnings.some((w) => w.path === 'pages/1/items/1/asset' && /elderflower\.jpg/.test(w.message)));

  // Freeform: nothing placed for you; .place pins the paragraph, h defaults.
  assert.equal(free.items.length, 2);
  assert.ok(free.items.every((i) => i.slot === undefined));
  const blend = free.items[1];
  assert.equal(textOf(blend), 'Draw your blend here.');
  assert.deepEqual([blend.x, blend.y, blend.w], [0.1, 0.7, 0.8]);
  assert.ok(blend.h > 0);

  // Five pages written: three blank freeform pages and a warning.
  assert.deepEqual(dog.pages.slice(5).map((p) => [p.id, p.layout, p.items.length]), [
    ['p6', 'freeform', 0], ['p7', 'freeform', 0], ['p8', 'freeform', 0],
  ]);
  assert.ok(warnings.some((w) => w.path === 'pages' && /5/.test(w.message)));
});

test('images resolve by asset id, by name and by file:id', () => {
  const assets = { a1: { kind: 'image', file_id: 7, name: 'x.jpg' }, b2: { kind: 'image', file_id: 9 } };
  const body = '![](a1)\n\n![](file:9)';
  const { dog, warnings } = compileOne('two-up', body, { assets });
  assert.deepEqual(dog.pages[0].items.map((i) => i.asset), ['a1', 'b2']);
  assert.deepEqual(Object.keys(dog.assets).sort(), ['a1', 'b2']);
  assert.ok(!warnings.some((w) => /asset/.test(w.path)));
  assert.equal(compileOne('photo-full', '![](x.jpg)', { assets }).dog.pages[0].items[0].asset, 'a1');
  // One placeholder per unknown name.
  const two = compileOne('two-up', '![](nope.jpg)\n\n![](nope.jpg)');
  assert.equal(Object.keys(two.dog.assets).length, 1);
});

test('paragraphs fill the remaining text slots in layout order, then continue the last one', () => {
  const quote = compileOne('quote', 'By someone\n\n> Words');
  assert.equal(slotText(quote.dog.pages[0], 'quote'), 'Words');
  assert.equal(slotText(quote.dog.pages[0], 'attribution'), 'By someone');

  const back = compileOne('back-cover', 'One\n\nTwo\n\nThree');
  assert.equal(slotText(back.dog.pages[0], 'body'), 'One');
  assert.equal(slotText(back.dog.pages[0], 'note'), 'Two\n\nThree');

  // A heading without a title slot reads as a paragraph.
  const noTitle = compileOne('photo-full', '# Caption');
  assert.equal(slotText(noTitle.dog.pages[0], 'caption'), 'Caption');

  // Soft line breaks join with a space; a trailing backslash is a hard break.
  const lines = compileOne('headline-body', 'a\nb\\\nc');
  assert.equal(slotText(lines.dog.pages[0], 'body'), 'a b\nc');
});

test('attributes: #id, classes, by, unknown keys, slot=, locked, focus, .place with rot', () => {
  const { dog, warnings } = compileMustard(read('attributes.mustard.md'));
  const [front, back, many, caption, escaped, free] = dog.pages;
  assert.equal(front.id, 'front');
  assert.equal(front.bg, 'kraft');
  const h = slotItem(front, 'title');
  assert.equal(h.id, 'headline');
  assert.equal(h.by, 'hand');
  assert.deepEqual(h.attrs, { class: 'big loud', tone: 'warm' });
  assert.deepEqual(slotItem(front, 'photo').focus, [0.25, 0.75]);
  assert.equal(slotItem(front, 'photo2').by, 'ai');
  const body = slotItem(front, 'body');
  assert.deepEqual([body.x, body.y, body.w, body.h, body.rot], [0.1, 0.62, 0.8, 0.3, -3]);

  assert.equal(slotText(back, 'note'), 'The note comes first here.');
  assert.equal(slotItem(back, 'note').locked, true);
  assert.equal(slotText(back, 'body'), 'And the body second.');

  assert.equal(slotText(many, 'body'), 'First paragraph.\n\nSecond paragraph,\nwith a hard break.');
  const third = many.items.find((i) => i.id === 'third-para');
  assert.equal(third.slot, undefined);
  assert.ok(warnings.some((w) => w.path === `pages/2/items/${many.items.indexOf(third)}` && /slot/.test(w.message)));

  assert.equal(slotText(caption, 'caption'), 'A caption with no photo.');
  assert.equal(slotText(escaped, 'body'), '# Not a heading, a body');

  // Freeform blocks become free items, styled like their block kind.
  assert.deepEqual(free.items.map((i) => i.type), ['text', 'text', 'image']);
  assert.equal(free.items[0].align, 'center');
  assert.deepEqual(free.items[1].runs.map((r) => r.text), [`${BULLET} loose`, `${BULLET} list`]);
  assert.deepEqual([free.items[2].x, free.items[2].w], [0.2, 0.4]);
});

test('attribute problems are warnings: a bad by, geometry without .place, a bad focus, an unknown slot', () => {
  const { dog, warnings, errors } = compileOne('photo-caption', [
    '# T {by=robot}', '![](p.jpg){focus=2,0}', 'Body {x=0.5 slot=nope}',
  ].join('\n'));
  assert.deepEqual(errors, []);
  const [title, photo, body] = dog.pages[0].items;
  assert.equal(title.by, 'import');
  assert.deepEqual(photo.focus, [0.5, 0.5]);
  assert.deepEqual(body.attrs, { x: '0.5' });
  assert.equal(body.slot, 'body');
  for (const re of [/by/, /focus/, /\.place/, /nope/]) assert.ok(warnings.some((w) => re.test(w.message)), String(re));
});

test('a trailing brace that is not an attribute block stays text', () => {
  const { dog } = compileOne('headline-body', 'Sets {like this one}');
  assert.equal(slotText(dog.pages[0], 'body'), 'Sets {like this one}');
});

test('errors: more than eight pages, a duplicate id, an unknown layout', () => {
  const nine = compileMustard(front(Array.from({ length: 9 }, () => pageOf('freeform', '')).join('\n')));
  assert.deepEqual(nine.errors.map((e) => e.path), ['pages']);
  assert.equal(nine.dog.pages.length, 8);

  const dup = compileOne('headline-body', '# A {#x}\n\nB {#x}');
  assert.equal(dup.errors.length, 1);
  assert.match(dup.errors[0].message, /duplicate/);
  assert.equal(dup.errors[0].path, 'pages/0/items/1/id');

  const dupPage = compileMustard(front(pageOf('freeform', '', ' #a') + pageOf('freeform', '', ' #a')));
  assert.deepEqual(dupPage.errors.map((e) => e.path), ['pages/1/id']);

  const unknown = compileOne('centrefold', 'x');
  assert.deepEqual(unknown.errors.map((e) => e.path), ['pages/0/layout']);
  assert.equal(unknown.dog.pages[0].layout, 'freeform');
});

test('structure warnings: text outside a page, an unclosed page, a page without a layout', () => {
  const { dog, warnings, errors } = compileMustard(front('stray text\n\n::: page\n# Hi\n'));
  assert.deepEqual(errors, []);
  assert.equal(dog.pages[0].layout, 'freeform');
  assert.equal(dog.pages[0].items.length, 1);
  for (const re of [/outside/, /not closed/, /layout/]) assert.ok(warnings.some((w) => re.test(w.message)), String(re));
});

test('over-budget text is a warning with the item path, never truncated', () => {
  const long = 'word '.repeat(40).trim();
  const { dog, warnings } = compileOne('cover', `# ${long}`);
  assert.equal(slotText(dog.pages[0], 'title'), long);
  const w = warnings.find((x) => x.path === 'pages/0/items/0/runs');
  assert.ok(w);
  assert.match(w.message, /budget/);
});

test('text past the Dog limit is an error from validation', () => {
  const { errors } = compileOne('headline-body', 'x'.repeat(2001));
  assert.deepEqual(errors.map((e) => e.path), ['pages/0/items/0/runs']);
});

test('export: every item gets {#id}, front matter carries the zine, kept lists ink, stickers and shapes', () => {
  const dog = JSON.parse(readFileSync(new URL('../fixtures/dog/valid-full.json', import.meta.url), 'utf8'));
  const { text, kept } = exportMustard(dog);
  assert.deepEqual(kept, ['k1', 'sh1', 'st1']);
  assert.match(text, /^---\n# .*kept/);
  assert.match(text, /\nmustard: 1\n/);
  assert.match(text, /\ntitle: Plant Medicine\n/);
  assert.match(text, /\nkept: \[k1, sh1, st1\]\n/);
  assert.match(text, /\{#t1 /);
  assert.match(text, /!\[\]\(elder\.jpg\)\{#i1 /);
  for (const id of ['k1', 'sh1', 'st1']) assert.doesNotMatch(text, new RegExp(`#${id}\\b`));
});

test('export: {.place} only for items moved off their slot', () => {
  const { dog } = compileOne('headline-body', '# Title\n\nBody');
  const [title, body] = dog.pages[0].items;
  body.x += 0.05;
  const { text } = exportMustard(dog);
  assert.match(text, new RegExp(`# Title \\{#${title.id}\\}`));
  assert.match(text, new RegExp(`Body \\{#${body.id} \\.place x=[0-9.]+ y=[0-9.]+ w=[0-9.]+ h=[0-9.]+\\}`));
  const again = compileMustard(text).dog.pages[0].items[1];
  assert.ok(Math.abs(again.x - body.x) < EPS);
  assert.equal(again.slot, 'body');
});

test('round trip of hand-made pages: empty earlier slots, multi-line titles, free items, every by', () => {
  const dog = newDog({ title: 'Hand', paper: 'a4' });
  const at = (layout, slots, page) => place(layout, slots, 'a4', { page });
  dog.pages[0].layout = 'back-cover';
  dog.pages[0].items = at('back-cover', { note: { text: 'only the note', by: 'hand' } }, 1);
  dog.pages[1].layout = 'two-up';
  dog.assets.pic = { kind: 'image', file_id: 5 };
  dog.pages[1].items = at('two-up', {
    title: { text: 'two\nlines', by: 'ai' }, photo2: { asset: 'pic' }, body: { text: 'p1\n\np2\nhard', by: 'import' },
  }, 2);
  dog.pages[1].items.push({
    id: 'free-1', type: 'text', by: 'hand', x: 0.1, y: 0.1, w: 0.3, h: 0.1, font: 'body', size: 0.03, align: 'left',
    color: 'toner', runs: [{ text: '- not a list\n# not a heading\n::: not a fence' }],
  });
  dog.pages[2].layout = 'list';
  dog.pages[2].items = at('list', { list: { items: ['a', 'b'] } }, 3);
  assert.deepEqual(strict(dog).errors ?? [], []);

  const { text } = exportMustard(dog);
  const back = compileMustard(text, { assets: dog.assets });
  assert.deepEqual(back.errors, []);
  assert.deepEqual(shape(back.dog), shape(dog));
  assert.deepEqual(back.dog.pages[1].items.map((i) => i.by), dog.pages[1].items.map((i) => i.by));
  assert.equal(back.dog.pages[1].items.find((i) => i.slot === 'photo2').asset, 'pic');
  assert.equal(exportMustard(back.dog).text, text);
});

test('kept items come back when re-imported into the same zine', () => {
  const dog = JSON.parse(readFileSync(new URL('../fixtures/dog/valid-full.json', import.meta.url), 'utf8'));
  const { text } = exportMustard(dog);
  const alone = compileMustard(text);
  assert.ok(alone.warnings.some((w) => w.path === 'kept'));
  assert.equal(alone.dog.pages[0].items.find((i) => i.id === 'k1'), undefined);

  const same = compileMustard(text, { assets: dog.assets, from: dog });
  assert.deepEqual(same.errors, []);
  assert.deepEqual(same.dog.pages[0].items.find((i) => i.id === 'k1'), dog.pages[0].items[2]);
  assert.deepEqual(same.dog.pages[1].items.map((i) => i.id), ['sh1', 'st1']);
  assert.deepEqual(same.dog.assets.s1, dog.assets.s1);
  assert.deepEqual(strict(same.dog).errors ?? [], []);
});

test('long whitespace runs and long lists compile in linear time', () => {
  const pad = ' '.repeat(100_000);
  const cases = {
    'front matter value': `---\ntitle: a${pad}x\n---\n`,
    'front matter comment': `---\ntitle: a${pad}#${pad}x\n---\n`,
    'front matter key': `---\ntitle${pad}x\n---\n`,
    'flow list': `---\nkept: [${'a,'.repeat(50_000)}a]\n---\n`,
    'page line': front(`::: page${pad}x\n:::\n`),
    'page attrs': front(`::: page {${pad}x\n:::\n`),
    'trailing braces': front(pageOf('freeform', `para${pad}{${pad}x`)),
    'many classes': front(pageOf('freeform', `para {${' .a'.repeat(30_000)}}`)),
    'broken image': front(pageOf('freeform', `![${pad}](${pad}x`)),
    'quote and list': front(pageOf('freeform', `>${pad}x\n-${pad}x\n#${pad}x`)),
  };
  for (const [name, text] of Object.entries(cases)) {
    const t0 = performance.now();
    compileMustard(text);
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${name}: ${ms.toFixed(0)} ms`);
  }
});

test('input over the Dog size limit is refused with an error', () => {
  for (const text of ['x'.repeat(MAX_DOG_BYTES + 1), 'é'.repeat(MAX_DOG_BYTES / 2 + 1)]) {
    const { dog, errors } = compileMustard(text);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, '');
    assert.match(errors[0].message, /bytes/);
    assert.equal(dog.pages.length, 8);
  }
});

test('image names with parentheses or spaces and alt text with brackets round-trip', () => {
  const dog = newDog({ title: 'Imgs' });
  dog.assets.a = { kind: 'image', file_id: 3, name: 'photo (1).jpg' };
  dog.assets.b = { kind: 'image', file_id: 4, name: 'a <b> c\\d.jpg' };
  dog.pages[0].layout = 'two-up';
  dog.pages[0].items = place('two-up', { photo: { asset: 'a' }, photo2: { asset: 'b' } }, 'letter', { page: 1 });
  dog.pages[0].items[0].attrs = { alt: 'a ] b [c] \\ d' };
  const { text } = exportMustard(dog);
  const back = compileMustard(text, { assets: dog.assets });
  assert.deepEqual(back.warnings.filter((w) => /image/.test(w.message)), []);
  assert.deepEqual(back.dog.pages[0].items.map((i) => i.asset), ['a', 'b']);
  assert.deepEqual(back.dog.pages[0].items[0].attrs, { alt: 'a ] b [c] \\ d' });
  assert.equal(exportMustard(back.dog).text, text);
  // Hand-written: the CommonMark <…> form and balanced parentheses both work.
  const assets = { a: dog.assets.a };
  assert.equal(compileOne('photo-full', '![x](<photo (1).jpg>)', { assets }).dog.pages[0].items[0].asset, 'a');
  assert.equal(compileOne('photo-full', '![x](photo (1).jpg)', { assets }).dog.pages[0].items[0].asset, 'a');
});

test('a line that starts like an image but does not parse warns and stays text', () => {
  const { dog, warnings } = compileOne('headline-body', '![oops](x.jpg');
  assert.equal(slotText(dog.pages[0], 'body'), '![oops](x.jpg');
  assert.ok(warnings.some((w) => w.path === 'pages/0' && /image/.test(w.message) && w.line));
});

test('export: ids that attributes cannot carry are re-minted with a warning; values and classes round-trip', () => {
  const dog = newDog({ title: 'Ids' });
  dog.pages[0].id = 'page one';
  dog.pages[0].layout = 'headline-body';
  dog.pages[0].items = place('headline-body', { title: { text: 'T' }, body: { text: 'B' } }, 'letter', { page: 1 });
  const [title, body] = dog.pages[0].items;
  body.id = 'body.1';
  title.attrs = { class: 'a.b c', note: 'a}b', other: 'x"y {z} \\ q', empty: '' };
  const { text, warnings } = exportMustard(dog);
  assert.deepEqual(warnings.map((w) => w.path), ['pages/0/id', 'pages/0/items/1/id']);
  const back = compileMustard(text);
  assert.deepEqual(back.errors, []);
  const page = back.dog.pages[0];
  assert.equal(page.layout, 'headline-body');
  assert.equal(slotText(page, 'title'), 'T');
  assert.equal(slotText(page, 'body'), 'B');
  assert.equal(slotItem(page, 'title').id, title.id);
  assert.notEqual(slotItem(page, 'body').id, 'body.1');
  assert.deepEqual(slotItem(page, 'title').attrs, title.attrs);
});

test('export never throws on a sparse Dog and never writes undefined', () => {
  assert.doesNotThrow(() => exportMustard({}));
  const sparse = {
    title: 'S',
    pages: [{ layout: 'cover', items: [
      { type: 'text', slot: 'title', runs: [{}] }, { type: 'image', slot: 'photo' },
      { type: 'text', id: 'loose' }, null,
      { type: 'image', id: 'img', x: 0.1 },
    ] }, null, {}],
  };
  const { text } = exportMustard(sparse);
  assert.doesNotMatch(text, /undefined|NaN|null/);
  const back = compileMustard(text);
  assert.deepEqual(back.errors, []);
});

test('item order (z-order) survives export and compile, kept items included', () => {
  const dog = newDog({ title: 'Z' });
  dog.assets.pic = { kind: 'image', file_id: 1, name: 'pic.jpg' };
  dog.pages[0].layout = 'photo-full';
  const slots = { photo: { asset: 'pic' }, caption: { text: 'C' } };
  const [photo, caption] = place('photo-full', slots, 'letter', { page: 1 });
  const ink = { id: 'k1', type: 'ink', points: [[0.1, 0.1], [0.2, 0.2]], width: 0.01, color: 'toner', by: 'hand' };
  const loose = {
    id: 'loose', type: 'text', by: 'hand', x: 0.1, y: 0.1, w: 0.5, h: 0.1, font: 'body', size: 0.03, align: 'left',
    color: 'toner', runs: [{ text: 'on top of nothing' }],
  };
  dog.pages[0].items = [caption, ink, loose, photo];
  const { text } = exportMustard(dog);
  const back = compileMustard(text, { assets: dog.assets, from: dog });
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.dog.pages[0].items.map((i) => i.id), [caption.id, 'k1', 'loose', photo.id]);
  assert.equal(exportMustard(back.dog).text, text);
  // Hand-written order is document order.
  const doc = compileOne('photo-caption', '![](a.jpg)\n\n# T\n\nBody');
  assert.deepEqual(doc.dog.pages[0].items.map((i) => i.slot), ['photo', 'title', 'body']);
});
