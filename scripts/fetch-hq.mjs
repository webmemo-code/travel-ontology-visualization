// Fetch each organization's headquarters (Wikidata P159) and its coordinates,
// so the globe can hang a company over its home city. The coordinates come
// from the P159 statement's own P625 qualifier when present, else from the
// headquarters item's P625. Writes public/identity/hq.json.
//
//   node scripts/fetch-hq.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'TravelOntologyVisualization/1.0 (https://github.com/webmemo-code/travel-ontology-visualization)';

async function entity(q) {
  const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${q}`);
  return Object.values((await r.json()).entities)[0];
}

/** Current statements only: preferred rank first, never one with an end date. */
const current = (claims, prop) => {
  const list = (claims?.[prop] ?? []).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582);
  return [...list.filter((c) => c.rank === 'preferred'), ...list.filter((c) => c.rank !== 'preferred')];
};

const graph = JSON.parse(await fs.readFile(path.join(ROOT, 'public', 'graph.json'), 'utf8'));
const out = {};
for (const n of graph.nodes.filter((n) => n.class === 'organizations' && n.wikidata)) {
  const hq = current((await entity(n.wikidata)).claims, 'P159')[0];
  if (!hq) {
    console.log(`- ${n.key}: no P159`);
    continue;
  }
  const place = hq.mainsnak.datavalue?.value?.id;
  let coord = hq.qualifiers?.P625?.[0]?.datavalue?.value;
  let city = place;
  if (place) {
    const e = await entity(place);
    city = e.labels?.en?.value ?? place;
    coord ??= current(e.claims, 'P625')[0]?.mainsnak?.datavalue?.value;
  }
  if (!coord) {
    console.log(`- ${n.key}: ${city} has no coordinates`);
    continue;
  }
  out[n.key] = { city, lat: +coord.latitude.toFixed(3), lon: +coord.longitude.toFixed(3) };
  console.log(`+ ${n.key}: ${city}`);
}
await fs.writeFile(path.join(ROOT, 'public', 'identity', 'hq.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${Object.keys(out).length} headquarters`);
