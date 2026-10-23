// Dome layout: the world seen from the inside of a sphere.
//
// Articles are tiles on the skin; places hang on inner shells, continents
// nearest the viewer and individual sights nearest the skin. Directions are the
// real globe, only turned so Switzerland, where most articles are, sits straight
// ahead with north up: shapes and orientation stay true everywhere. How much
// room Switzerland gets is decided by the article-sized country patches
// (cartogram below), not by distorting the map.
import type { Graph, GraphPost } from './types';
import { ancestorOfType, placeTree, type Vec3 } from './model';

export const DOME_R = 60;
const SHELLS = [22, 32, 40, 47, 52];
const FOCUS = { lat: 46.8, lon: 8.2 };

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: V): V => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function ecef(lat: number, lon: number): V {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

const F_GEO = ecef(FOCUS.lat, FOCUS.lon);
const EAST = norm(cross([0, 0, 1], F_GEO));
const NORTH = cross(F_GEO, EAST);
// World frame: the focus on the -z side, north up, and east on the side that
// reads correctly from OUTSIDE the globe (a camera on -z looking back at the
// origin sees east on its right). From inside, the map is mirrored, as on any
// real globe you could climb into.
const F_W: V = [0, 0, -1];
const U_W: V = [0, 1, 0];
const R_W: V = cross(U_W, F_W);

/** Unit direction in world space for a coordinate: the globe rotated so the focus is ahead, north up. */
export function domeDirection(lat: number, lon: number): V {
  const p = ecef(lat, lon);
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(F_GEO, p))));
  const t = add(p, scale(F_GEO, -dot(F_GEO, p)));
  const phi = Math.atan2(dot(t, EAST), dot(t, NORTH));
  const tangent = add(scale(U_W, Math.cos(phi)), scale(R_W, Math.sin(phi)));
  return norm(add(scale(F_W, Math.cos(theta)), scale(tangent, Math.sin(theta))));
}

function ring(count: number, radius: number, elevationDeg: number, offset = 0): V[] {
  const el = (elevationDeg * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => {
    const a = offset + (2 * Math.PI * i) / count;
    return [Math.cos(el) * Math.sin(a) * radius, Math.sin(el) * radius, -Math.cos(el) * Math.cos(a) * radius];
  });
}

const toVec = (v: V): Vec3 => ({ x: v[0], y: v[1], z: v[2] });

/** Entity positions inside the dome. */
export function domeLayout(graph: Graph): Map<string, Vec3> {
  const pos = new Map<string, Vec3>();
  const places = graph.nodes.filter((n) => n.class === 'places');
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.rel !== 'parent' || parent.has(e.from)) continue;
    parent.set(e.from, e.to);
    children.set(e.to, [...(children.get(e.to) ?? []), e.from]);
  }

  const dir = new Map<string, V>();
  for (const n of places) if (n.geo) dir.set(n.key, domeDirection(n.geo.lat, n.geo.lon));
  // No coordinates: aim at the middle of what it contains, else at its parent.
  const fromChildren = (k: string): V | null => {
    const kids = (children.get(k) ?? []).map((c) => dir.get(c) ?? fromChildren(c)).filter(Boolean) as V[];
    return kids.length ? norm(kids.reduce(add)) : null;
  };
  for (const n of places) {
    if (dir.has(n.key)) continue;
    let d = fromChildren(n.key);
    for (let p = parent.get(n.key); !d && p; p = parent.get(p)) d = dir.get(p) ?? null;
    dir.set(n.key, d ?? [0, -1, 0]);
  }
  for (const n of places) {
    const r = SHELLS[Math.min(n.depth, SHELLS.length - 1)];
    pos.set(n.key, toVec(scale(dir.get(n.key)!, r)));
  }

  // Topics are the sky, companies the floor, authors at the zenith.
  const byClass = (c: string) => graph.nodes.filter((n) => n.class === c).sort((a, b) => a.key.localeCompare(b.key));
  const topics = byClass('topics');
  ring(topics.length, 40, 52).forEach((v, i) => pos.set(topics[i].key, toVec(v)));
  const orgs = byClass('organizations');
  ring(orgs.length, 40, -50, 0.1).forEach((v, i) => pos.set(orgs[i].key, toVec(v)));
  byClass('people').forEach((n, i) => pos.set(n.key, { x: (i - 0.5) * 9, y: 44, z: -6 }));

  // A trip floats just inside its first stop.
  for (const n of byClass('trips')) {
    const first = n.route?.[0];
    const p = first ? pos.get(first) : undefined;
    pos.set(n.key, p ? { x: p.x * 0.85, y: p.y * 0.85 + 2, z: p.z * 0.85 } : { x: 0, y: -30, z: 0 });
  }
  graph.nodes.forEach((n) => pos.has(n.key) || pos.set(n.key, { x: 0, y: -35, z: 0 }));
  return pos;
}

