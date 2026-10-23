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
}
