// Shape of public/graph.json ("ontology-cube/graph@1"), a snapshot of the
// ontology. Performance is relative tiers only.

export type Status = 'hub' | 'covered' | 'thin' | 'orphan';
export type Perf = 'top10' | 'top25' | 'active' | 'seen' | 'none';
export type SiteKey = 'travelmemo' | 'reisememo';
export type SiteMode = SiteKey | 'both';

export interface SiteStats {
  status: Status;
  posts: number;
  subtree: number;
  perf: Perf;
}

export interface GraphNode {
  key: string;
  id: string;
  class: string;
  type: string;
  label: { en: string; de: string };
  wikidata: string | null;
  source: string;
  depth: number;
  geo: { lat: number; lon: number } | null;
  route: string[] | null;
  sites: Partial<Record<SiteKey, SiteStats>>;
}

export interface GraphEdge {
  from: string;
  to: string;
  rel: 'parent' | 'itinerary' | 'provider';
}

export interface GraphPost {
  site: SiteKey;
  id: number;
  url: string;
  entities: string[];
  cluster: string;
  perf: Perf;
  /** The translation on the other blog, "{site}:{id}", when there is one. */
  pair?: string;
}

export interface SiteMeta {
  key: SiteKey;
  name: string;
  language: string;
  url: string;
  posts: number;
  entities: number;
}

export interface Graph {
  schema: string;
  sites: SiteMeta[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  posts: GraphPost[];
  /** public/system.json, attached by the app when it loads; absent offline. */
  system?: SystemNumbers | null;
}

/** public/system.json ("ontology-cube/system@1"): output counts, consumer weights 0..1. */
export interface SystemNumbers {
  as_of: string;
  window_days: number;
  outputs: Record<string, number>;
  consumers: Record<string, number>;
  /** Per consumer, `share_site`'s share of its volume, 0..1. */
  share?: Record<string, number>;
  share_site?: string;
}
