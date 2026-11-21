// Boots the zine editor on Template/zine/editor.php: reads the JSON config and, until Task 11's app lands, shows a
// loading line in the app root.
import { readConfig } from './config.js';

const root = document.getElementById('hotdogpress-app');
const block = document.getElementById('hotdogpress-config');

if (root && block) {
  const config = readConfig(block.textContent ?? '');
  const note = document.createElement('p');
  note.className = 'hotdogpress-loading';
  note.textContent = config.strings.loading;
  root.replaceChildren(note);
  root.dataset.ready = 'true';
}
