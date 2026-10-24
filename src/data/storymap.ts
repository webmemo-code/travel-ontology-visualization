// EN ↔ DE story map: one cell per story on a flat world map. A story is an
// article and, when it has one, its translation on the other blog (graph
// post.pair). Cells are grouped into country patches sized by the country's
// stories and grown around its true position, like the globe's cartogram, so
// Switzerland's hundreds of stories become a large patch in the middle of
// Europe instead of a pile on one point.
import { postCountries } from './footprint';
import type { Graph, GraphPost } from './types';

/** Map size in world units, and the cell edge. */
export const MAP_W = 150;
export const MAP_H = 75;
export const CELL = 0.82;
const COLS = Math.floor(MAP_W / CELL);
const ROWS = Math.floor(MAP_H / CELL);
const FOCUS = { lat: 46.8, lon: 8.2 };
/** Stories with no tagged place gather where no country is: the far south. */
const NOWHERE = { lat: -62, lon: -20 };

export interface Story {
  en: GraphPost | null;
  de: GraphPost | null;
  country: string | null;
}

export interface StoryCell extends Story {
  x: number;
  y: number;
}

/** Equirectangular: longitude and latitude straight onto the plane, centred on 0/0. */
export function project(lat: number, lon: number): [number, number] {
  return [(lon / 180) * (MAP_W / 2), (lat / 90) * (MAP_H / 2)];
}

/** Every story once: a translated pair is one story, keyed by its English half. */
export function stories(graph: Graph): Story[] {
  const bySite = new Map(graph.posts.map((p) => [`${p.site}:${p.id}`, p]));
  const country = postCountries(graph, graph.posts);
  const out: Story[] = [];
  for (const p of graph.posts) {
    const other = p.pair ? bySite.get(p.pair) : undefined;
    if (other && p.site === 'reisememo') continue; // its English half adds it
    const en = p.site === 'travelmemo' ? p : (other ?? null);
    const de = p.site === 'reisememo' ? p : (other ?? null);
    out.push({ en, de, country: country.get(p) ?? (other ? country.get(other) : undefined) ?? null });
  }
  return out;
}

/**
 * Country patches on a grid: countries nearest the focus claim first, each
 * growing a compact blob from the free cell nearest its true position. Inside
 * a patch, stories on both blogs come first, then English-only, then
 * German-only, so a patch's gaps gather in one corner.
 */
export function layoutStories(graph: Graph, geoOf: (country: string) => { lat: number; lon: number } | null): {
  cells: StoryCell[];
  centres: Map<string, [number, number]>;
} {
  const groups = new Map<string, Story[]>();
  for (const s of stories(graph)) {
    const k = s.country ?? '';
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const target = (k: string): [number, number] => {
    const g = k ? geoOf(k) : NOWHERE;
    return project(g?.lat ?? NOWHERE.lat, g?.lon ?? NOWHERE.lon);
  };
  const [fx, fy] = project(FOCUS.lat, FOCUS.lon);
  const order = [...groups.keys()].sort((a, b) => {
    const [ax, ay] = target(a);
    const [bx, by] = target(b);
    return Math.hypot(ax - fx, ay - fy) - Math.hypot(bx - fx, by - fy);
  });

  const taken = new Uint8Array(COLS * ROWS);
  const at = (i: number): [number, number] => [((i % COLS) + 0.5) * CELL - MAP_W / 2, MAP_H / 2 - (Math.floor(i / COLS) + 0.5) * CELL];
  const rank = (s: Story) => (s.en && s.de ? 0 : s.en ? 1 : 2);
  const cells: StoryCell[] = [];
  const centres = new Map<string, [number, number]>();
  for (const k of order) {
    const members = groups.get(k)!.sort((a, b) => rank(a) - rank(b));
    const [tx, ty] = target(k);
    const d2 = (i: number) => {
      const [x, y] = at(i);
      return (x - tx) ** 2 + (y - ty) ** 2;
    };
    const patch: number[] = [];
    const frontier = new Set<number>();
    while (patch.length < members.length) {
      let best = -1;
      for (const i of frontier.size ? frontier : taken.keys()) if (!taken[i] && (best < 0 || d2(i) < d2(best))) best = i;
      if (best < 0) break;
      taken[best] = 1;
      patch.push(best);
      frontier.delete(best);
      const c = best % COLS;
      for (const n of [best - COLS, best + COLS, c > 0 ? best - 1 : -1, c < COLS - 1 ? best + 1 : -1])
        if (n >= 0 && n < taken.length && !taken[n]) frontier.add(n);
    }
    // Reading order inside the patch: top to bottom, left to right.
    patch.sort((a, b) => a - b);
    let sx = 0;
    let sy = 0;
    patch.forEach((i, j) => {
      const [x, y] = at(i);
      cells.push({ ...members[j], x, y });
      sx += x;
      sy += y;
    });
    if (patch.length) centres.set(k, [sx / patch.length, sy / patch.length]); // '' = no place tagged
  }
  return { cells, centres };
}

export function storyCounts(graph: Graph): { both: number; en: number; de: number } {
  const out = { both: 0, en: 0, de: 0 };
  for (const s of stories(graph)) out[s.en && s.de ? 'both' : s.en ? 'en' : 'de']++;
  return out;
}