export const postKey = (p: GraphPost) => `post:${p.site}:${p.id}`;

/**
 * Where each article wants to sit: under its most specific place, else under
 * its first topic (topics are the sky), else the nadir.
 */
export function articleDirection(post: GraphPost, graph: Graph, pos: Map<string, Vec3>): V {
  const depth = new Map(graph.nodes.map((n) => [n.key, n]));
  const placed = post.entities
    .map((k) => depth.get(k))
    .filter((n) => n && n.class === 'places')
    .sort((a, b) => b!.depth - a!.depth);
  const anchor = placed[0]?.key ?? post.entities.find((k) => depth.get(k)?.class === 'topics');
  const p = anchor ? pos.get(anchor) : undefined;
  return p ? norm([p.x, p.y, p.z]) : [0, -1, 0];
}

/**
 * Greedy tile assignment: each article takes the free face nearest to where it
 * wants to be. Strong articles go first so they hold the exact spot and
 * crowded places grow outward as a patch.
 */
export function assignTiles(wants: V[], order: number[], centers: V[]): number[] {
  const taken = new Uint8Array(centers.length);
  const out = new Array<number>(wants.length).fill(-1);
  for (const i of order) {
    let best = -1;
    let bestDot = -2;
    for (let f = 0; f < centers.length; f++) {
      if (taken[f]) continue;
      const d = dot(wants[i], centers[f]);
      if (d > bestDot) {
        bestDot = d;
        best = f;
      }
    }
    if (best < 0) break;
    taken[best] = 1;
    out[i] = best;
  }
  return out;
}

/**
 * Cartogram assignment: every country gets a patch of faces sized by its
 * article count, grown around the country's real direction. Countries nearest the
 * focus claim first, so Switzerland's patch fills the middle and its
 * neighbours settle on its rim in their true direction. Inside a patch each
 * article still takes the face nearest its own place, so Valais stays
 * south-west of Zurich. Articles without a country fall back to the plain
 * greedy placement in what is left.
 */
