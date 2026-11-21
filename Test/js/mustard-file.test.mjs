// .mustard.md files in the browser: the zine as a Mustard download named from its title, and a picked file read
// back as text for the Mustard panel (refused unread when it is over the Mustard size limit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mustardFile, readMustardFile } from '../../Assets/js/app/mustard-file.js';
import { exportMustard, compileMustard, MAX_MUSTARD_BYTES } from '../../Assets/js/core/mustard.js';
import { newDog } from '../../Assets/js/core/dog.js';

const EXAMPLE = readFileSync(new URL('../fixtures/mustard/example.mustard.md', import.meta.url), 'utf8');

test('mustardFile: the zine as Mustard text, named <title slug>.mustard.md', () => {
  const dog = compileMustard(EXAMPLE, { paper: 'letter' }).dog;
  const file = mustardFile(dog);
  assert.equal(file.name, 'plant-medicine.mustard.md');
  assert.equal(file.type, 'text/markdown');
  assert.equal(new TextDecoder().decode(file.data), exportMustard(dog).text);
  assert.equal(mustardFile(newDog({ title: '¡¿?!' })).name, 'zine.mustard.md');
});

test('readMustardFile: the text of a picked file', async () => {
  assert.deepEqual(await readMustardFile(new Blob([EXAMPLE], { type: 'text/markdown' })), { text: EXAMPLE });
});

test('readMustardFile: a file over the size limit is refused without reading it', async () => {
  const big = { size: MAX_MUSTARD_BYTES + 1, text: async () => assert.fail('read a file over the limit') };
  assert.deepEqual(await readMustardFile(big), {
    error: { path: '', message: `must be at most ${MAX_MUSTARD_BYTES} bytes of Mustard` },
  });
});
