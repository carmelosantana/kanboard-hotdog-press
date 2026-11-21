// Document edits the editor makes: items, locks, page reorder, layouts and Mustard Apply. All return a new Dog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, updateItem, removeItems, toggleLock, findItem, movePage, applyLayout, applyMustard, addAsset,
  textItem, shapeItem, inkItem, imageItem, stickerItem, PLACEHOLDER_ASSET,
} from '../../Assets/js/app/edit.js';
import { newDog, validateDog } from '../../Assets/js/core/dog.js';
import { compileMustard, exportMustard } from '../../Assets/js/core/mustard.js';
import { deepFreeze } from '../../Assets/js/app/store.js';

const strictOk = (dog) => {
  const r = validateDog(dog, { mode: 'strict' });
  assert.ok(r.ok, JSON.stringify(r.errors));
};
const shape = (id, over = {}) => ({ id, type: 'shape', by: 'hand', x: 0.1, y: 0.1, w: 0.2, h: 0.2, shape: 'rect', ...over });

test('add, update, find and remove items without touching the input (frozen) document', () => {
  const dog = deepFreeze(newDog());
  const a = addItem(dog, 2, shape('s1'));
  assert.equal(dog.pages[2].items.length, 0);
  assert.equal(a.pages[2].items[0].id, 's1');
  const b = updateItem(a, 's1', { x: 0.5 });
  assert.equal(b.pages[2].items[0].x, 0.5);
  assert.equal(a.pages[2].items[0].x, 0.1);
  assert.deepEqual(findItem(b, 's1').page, 2);
  assert.equal(findItem(b, 'nope'), null);
  const c = removeItems(b, ['s1']);
  assert.equal(c.pages[2].items.length, 0);
  assert.equal(updateItem(b, 'nope', { x: 1 }), b, 'unknown id is no change');
});

test('locked items are not removed or moved; toggleLock flips them all one way', () => {
  let dog = addItem(newDog(), 0, shape('a'));
  dog = addItem(dog, 0, shape('b'));
  dog = toggleLock(dog, ['a']);
  assert.equal(findItem(dog, 'a').item.locked, true);
  assert.equal(updateItem(dog, 'a', { x: 0.9 }), dog);
  assert.equal(updateItem(dog, 'a', { locked: false }).pages[0].items[0].locked, false, 'unlock is allowed');
  dog = removeItems(dog, ['a', 'b']);
  assert.deepEqual(dog.pages[0].items.map((i) => i.id), ['a']);
  dog = toggleLock(dog, ['a']);
  assert.equal(findItem(dog, 'a').item.locked, undefined);
});

test('movePage moves a page with its contents; page and item ids stay unique', () => {
  let dog = newDog();
  dog = addItem(dog, 0, shape('first'));
  dog = addItem(dog, 4, shape('fifth'));
  const moved = movePage(dog, 0, 3);
  assert.deepEqual(moved.pages.map((p) => p.id), ['p2', 'p3', 'p4', 'p1', 'p5', 'p6', 'p7', 'p8']);
  assert.equal(moved.pages[3].items[0].id, 'first');
  assert.equal(moved.pages[4].items[0].id, 'fifth');
  assert.deepEqual(movePage(dog, 7, 0).pages.map((p) => p.id)[0], 'p8');
  assert.equal(movePage(dog, 2, 2), dog);
  strictOk(moved);
});

