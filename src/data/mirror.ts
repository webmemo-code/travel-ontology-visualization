// Mirror view: Travelmemo (EN) and Reisememo (DE) as two facing walls. Each
// entity has the same slot on both walls, so a bridge between its two boxes is
// a straight horizontal line. A bridge with articles on one side only marks a
// story one blog tells and the other does not.
import type { Vec3 } from './model';
import type { Graph, GraphNode } from './types';

export const WALL_X = 26;
const COLS = 16;
const GAP = 3.1;
const ORDER = ['people', 'trips', 'places', 'topics', 'organizations'];

export type Bridge = 'shared' | 'only-en' | 'only-de' | 'none';

const posts = (n: GraphNode, site: 'travelmemo' | 'reisememo') => n.sites[site]?.posts ?? 0;

export function bridgeKind(n: GraphNode): Bridge {
  const en = posts(n, 'travelmemo');
  const de = posts(n, 'reisememo');
  if (en && de) return 'shared';
  if (en) return 'only-en';
  if (de) return 'only-de';
  return 'none';
}

/** Slot per entity, the same for both walls: class blocks, busiest first. */
export function mirrorSlots(graph: Graph): Map<string, { z: number; y: number }> {
  const nodes = [...graph.nodes].sort(
    (a, b) =>
      ORDER.indexOf(a.class) - ORDER.indexOf(b.class) ||
      posts(b, 'travelmemo') + posts(b, 'reisememo') - posts(a, 'travelmemo') - posts(a, 'reisememo') ||
      a.key.localeCompare(b.key),
  );
  const rows = Math.ceil(nodes.length / COLS);
  const slots = new Map<string, { z: number; y: number }>();
  nodes.forEach((n, i) => {
    slots.set(n.key, {
      z: ((i % COLS) - (COLS - 1) / 2) * GAP,
      y: ((rows - 1) / 2 - Math.floor(i / COLS)) * GAP + 4,
    });
  });
  return slots;
}

export function wallPositions(graph: Graph, side: -1 | 1): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const [k, s] of mirrorSlots(graph)) out.set(k, { x: side * WALL_X, y: s.y, z: s.z });
  return out;
}

export function bridgeCounts(graph: Graph): Record<Bridge, number> {
  const out: Record<Bridge, number> = { shared: 0, 'only-en': 0, 'only-de': 0, none: 0 };
  for (const n of graph.nodes) out[bridgeKind(n)]++;
  return out;
}