export function cartogram(
  graph: Graph,
  pos: Map<string, Vec3>,
  centers: V[],
  neighbours: number[][],
): { tile: number[]; faceRegion: (string | null)[] } {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const tree = placeTree(graph);
  const posts = graph.posts;
  const wants = posts.map((p) => articleDirection(p, graph, pos));
  const rank = { top10: 0, top25: 1, active: 2, seen: 3, none: 4 };

  const region = posts.map((p) => {
    const places = p.entities.map((k) => nodes.get(k)).filter((n) => n?.class === 'places').sort((a, b) => b!.depth - a!.depth);
    for (const n of places) {
      const c = ancestorOfType(tree, nodes, n!.key, 'Country');
      if (c) return c;
    }
    return null;
  });
  const groups = new Map<string, number[]>();
  region.forEach((r, i) => {
    if (r) groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  const seedOf = (k: string): V => {
    const p = pos.get(k)!;
    return norm([p.x, p.y, p.z]);
  };
  const order = [...groups.keys()].sort((a, b) => dot(seedOf(b), F_W) - dot(seedOf(a), F_W));
  const taken = new Uint8Array(centers.length);
  const tile = new Array<number>(posts.length).fill(-1);
  const faceRegion = new Array<string | null>(centers.length).fill(null);
  const byRank = (a: number, b: number) => rank[posts[a].perf] - rank[posts[b].perf] || posts[a].id - posts[b].id;

  for (const r of order) {
    const members = groups.get(r)!.sort(byRank);
    const seed = seedOf(r);
    const patch = growPatch(members.length, seed, centers, neighbours, taken);
    patch.forEach((f) => (faceRegion[f] = r));
    const got = assignTiles(members.map((i) => wants[i]), members.map((_, j) => j), patch.map((f) => centers[f]));
    got.forEach((j, m) => (tile[members[m]] = j < 0 ? -1 : patch[j]));
  }

  const rest = posts.map((_, i) => i).filter((i) => region[i] === null).sort(byRank);
  const free: number[] = [];
  for (let f = 0; f < centers.length; f++) if (!taken[f]) free.push(f);
  const got = assignTiles(rest.map((i) => wants[i]), rest.map((_, j) => j), free.map((f) => centers[f]));
  got.forEach((j, m) => (tile[rest[m]] = j < 0 ? -1 : free[j]));
  return { tile, faceRegion };
}

/**
 * Grow a compact patch of `size` free faces: start at the free face nearest the
 * seed and keep adding the frontier face nearest the seed. Taking the nearest
 * free faces outright gives a thin crescent hugging whoever claimed the middle;
 * growing through neighbours gives a blob that also reaches outward. When the
 * frontier runs dry it restarts at the next nearest free face.
 */
function growPatch(size: number, seed: V, centers: V[], neighbours: number[][], taken: Uint8Array): number[] {
  const patch: number[] = [];
  const frontier = new Set<number>();
  const claim = (f: number) => {
    taken[f] = 1;
    patch.push(f);
    frontier.delete(f);
    for (const n of neighbours[f]) if (!taken[n]) frontier.add(n);
  };
  while (patch.length < size) {
    let best = -1;
    let bestDot = -2;
    const pool = frontier.size ? frontier : centers.keys();
    for (const f of pool) {
      if (taken[f]) continue;
      const d = dot(centers[f], seed);
      if (d > bestDot) {
        bestDot = d;
        best = f;
      }
    }
    if (best < 0) break;
    claim(best);
  }
  return patch;
}

/**
 * Re-aim every place at the middle of its own articles, so a box hangs over
 * the patch it owns instead of over its raw geographic spot, which the cartogram
 * has since moved. Only tiles inside the place's own country patch count: a
 * Dubai mention filed under a Swiss flight article must not pull the UAE into
 * Switzerland. Places with no such tiles keep their geographic direction.
 */
export function placesOverTiles(
  graph: Graph,
  pos: Map<string, Vec3>,
  tileOf: (postIndex: number) => { center: V; region: string | null } | null,
): Map<string, Vec3> {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const tree = placeTree(graph);
  const country = new Map(graph.nodes.map((n) => [n.key, ancestorOfType(tree, nodes, n.key, 'Country')]));
  const sums = new Map<string, V>();
  graph.posts.forEach((p, i) => {
    const t = tileOf(i);
    if (!t) return;
    const hit = new Set<string>();
    for (const k of p.entities) for (let a: string | undefined = k; a && !hit.has(a); a = tree.parent.get(a)) hit.add(a);
    for (const k of hit) {
      const home = country.get(k);
      if (home && home !== t.region) continue;
      sums.set(k, add(sums.get(k) ?? [0, 0, 0], norm(t.center)));
    }
  });
  const out = new Map(pos);
  for (const n of graph.nodes) {
    const s = sums.get(n.key);
    if (n.class !== 'places' || !s) continue;
    const r = SHELLS[Math.min(n.depth, SHELLS.length - 1)];
    out.set(n.key, toVec(scale(norm(s), r)));
  }
  for (const n of graph.nodes) {
    const first = n.route?.[0];
    const p = first ? out.get(first) : undefined;
    if (p) out.set(n.key, { x: p.x * 0.85, y: p.y * 0.85 + 2, z: p.z * 0.85 });
  }
  return out;
}
