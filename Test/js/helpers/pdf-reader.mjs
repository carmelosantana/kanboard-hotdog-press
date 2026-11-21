// The in-test PDF reader: parses just enough of a PDF written by pdf.js to check its structure.
import assert from 'node:assert/strict';

/** Parse just enough PDF to check structure: header, xref, trailer, objects, streams. */
export function readPdf(bytes) {
  assert.ok(bytes instanceof Uint8Array, 'output is a Uint8Array');
  const s = Buffer.from(bytes).toString('latin1'); // one char per byte, so indexes are byte offsets
  assert.ok(s.startsWith('%PDF-1.4\n'), 'header');
  assert.ok(/%%EOF\n?$/.test(s), 'ends with %%EOF');
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref', 'startxref points at xref');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(startxref));
  const count = Number(head[1]);
  let at = startxref + head[0].length;
  const offsets = [];
  for (let i = 0; i < count; i++) {
    const entry = s.slice(at, at + 20);
    assert.match(entry, /^\d{10} \d{5} [nf] \n$/, `xref entry ${i} is 20 bytes`);
    offsets.push({ offset: Number(entry.slice(0, 10)), kind: entry[17] });
    at += 20;
  }
  const trailer = s.slice(at);
  assert.match(trailer, /^trailer\n<< \/Size (\d+) \/Root 1 0 R >>/);
  assert.equal(Number(/\/Size (\d+)/.exec(trailer)[1]), count, 'trailer /Size');
  const objects = new Map();
  offsets.forEach(({ offset, kind }, n) => {
    if (n === 0) { assert.equal(kind, 'f'); return; }
    assert.equal(kind, 'n');
    const prefix = `${n} 0 obj\n`;
    assert.equal(s.slice(offset, offset + prefix.length), prefix, `xref offset of object ${n}`);
    const bodyAt = offset + prefix.length;
    const body = s.slice(bodyAt);
    const streamAt = body.indexOf('>>\nstream\n');
    const obj = {};
    if (streamAt !== -1 && streamAt < body.indexOf('endobj')) {
      // Stream objects: the dict carries /Length; the stream is that many raw bytes, then \nendstream.
      obj.dict = body.slice(0, streamAt + 2);
      const length = Number(/\/Length (\d+)/.exec(obj.dict)[1]);
      const start = bodyAt + streamAt + '>>\nstream\n'.length;
      obj.stream = bytes.subarray(start, start + length);
      assert.equal(s.slice(start + length, start + length + 17), '\nendstream\nendobj', `object ${n} /Length`);
    } else {
      obj.dict = body.slice(0, body.indexOf('endobj'));
    }
    objects.set(n, obj);
  });
  const ref = (dict, key) => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(dict)[1]);
  const catalog = objects.get(ref(trailer, 'Root'));
  assert.match(catalog.dict, /\/Type \/Catalog/);
  const pagesObj = objects.get(ref(catalog.dict, 'Pages'));
  assert.match(pagesObj.dict, /\/Type \/Pages/);
  const kids = [...pagesObj.dict.match(/\/Kids \[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  assert.equal(Number(/\/Count (\d+)/.exec(pagesObj.dict)[1]), kids.length, '/Count');
  const pages = kids.map((k) => {
    const page = objects.get(k).dict;
    assert.match(page, /\/Type \/Page\b/);
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page);
    const xobjects = {};
    for (const m of (/\/XObject << ([^>]*) >>/.exec(page)?.[1] ?? '').matchAll(/\/(\w+) (\d+) 0 R/g)) {
      xobjects[m[1]] = objects.get(Number(m[2]));
    }
    const content = Buffer.from(objects.get(ref(page, 'Contents')).stream).toString('latin1');
    return { w: Number(box[1]), h: Number(box[2]), xobjects, content, placements: placements(content) };
  });
  const images = [...objects.values()].filter((o) => /\/Subtype \/Image/.test(o.dict));
  return { pages, images, text: s };
}

/** Each `q … /Name Do Q` block: the image name and its cm matrices in order. */
function placements(content) {
  return [...content.matchAll(/q\n((?:[-\d. ]+ cm\n)+)\/(\w+) Do\nQ/g)].map((m) => ({
    name: m[2],
    cms: m[1].trim().split('\n').map((line) => line.split(' ').slice(0, 6).map(Number)),
  }));
}
