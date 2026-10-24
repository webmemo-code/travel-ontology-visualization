// Where an abstract entity (a topic, a company) shows up on the map.
//
// A plain average of its articles' places lands every topic on the Alps,
// because most articles are Swiss. What says something is where a topic is
// over-represented against the blog as a whole: Safari in Botswana, Masseria in
// Italy. Topics that are written about everywhere (Restaurant, Review) have no
// such place, and their low concentration says so.
import { ancestorOfType, placeTree } from './model';
import type { Graph, GraphNode, GraphPost } from './types';

export interface Hotspot {
  country: string;
  /** Share of the entity's extra articles that fall in this country, 0..1. */
  share: number;
  /** How over-represented the entity is here: 2 = twice the blog's usual share. */
  lift: number;
}

export interface Footprint {
  /** Share of the entity's articles above what the blog's baseline predicts, 0..1. */
  concentration: number;
  /** Over-represented countries, strongest first. */
  hotspots: Hotspot[];
}

/** Fewer articles than this give a footprint that is mostly noise. */
export const MIN_POSTS = 5;

/** Each article's country: the Country above its most specific place, else null. */
export function postCountries(graph: Graph, posts: GraphPost[]): Map<GraphPost, string> {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const tree = placeTree(graph);
  const out = new Map<GraphPost, string>();
  for (const p of posts) {
    const places = p.entities
      .map((k) => nodes.get(k))
      .filter((n): n is GraphNode => n?.class === 'places')
      .sort((a, b) => b.depth - a.depth);
    for (const n of places) {
      const c = ancestorOfType(tree, nodes, n.key, 'Country');
      if (c) {
        out.set(p, c);
        break;
      }
    }
  }
  return out;
}

/** Footprints of every topic and organization with at least MIN_POSTS placed articles. */
export function footprints(graph: Graph, posts: GraphPost[]): Map<string, Footprint> {
  const country = postCountries(graph, posts);
  const base = new Map<string, number>();
  for (const c of country.values()) base.set(c, (base.get(c) ?? 0) + 1);
  const total = country.size;

  const out = new Map<string, Footprint>();
  for (const n of graph.nodes) {
    if (n.class !== 'topics' && n.class !== 'organizations') continue;
    const count = new Map<string, number>();
    let m = 0;
    for (const p of posts) {
      const c = country.get(p);
      if (!c || !p.entities.includes(n.key)) continue;
      count.set(c, (count.get(c) ?? 0) + 1);
      m++;
    }
    if (m < MIN_POSTS) continue;
    const extra = [...count].map(([c, k]) => ({ c, k, excess: k - (m * base.get(c)!) / total })).filter((x) => x.excess > 0);
    const sum = extra.reduce((a, x) => a + x.excess, 0);
    out.set(n.key, {
      concentration: sum / m,
      hotspots: extra
        .sort((a, b) => b.excess - a.excess || b.k - a.k)
        .map((x) => ({ country: x.c, share: x.excess / sum, lift: x.k / m / (base.get(x.c)! / total) })),
    });
  }
  return out;
}

/** Lift of every country for one entity, for the lens; countries without its articles are absent. */
export function liftByCountry(fp: Footprint | undefined): Map<string, number> {
  return new Map(fp?.hotspots.map((h) => [h.country, h.lift]) ?? []);
}