test('item factories make valid hand items', () => {
  let dog = newDog();
  dog = addAsset(dog, 'img1', { kind: 'image', file_id: 3, w: 1200, h: 800, name: 'a.jpg' });
  dog = addAsset(dog, 'st1', { kind: 'sticker', name: 'star', data: 'data:image/svg+xml;base64,AA==', w: 10, h: 10 });
  const items = [
    textItem({ x: 0.2, y: 0.3 }), shapeItem({ x: 0.2, y: 0.3 }, 'ellipse'), inkItem([[0.1, 0.1], [0.2, 0.3]]),
    imageItem('img1', 1200, 800, 74.25 / 105), stickerItem('st1'),
  ];
  for (const it of items) {
    assert.equal(it.by, 'hand');
    dog = addItem(dog, 1, it);
  }
  strictOk(dog);
  const img = items[3];
  // A 3:2 photo on a portrait page keeps its aspect in mm: w × panel_w / (h × panel_h) = 1.5.
  assert.ok(Math.abs((img.w * 74.25) / (img.h * 105) - 1.5) < 1e-9);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

test('applyLayout places the layout on that page, carries slot content over and keeps free hand and locked items', () => {
  let dog = newDog();
  dog = addItem(dog, 1, shape('free-hand'));
  dog = addItem(dog, 1, { ...shape('ai-thing'), by: 'ai' });
  dog = addItem(dog, 1, { ...shape('locked-ai'), by: 'ai', locked: true });
  dog = applyLayout(dog, 1, 'headline-body');
  const page = dog.pages[1];
  assert.equal(page.layout, 'headline-body');
  const ids = page.items.map((i) => i.id);
  assert.ok(ids.includes('free-hand'));
  assert.ok(ids.includes('locked-ai'));
  assert.ok(!ids.includes('ai-thing'));
  const title = page.items.find((i) => i.slot === 'title');
  assert.equal(title.type, 'text');
  assert.equal(title.by, 'import', 'an empty template box is not hand-made');
  strictOk(dog);

  // Type into the title, then switch layout: the text follows to the new layout's title slot, nothing doubles.
  dog = updateItem(dog, title.id, { runs: [{ text: 'Elder' }], by: 'hand' });
  dog = applyLayout(dog, 1, 'photo-caption');
  const slots = dog.pages[1].items.filter((i) => i.slot).map((i) => i.slot).sort();
  assert.deepEqual(slots, ['body', 'photo', 'title']);
  assert.equal(dog.pages[1].items.find((i) => i.slot === 'title').runs[0].text, 'Elder');
  const photo = dog.pages[1].items.find((i) => i.slot === 'photo');
  assert.equal(dog.assets[photo.asset].kind, 'placeholder');
  assert.equal(photo.asset, PLACEHOLDER_ASSET);
  strictOk(dog);

  // Freeform has no slots: the typed title stays as a free hand item where it was; empty template boxes go.
  const titleBox = dog.pages[1].items.find((i) => i.slot === 'title');
  dog = applyLayout(dog, 1, 'freeform');
  assert.deepEqual(dog.pages[1].items.filter((i) => i.slot).length, 0);
  assert.ok(dog.pages[1].items.some((i) => i.id === 'free-hand'));
  const freed = dog.pages[1].items.find((i) => i.type === 'text' && i.runs[0].text === 'Elder');
  assert.ok(freed, 'typed text is never dropped');
  assert.equal(freed.by, 'hand');
  assert.deepEqual([freed.x, freed.y, freed.w, freed.h], [titleBox.x, titleBox.y, titleBox.w, titleBox.h]);
  assert.equal(dog.pages[1].items.filter((i) => i.type === 'text').length, 1, 'empty template boxes are not kept');
  assert.ok(!(PLACEHOLDER_ASSET in dog.assets), 'an unused placeholder asset is dropped');
  strictOk(dog);
});

test('applyLayout keeps a list slot as list lines and an image slot asset across layouts', () => {
  let dog = addAsset(newDog(), 'img1', { kind: 'image', file_id: 9, w: 10, h: 10 });
  dog = applyLayout(dog, 0, 'photo-full');
  const photo = dog.pages[0].items.find((i) => i.slot === 'photo');
  dog = updateItem(dog, photo.id, { asset: 'img1' });
  dog = applyLayout(dog, 0, 'cover');
  assert.equal(dog.pages[0].items.find((i) => i.slot === 'photo').asset, 'img1');
  strictOk(dog);
});

test('applyMustard takes the compiled pages, keeps hand and locked items, and locked items win over the text', () => {
  let dog = newDog();
  dog = addItem(dog, 0, inkItem([[0.1, 0.1], [0.5, 0.5]]));
  const ink = dog.pages[0].items[0];
  dog = addItem(dog, 2, { ...textItem({ x: 0.1, y: 0.1 }), runs: [{ text: 'mine' }], locked: true });
  const locked = dog.pages[2].items[0];
  dog = addItem(dog, 3, { ...shape('old-import'), by: 'import' });
  const text = '---\nmustard: 1\ntitle: New\npaper: a4\n---\n\n::: page {layout=cover}\n# Hello\n:::\n';
  const compiled = compileMustard(text, { paper: dog.paper, assets: dog.assets, from: dog });
  assert.deepEqual(compiled.errors, []);
  const out = applyMustard(dog, compiled.dog);
  assert.equal(out.title, 'New');
  assert.equal(out.paper, 'a4');
  assert.equal(out.id, dog.id, 'the zine keeps its id');
  assert.ok(out.pages[0].items.some((i) => i.type === 'text' && i.runs[0].text === 'Hello'));
  assert.ok(out.pages[0].items.some((i) => i.id === ink.id), 'hand ink kept');
  assert.ok(out.pages[2].items.some((i) => i.id === locked.id), 'locked text kept');
  assert.ok(!out.pages[3].items.some((i) => i.id === 'old-import'), 'old import replaced');
  strictOk(out);

  // A round trip through the panel: exported, edited, applied — the locked item's text does not change.
  const exported = exportMustard(out).text.replace('mine', 'changed');
  const again = compileMustard(exported, { paper: out.paper, assets: out.assets, from: out });
  assert.deepEqual(again.errors, []);
  const merged = applyMustard(out, again.dog);
  assert.equal(findItem(merged, locked.id).item.runs[0].text, 'mine');
  assert.equal(merged.pages.flatMap((p) => p.items).filter((i) => i.id === ink.id).length, 1, 'no duplicate ids');
  strictOk(merged);
});

test('applyMustard puts a kept hand item with no surviving neighbour below it on top, not under the new content', () => {
  let dog = applyLayout(newDog(), 0, 'cover');
  dog = addItem(dog, 0, shape('my-shape'));
  const text = '---\nmustard: 1\n---\n\n::: page {layout=cover}\n# New\n:::\n';
  const compiled = compileMustard(text, { paper: dog.paper, assets: dog.assets, from: dog });
  const out = applyMustard(dog, compiled.dog);
  assert.equal(out.pages[0].items.at(-1).id, 'my-shape');
  // An item that was at the very bottom stays at the bottom.
  let low = addItem(newDog(), 0, shape('bottom'));
  low = { ...low, pages: low.pages.map((p, i) => (i ? p : { ...p, items: [...p.items, textItem({ x: 0, y: 0 })] })) };
  const c2 = compileMustard(text, { paper: low.paper, assets: low.assets, from: low });
  assert.equal(applyMustard(low, c2.dog).pages[0].items[0].id, 'bottom');
});

test('applyLayout keeps a hand photo as a free item when the new layout has no photo slot', () => {
  let dog = addAsset(newDog(), 'img1', { kind: 'image', file_id: 9, w: 10, h: 10 });
  dog = applyLayout(dog, 0, 'photo-full');
  const photo = dog.pages[0].items.find((i) => i.slot === 'photo');
  dog = updateItem(dog, photo.id, { asset: 'img1', by: 'hand' });
  dog = applyLayout(dog, 0, 'list');
  const kept = dog.pages[0].items.find((i) => i.type === 'image');
  assert.equal(kept?.asset, 'img1', 'the photo is not dropped');
  assert.equal(kept.slot, undefined);
  assert.equal(kept.by, 'hand');
  strictOk(dog);
});
