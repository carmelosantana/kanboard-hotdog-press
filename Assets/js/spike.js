// Task 1 browser spike. Each step writes "<name>: ok …" or "<name>: fail …" into the page.
import { SPIKE } from './core/version.js';

const root = document.getElementById('hdp-spike');
const report = (step, ok, detail = '') => {
    const li = root.querySelector(`[data-step="${step}"]`);
    li.textContent = `${step}: ${ok ? 'ok' : 'fail'}${detail ? ' ' + detail : ''}`;
    li.dataset.result = ok ? 'ok' : 'fail';
};
const toBlob = (canvas) => new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('null blob'))), 'image/jpeg', 0.9); }
    catch (e) { reject(e); }
});
const draw = async (source) => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    canvas.getContext('2d').drawImage(source, 0, 0, 64, 64);
    const blob = await toBlob(canvas);
    return `${blob.type} ${blob.size}B`;
};
const loadImg = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img load error'));
    img.src = src;
});
const url = root.dataset.image;

report('module', SPIKE === 'core-ok', SPIKE);

try { report('canvas-img', true, await draw(await loadImg(url))); }
catch (e) { report('canvas-img', false, String(e)); }

try { report('canvas-bitmap', true, await draw(await createImageBitmap(await (await fetch(url)).blob()))); }
catch (e) { report('canvas-bitmap', false, String(e)); }

try {
    const blobUrl = URL.createObjectURL(await (await fetch(url)).blob());
    report('canvas-bloburl', true, await draw(await loadImg(blobUrl)));
    URL.revokeObjectURL(blobUrl);
} catch (e) { report('canvas-bloburl', false, String(e)); }

try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['Hot Dog Press spike\n'], { type: 'text/plain' }));
    a.download = 'hotdogpress-spike.txt';
    a.id = 'hdp-spike-download';
    a.textContent = 'Download spike file';
    document.getElementById('hdp-spike-link').append(a);
    report('download', a.href.startsWith('blob:'), a.href);
} catch (e) { report('download', false, String(e)); }
