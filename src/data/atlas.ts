// True country borders (Natural Earth via world-atlas, public domain), used as
// a faint ghost layer under the cartogram so the distortion is visible.
import { feature } from 'topojson-client';
import { geoArea } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import atlasUrl from 'world-atlas/countries-50m.json?url';
import type { Graph } from './types';

// Ontology label -> Natural Earth name where they differ. England and Scotland
// are not separate countries in the atlas, so they light up the UK.
const ALIASES: Record<string, string> = {
  'places/czech-republic': 'Czechia',
  'places/united-states': 'United States of America',
  'places/england': 'United Kingdom',
  'places/scotland': 'United Kingdom',
};

export interface Atlas {
  features: Feature<Geometry, { name: string }>[];
  byNode: Map<string, Feature<Geometry, { name: string }>>;
  /** Share of the world's land area, 0..1. */
  landShare: Map<string, number>;
}

export async function loadAtlas(graph: Graph): Promise<Atlas> {
  const topo = await fetch(atlasUrl).then((r) => r.json());
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
  const byName = new Map(fc.features.map((f) => [f.properties.name, f]));
  const total = fc.features.reduce((s, f) => s + geoArea(f), 0);
  const byNode = new Map<string, Feature<Geometry, { name: string }>>();
  const landShare = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.type !== 'Country') continue;
    const f = byName.get(ALIASES[n.key] ?? n.label.en);
    if (!f) {
      console.warn(`atlas: no border for ${n.key}`);
      continue;
    }
    byNode.set(n.key, f);
    landShare.set(n.key, geoArea(f) / total);
  }
  return { features: fc.features, byNode, landShare };
}
