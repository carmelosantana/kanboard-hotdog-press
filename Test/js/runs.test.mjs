// A text item's runs as editable text and back: list items get one bullet run per line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isListItem, joinRuns, splitRuns } from '../../Assets/js/core/runs.js';

const list = { type: 'text', slot: 'list', runs: [{ text: '• a' }, { text: '• b' }] };

test('isListItem: the list slot, or runs that all start with the bullet', () => {
  assert.equal(isListItem(list), true);
  assert.equal(isListItem({ runs: [{ text: '• a' }, { text: '• b' }] }), true);
  assert.equal(isListItem({ slot: 'body', runs: [{ text: 'Hi ' }, { text: '• styled' }] }), false);
  assert.equal(isListItem({ runs: [] }), false);
});

test('joinRuns puts each list run on its own line and joins other runs as spans', () => {
  assert.equal(joinRuns(list), '• a\n• b');
  assert.equal(joinRuns({ runs: [{ text: 'He' }, { text: 'llo' }] }), 'Hello');
  assert.equal(joinRuns({ runs: [{ text: 'Hi ' }, { text: '• styled' }] }), 'Hi • styled');
  assert.equal(joinRuns({ runs: [{ text: '• a\n' }, { text: '• b' }] }), '• a\n• b', 'no doubled break');
});

test('splitRuns gives a list one run per line and anything else one run', () => {
  assert.deepEqual(splitRuns(list, '• a\n• b\n• c'), [{ text: '• a' }, { text: '• b' }, { text: '• c' }]);
  assert.deepEqual(splitRuns(list, '• a\n\n• b'), [{ text: '• a' }, { text: '• b' }], 'blank lines dropped');
  assert.deepEqual(splitRuns({ slot: 'body', runs: [] }, 'x\ny'), [{ text: 'x\ny' }]);
  assert.deepEqual(splitRuns({ slot: 'body', runs: [] }, '• a\n• b'), [{ text: '• a' }, { text: '• b' }], 'typed bullets become a list');
  assert.deepEqual(splitRuns(list, ''), [{ text: '' }]);
  assert.deepEqual(joinRuns({ ...list, runs: splitRuns(list, '• a\n• b') }), '• a\n• b', 'round trip');
});
