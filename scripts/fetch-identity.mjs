// Fetch flags (Wikidata P41) for countries and logos (P154) for organizations,
// via the Q-number every ontology entity already carries. Files come from
// Wikimedia Commons, which only hosts freely licensed media; licence and
// author go to public/identity/credits.json for the credits panel.
//
//   node scripts/fetch-identity.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'identity');
const UA = 'TravelOntologyVisualization/1.0 (https://github.com/webmemo-code/travel-ontology-visualization)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wikidata's P154 for Relais & Châteaux is the former "Relais Gourmands" mark;
// showing an outdated logo as the brand's face would misidentify it.
const SKIP = new Set(['organizations/relais-chateaux']);
// The two blogs themselves: their own published logos.
const OWN = {
  'organizations/travelmemo': 'https://travelmemo.com/wp-content/uploads/2021/08/travelmemo-logo.png',
  'organizations/reisememo': 'https://reisememo.ch/wp-content/uploads/2021/03/reisememo-logo.png',
};

async function json(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.ok) return r.json();
    console.warn(`  HTTP ${r.status} ${url} (attempt ${attempt})`);
    await sleep(2000 * attempt);
  }
  throw new Error(`giving up on ${url}`);
}

/** The current value of a property: preferred rank first, never one with an end date. */
function currentFile(claims, prop) {
  const list = (claims[prop] ?? []).filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582);
  const best = list.find((c) => c.rank === 'preferred') ?? list[0];
  return best?.mainsnak?.datavalue?.value ?? null;
}

const strip = (html) => (html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const graph = JSON.parse(await fs.readFile(path.join(ROOT, 'public', 'graph.json'), 'utf8'));
// Swiss cantons: their coat of arms (P94), the icon every Swiss reader knows them by.
const parent = new Map(graph.edges.filter((e) => e.rel === 'parent').map((e) => [e.from, e.to]));
const isCanton = (n) => n.type === 'AdministrativeArea' && parent.get(n.key) === 'places/switzerland';
const kindOf = (n) => (n.type === 'Country' ? 'flag' : isCanton(n) ? 'arms' : 'logo');
const PROP = { flag: 'P41', arms: 'P94', logo: 'P154' };
const targets = graph.nodes
  .filter((n) => OWN[n.key] || (n.wikidata && (n.type === 'Country' || isCanton(n) || n.class === 'organizations')))
  .map((n) => ({ key: n.key, q: n.wikidata, kind: kindOf(n), prop: PROP[kindOf(n)] }));

await fs.mkdir(OUT, { recursive: true });
const credits = {};
let got = 0;
for (const t of targets) {
  if (SKIP.has(t.key)) {
    console.log(`- ${t.key}: skipped (outdated logo on Wikidata)`);
    continue;
  }
  if (OWN[t.key]) {
    const img = await fetch(OWN[t.key], { headers: { 'User-Agent': UA } });
    if (img.ok) {
      const name = `${t.key.replace('/', '-')}.png`;
      await fs.writeFile(path.join(OUT, name), Buffer.from(await img.arrayBuffer()));
      credits[t.key] = { image: `identity/${name}`, kind: 'logo', file: path.basename(OWN[t.key]), license: 'own brand', artist: 'Webmemo', source: OWN[t.key] };
      got++;
      console.log(`+ ${t.key}: own logo`);
    } else console.log(`- ${t.key}: own logo HTTP ${img.status}`);
    continue;
  }
  const entity = (await json(`https://www.wikidata.org/wiki/Special:EntityData/${t.q}.json`)).entities;
  const claims = Object.values(entity)[0].claims ?? {};
  const file = currentFile(claims, t.prop);
  if (!file) {
    console.log(`- ${t.key}: no ${t.prop} on ${t.q}`);
    continue;
  }
  const api =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo' +
    `&iiprop=url|extmetadata&iiurlwidth=256&titles=${encodeURIComponent('File:' + file)}`;
  const page = Object.values((await json(api)).query.pages)[0];
  const info = page.imageinfo?.[0];
  if (!info?.thumburl) {
    console.log(`- ${t.key}: ${file} not on Commons`);
    continue;
  }
  const img = await fetch(info.thumburl, { headers: { 'User-Agent': UA } });
  if (!img.ok) {
    console.log(`- ${t.key}: thumbnail HTTP ${img.status}`);
    continue;
  }
  const name = `${t.key.replace('/', '-')}.png`;
  await fs.writeFile(path.join(OUT, name), Buffer.from(await img.arrayBuffer()));
  const meta = info.extmetadata ?? {};
  credits[t.key] = {
    image: `identity/${name}`,
    kind: t.kind,
    file,
    license: strip(meta.LicenseShortName?.value) || 'see source',
    artist: strip(meta.Artist?.value) || null,
    source: info.descriptionurl,
  };
  got++;
  console.log(`+ ${t.key}: ${file} (${credits[t.key].license})`);
  await sleep(250);
}
await fs.writeFile(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
console.log(`\n${got}/${targets.length} images; credits in public/identity/credits.json`);
