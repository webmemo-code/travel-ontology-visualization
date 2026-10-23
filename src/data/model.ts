// Pure data helpers: per-site stats, layout positions, co-occurrence.
import type { Graph, GraphNode, GraphPost, Perf, SiteMode, SiteStats, Status } from './types';

export const PERF_RANK: Record<Perf, number> = { top10: 4, top25: 3, active: 2, seen: 1, none: 0 };
const STATUS_RANK: Record<Status, number> = { hub: 3, covered: 2, thin: 1, orphan: 0 };

export const CLASS_COLORS: Record<string, string> = {
  places: '#29B6F6',
  topics: '#FF8F00',
  organizations: '#66BB6A',
  trips: '#BA68C8',
  people: '#FFD54F',
};

export const CLASS_NAMES: Record<string, string> = {
  places: 'Places',
  topics: 'Topics',
  organizations: 'Organizations',
  trips: 'Trips',
  people: 'People',
};

/** Stats for the active site mode; "both" sums posts and keeps the better tier. */
export function statsFor(node: GraphNode, mode: SiteMode): SiteStats | null {
  if (mode !== 'both') return node.sites[mode] ?? null;
  const all = Object.values(node.sites).filter(Boolean) as SiteStats[];
  if (!all.length) return null;
  return all.reduce((a, b) => ({
    status: STATUS_RANK[a.status] >= STATUS_RANK[b.status] ? a.status : b.status,
    posts: a.posts + b.posts,
    subtree: a.subtree + b.subtree,
    perf: PERF_RANK[a.perf] >= PERF_RANK[b.perf] ? a.perf : b.perf,
  }));
}

export function labelFor(node: GraphNode, mode: SiteMode): string {
  const label = mode === 'reisememo' ? node.label.de : node.label.en;
  // The two of us go by first name on the map: "Katja", "Walter".
  return node.class === 'people' ? label.split(' ')[0] : label;
}

export function postsFor(graph: Graph, mode: SiteMode): GraphPost[] {
  return mode === 'both' ? graph.posts : graph.posts.filter((p) => p.site === mode);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Entities that share posts with `key`, strongest first. */
export function cooccurring(posts: GraphPost[], key: string, limit = 10): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    if (!p.entities.includes(key)) continue;
    for (const e of p.entities) if (e !== key) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

export function slugTitle(url: string): string {
  const slug = url.replace(/\/+$/, '').split('/').pop() ?? url;
  const s = decodeURIComponent(slug).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface PlaceTree {
  parent: Map<string, string>;
  children: Map<string, string[]>;
}

/** Place hierarchy from parent edges; the first parent wins, so it is a tree. */
export function placeTree(graph: Graph): PlaceTree {
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.rel !== 'parent' || parent.has(e.from)) continue;
    parent.set(e.from, e.to);
    children.set(e.to, [...(children.get(e.to) ?? []), e.from]);
  }
  return { parent, children };
}

/** The entity and everything below it. */
export function descendants(tree: PlaceTree, key: string): Set<string> {
  const out = new Set([key]);
  const stack = [key];
  while (stack.length) {
    for (const c of tree.children.get(stack.pop()!) ?? []) {
      if (out.has(c)) continue;
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}

/** Nearest ancestor-or-self of the given type, e.g. the Country above a city. */
export function ancestorOfType(tree: PlaceTree, nodes: Map<string, GraphNode>, key: string, type: string): string | null {
  const seen = new Set<string>();
  for (let k: string | undefined = key; k && !seen.has(k); k = tree.parent.get(k)) {
    seen.add(k);
    if (nodes.get(k)?.type === type) return k;
  }
  return null;
}

export function rootOf(tree: PlaceTree, key: string): string {
  const seen = new Set<string>();
  let k = key;
  while (tree.parent.has(k) && !seen.has(k)) {
    seen.add(k);
    k = tree.parent.get(k)!;
  }
  return k;
}
