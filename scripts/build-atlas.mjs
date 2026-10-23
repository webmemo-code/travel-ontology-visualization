// Pack every article thumbnail into one small texture so the dome loads in a
// single request. Reads .cache/thumbs/{site}/ (scripts/fetch_thumbs.py) and
// writes public/atlas/articles.jpg plus an index the viewer maps tiles with.
// Cells are 64 px on purpose: tiles are small on screen, and a soft blur when
// zooming in is part of the look.
//
//   node scripts/build-atlas.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CELL = 64;
const graph = JSON.parse(await fs.readFile(path.join(ROOT, 'public', 'graph.json'), 'utf8'));

const entries = [];
for (const site of ['travelmemo', 'reisememo']) {
  const dir = path.join(ROOT, '.cache', 'thumbs', site);
  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    console.warn(`no manifest for ${site}; run scripts/fetch_thumbs.py --site ${site}`);
  }
  for (const p of graph.posts.filter((p) => p.site === site)) {
    const m = manifest[String(p.id)];
    if (m) entries.push({ key: `post:${site}:${p.id}`, file: path.join(dir, m.file), src: m.src });
  }
}

// Cell 0 stays white: tiles without a photo sample it, so their vertex colour shows unchanged.
const cols = Math.ceil(Math.sqrt(entries.length + 1));
const size = cols * CELL;
const composites = [{ input: await sharp({ create: { width: CELL, height: CELL, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 0, top: 0 }];
const index = {};
const src = {};
let i = 1;
for (const e of entries) {
  try {
    const input = await sharp(e.file).resize(CELL, CELL, { fit: 'cover' }).toBuffer();
    composites.push({ input, left: (i % cols) * CELL, top: Math.floor(i / cols) * CELL });
    index[e.key] = i++;
    src[e.key] = e.src;
  } catch (err) {
    console.warn(`skip ${e.key}: ${err.message}`);
  }
}

await fs.mkdir(path.join(ROOT, 'public', 'atlas'), { recursive: true });
await sharp({ create: { width: size, height: size, channels: 3, background: '#000000' } })
  .composite(composites)
  .jpeg({ quality: 72, mozjpeg: true })
  .toFile(path.join(ROOT, 'public', 'atlas', 'articles.jpg'));
await fs.writeFile(path.join(ROOT, 'public', 'atlas', 'articles.json'), JSON.stringify({ cell: CELL, cols, size, index, src }));
const kb = Math.round((await fs.stat(path.join(ROOT, 'public', 'atlas', 'articles.jpg'))).size / 1024);
console.log(`${i - 1} thumbnails, ${size}x${size}px, ${kb} KB`);
