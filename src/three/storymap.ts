// The EN ↔ DE view as a flat story map (layout: data/storymap.ts). Each cell
// is split on its diagonal: the top-left triangle is the English article,
// the bottom-right the German one. A missing half is an amber outline: a
// story one blog tells and the other does not yet. True borders and coasts lie
// underneath as gold wireframe; the two logos say which half is which.
import * as THREE from 'three';
import type { Geometry, MultiLineString } from 'geojson';
import { CELL, MAP_H, project, type StoryCell } from '../data/storymap';
import { postKey } from '../data/globe';
import { logoTexture } from './logo';

export const EN_COLOR = '#26C6DA';
export const DE_COLOR = '#7E57C2';
const GAP_COLOR = '#FFB300';
const Z_CELLS = 0.05;

export interface StoryMap {
  group: THREE.Group;
  mesh: THREE.Mesh;
  /** Post key behind a triangle of `mesh`, or null for none. */
  postAt: (faceIndex: number) => string | null;
  /** Centre of a post's cell. */
  cellOf: (postKey: string) => THREE.Vector3 | null;
  setAtlas: (features: { geometry: Geometry }[], coast: MultiLineString) => void;
  /** Light the given posts' halves; null restores the plain map. */
  paint: (lit: Set<string> | null) => void;
}

export function buildStoryMap(cells: StoryCell[]): StoryMap {
  const group = new THREE.Group();
  const s = CELL * 0.92; // a hairline gap between cells
  const pos: number[] = [];
  const faces: (string | null)[] = [];
  const gaps: number[] = [];
  const centre = new Map<string, THREE.Vector3>();
  for (const c of cells) {
    const x0 = c.x - s / 2;
    const y0 = c.y + s / 2;
    const tl = [x0, y0, Z_CELLS, x0 + s, y0, Z_CELLS, x0, y0 - s, Z_CELLS];
    const br = [x0 + s, y0, Z_CELLS, x0 + s, y0 - s, Z_CELLS, x0, y0 - s, Z_CELLS];
    for (const [post, tri] of [
      [c.en, tl],
      [c.de, br],
    ] as const) {
      if (post) {
        pos.push(...tri);
        faces.push(postKey(post));
        centre.set(postKey(post), new THREE.Vector3(c.x, c.y, Z_CELLS));
      } else {
        // An outline for the missing half.
        gaps.push(tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[3], tri[4], tri[5], tri[6], tri[7], tri[8], tri[6], tri[7], tri[8], tri[0], tri[1], tri[2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const colors = new Float32Array(pos.length);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const outline = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gaps, 3)),
    new THREE.LineBasicMaterial({ color: GAP_COLOR, transparent: true, opacity: 0.75 }),
  );
  group.add(mesh, outline);

  const en = new THREE.Color(EN_COLOR);
  const de = new THREE.Color(DE_COLOR);
  const paint = (lit: Set<string> | null) => {
    faces.forEach((key, f) => {
      const base = key?.includes(':travelmemo:') ? en : de;
      // Lit stories keep their plain blog colour and the rest dims, so the split still reads; gold or brighter tones bloom into a blob.
      const c = lit ? (key && lit.has(key) ? base : base.clone().multiplyScalar(0.18)) : base;
      for (let v = 0; v < 3; v++) colors.set([c.r, c.g, c.b], (f * 3 + v) * 3);
    });
    g.attributes.color.needsUpdate = true;
  };
  paint(null);

  // The two logos above the map: English on the left, German on the right,
  // each next to a sample of its half of a cell.
  const logo = (site: string, color: string, side: -1 | 1) => {
    const mat = new THREE.MeshBasicMaterial({ transparent: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(15, 5), mat);
    plane.position.set(side * 10.5, MAP_H / 2 + 4.5, 0);
    group.add(plane);
    void logoTexture(site, color).then((tex) => {
      mat.map = tex;
      mat.needsUpdate = true;
    });
    const k = 2.4;
    const x = 0; // the two halves meet between the logos as one split cell
    const y = MAP_H / 2 + 4.5;
    const tri =
      side < 0
        ? [x - k / 2, y + k / 2, 0, x + k / 2, y + k / 2, 0, x - k / 2, y - k / 2, 0]
        : [x + k / 2, y + k / 2, 0, x + k / 2, y - k / 2, 0, x - k / 2, y - k / 2, 0];
    group.add(
      new THREE.Mesh(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(tri, 3)),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
      ),
    );
  };
  logo('travelmemo', EN_COLOR, -1);
  logo('reisememo', DE_COLOR, 1);

  const lines = (rings: number[][][], color: string, opacity: number, z: number) => {
    const pts: number[] = [];
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++) {
        const [lon0, lat0] = ring[i - 1];
        const [lon1, lat1] = ring[i];
        if (Math.abs(lon1 - lon0) > 90) continue; // antimeridian jump, not a line
        const [x0, y0] = project(lat0, lon0);
        const [x1, y1] = project(lat1, lon1);
        pts.push(x0, y0, z, x1, y1, z);
      }
    group.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      ),
    );
  };
  const setAtlas = (features: { geometry: Geometry }[], coast: MultiLineString) => {
    const rings: number[][][] = [];
    for (const f of features) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) rings.push(...poly);
    }
    lines(rings, '#9c7f35', 0.35, -0.05);
    lines(coast.coordinates, '#FFD54F', 0.6, -0.04);
  };

  return {
    group,
    mesh,
    postAt: (f) => faces[f] ?? null,
    cellOf: (key) => centre.get(key)?.clone() ?? null,
    setAtlas,
    paint,
  };
}
