// Scene 1, "the stack": how one ontology becomes everything the sites
// publish. The entity boxes themselves morph into a mini globe on the bottom
// floor (the globe view, scaled down); this module builds the floors above it
// and the beams particles travel along.
//
// Heights and sizes carry data from public/system.json: an output box is as
// tall as the log of how many items it serves, and a reader sphere is as big
// as its (log-scaled, relative) monthly volume. Without that file the scene
// falls back to even sizes.
import * as THREE from 'three';
import type { Feature, Geometry } from 'geojson';
import { withHorizonCull } from './depthFade';
import { buildLand } from './land';
import { logoTexture } from './logo';
import type { Vec3 } from '../data/model';
import type { Graph, SystemNumbers } from '../data/types';

export const CUBE_Y = -16;
export const MINI = 0.2; // the mini globe is the globe view at a fifth of its size
/** The globe view draws land and borders on this fraction of the dome radius. */
export const GHOST_SHELL = 0.965;
const TOWER_Y = 4;
const OUTPUT_Y = 22;
const CONSUMER_Y = 38;

export interface SystemTile {
  key: string;
  title: string;
  at: Vec3;
}

/** The globe layout, shrunk onto the bottom floor. */
export function miniGlobePositions(globe: Map<string, Vec3>): Map<string, Vec3> {
  const pos = new Map<string, Vec3>();
  // Turned half a circle: the big globe faces Switzerland away from this
  // scene's camera, and the mini globe should show Europe, not the Pacific.
  for (const [k, p] of globe) pos.set(k, { x: -p.x * MINI, y: CUBE_Y + p.y * MINI, z: -p.z * MINI });
  return pos;
}

/** Opaque centre fading to clear at the rim, like the Periodic Cube's panes. */
function fadeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const CONSUMER_RADIUS = 22;

/** All orders of `n` items, for the small n of the readers' circle. */
function permutations(n: number): number[][] {
  if (n <= 1) return [[0].slice(0, n)];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/**
 * Even slots on a circle of `radius` for each item, minimising the summed
 * horizontal distance from each item's slot to its targets. Exhaustive over
 * orders and 1-degree rotations: exact, and cheap for a handful of items.
 */
export function placeOnCircle(targets: THREE.Vector3[][], radius: number): { x: number; z: number }[] {
  const n = targets.length;
  let best: { cost: number; order: number[]; turn: number } = { cost: Infinity, order: [], turn: 0 };
  for (const order of permutations(n))
    for (let deg = 0; deg < 360 / n; deg++) {
      const turn = (deg * Math.PI) / 180;
      let cost = 0;
      order.forEach((item, slot) => {
        const a = turn + (slot / n) * Math.PI * 2;
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        for (const t of targets[item]) cost += Math.hypot(t.x - x, t.z - z);
      });
      if (cost < best.cost) best = { cost, order, turn };
    }
  const out: { x: number; z: number }[] = new Array(n);
  best.order.forEach((item, slot) => {
    const a = best.turn + (slot / n) * Math.PI * 2;
    out[item] = { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
  });
  return out;
}

export function buildSystem(graph: Graph, numbers: SystemNumbers | null, globeRadius: number) {
  const group = new THREE.Group();
  const labels: { text: string; pos: Vec3; color: string; px: number; priority: number }[] = [];
  const pickables: THREE.Mesh[] = [];
  // Each beam carries its particles: how many (the volume it stands for) and
  // which share of them are Travelmemo's (the rest Reisememo's).
  const segments: { a: THREE.Vector3; b: THREE.Vector3; share: number; n: number }[] = [];
  const maxPosts = Math.max(...graph.sites.map((x) => x.posts), 1);
  const blogFlow = (i: number) => ({ share: i === 0 ? 1 : 0, n: Math.round(4 + 12 * (graph.sites[i]?.posts ?? 0) / maxPosts) });
  const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
  const fade = fadeTexture();

  const plate = (y: number, r: number, name: string) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.1, r + 0.1, 128),
      new THREE.MeshBasicMaterial({ color: '#29B6F6', transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r, 96),
      new THREE.MeshBasicMaterial({ color: '#1565C0', map: fade, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = y - 0.02;
    group.add(ring, disc);
    labels.push({ text: name, pos: { x: -r * 0.55, y: y + 0.5, z: r * 0.84 }, color: '#81D4FA', px: 11, priority: 3000 });
  };

  const tile = (t: SystemTile, color: string, r: number, h: number, opacity = 0.85) => {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), mat);
    mesh.position.set(t.at.x, t.at.y + h / 2, t.at.z);
    mesh.userData.key = t.key;
    // Rims only: a low threshold would also draw every side facet as a line.
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
    edges.position.copy(mesh.position);
    group.add(mesh, edges);
    pickables.push(mesh);
    labels.push({ text: t.title, pos: { x: t.at.x, y: t.at.y + h + 0.4, z: t.at.z }, color: '#ffffff', px: 12, priority: 4000 });
    return mesh;
  };

  // The source of truth is the globe itself, small: the entity boxes settle
  // inside it, and its continents are drawn once the atlas loads (setCoastlines).
  const r = globeRadius * MINI;
  plate(CUBE_Y - r - 1.5, r + 4, 'SOURCE OF TRUTH');
  plate(TOWER_Y, 22, 'PUBLISHING');
  plate(OUTPUT_Y, 30, 'GENERATED OUTPUTS');
  plate(CONSUMER_Y, 30, 'WHO READS IT');

  const globeTop = new THREE.Vector3(0, CUBE_Y + r, 0);
  labels.push({ text: `Ontology · ${graph.nodes.length} entities in YAML`, pos: { x: r + 9, y: CUBE_Y, z: 0 }, color: '#FFD54F', px: 16, priority: 5000 });

  // Publishing: each blog a box whose VOLUME is its article count, with a
  // square section so all four sides are the same 3:1 face, the shape of a
  // wordmark, and the logo looks the same from every side.
  const towers = graph.sites.map((s, i) => {
    const h = 0.9 * Math.cbrt(Math.max(1, s.posts) / 9);
    const w = 3 * h;
    const x = (i === 0 ? -1 : 1) * (w / 2 + 1);
    const color = i === 0 ? '#26C6DA' : '#7E57C2';
    const plain = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 });
    const face = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.35 });
    // Box faces: +x, -x, +y, -y, +z, -z; the logo on all four sides.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), [face, face, plain, plain, face, face]);
    mesh.position.set(x, TOWER_Y + h / 2, 0);
    mesh.userData.key = `sys:site:${s.key}`;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
    edges.position.copy(mesh.position);
    group.add(mesh, edges);
    pickables.push(mesh);
    labels.push({ text: `${s.name} · ${s.posts}`, pos: { x, y: TOWER_Y + h + 0.4, z: 0 }, color: '#ffffff', px: 12, priority: 4000 });
    void logoTexture(s.key, color).then((tex) => {
      face.map = tex;
      face.emissiveMap = tex;
      face.needsUpdate = true;
    });
    return new THREE.Vector3(x, TOWER_Y + h, 0);
  });
  towers.forEach((t, i) => segments.push({ a: globeTop, b: t.clone().setY(TOWER_Y), ...blogFlow(i) }));

  // Generated outputs, on a circle so the links between them can show:
  // height = log of the items each one serves, radius = how often AI crawlers
  // fetch it (log weight from system.json). Order keeps linked ones near.
  const outputs: [string, string, string][] = [
    ['sys:html', 'HTML pages', 'html'],
    ['sys:photos', 'Photos', 'images'],
    ['sys:okf', 'OKF bundle', 'okf'],
    ['sys:llmstxt', 'llms.txt', 'llms'],
    ['sys:entitymap', 'EntityMap', 'entitymap'],
    ['sys:taxonomy', 'Taxonomies', 'taxonomy'],
    ['sys:jsonld', 'JSON-LD', 'jsonld'],
  ];
  const base = new Map<string, THREE.Vector3>();
  const outTops = outputs.map(([key, title, field], i) => {
    const n = numbers?.outputs[field];
    // Log, offset so the smallest (llms.txt, ~120) still reads as a box and
    // each tenfold step adds the same height: photos stand clearly tallest.
    const h = n ? Math.max(1, 1 + 2.6 * (Math.log10(n) - 1.8)) : 2.4;
    const a = (i / outputs.length) * Math.PI * 2 + Math.PI / 2;
    const at = { x: Math.cos(a) * 20, y: OUTPUT_Y, z: Math.sin(a) * 20 };
    // JSON-LD ships inside the HTML and is never fetched on its own: a thin,
    // faint cylinder. Without system.json every output gets the same radius.
    const fetched = numbers?.retrievals;
    const w = fetched?.[field];
    const r = w !== undefined ? 1.2 + 3.5 * w : fetched ? 0.6 : 2.5;
    tile({ key, title: n ? `${title} · ${n.toLocaleString('en')}` : title, at }, '#FF8F00', r, h, fetched && w === undefined ? 0.45 : 0.85);
    base.set(key, v(at));
    return new THREE.Vector3(at.x, OUTPUT_Y + h, at.z);
  });
  // What points to what: arcs over the floor, flowing from the pointer to its target.
  const links: [string, string][] = [
    ['sys:okf', 'sys:html'],
    ['sys:okf', 'sys:photos'],
    ['sys:llmstxt', 'sys:okf'],
    ['sys:llmstxt', 'sys:html'],
    ['sys:entitymap', 'sys:html'],
    ['sys:jsonld', 'sys:html'],
    ['sys:taxonomy', 'sys:html'],
  ];
  const arcs = links.map(([from, to]) => {
    const a = base.get(from)!.clone().setY(OUTPUT_Y + 0.6);
    const b = base.get(to)!.clone().setY(OUTPUT_Y + 0.6);
    const mid = a.clone().add(b).multiplyScalar(0.5 * 0.55).setY(OUTPUT_Y + 5);
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  });
  for (const arc of arcs)
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arc.getPoints(40)),
        new THREE.LineBasicMaterial({ color: '#FFB74D', transparent: true, opacity: 0.45 }),
      ),
    );
  const linkCount = arcs.length * 6;
  const linkPositions = new Float32Array(linkCount * 3);
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
  group.add(new THREE.Points(lgeo, new THREE.PointsMaterial({ color: '#FFE0B2', size: 0.5, transparent: true, opacity: 0.95 })));
  for (const o of outTops) towers.forEach((t, i) => segments.push({ a: t, b: o.clone().setY(OUTPUT_Y), ...blogFlow(i) }));

  // Who reads it: sphere size = relative monthly volume (log-scaled upstream).
  const consumers: [string, string, string, string[]][] = [
    ['sys:google', 'Google Search', 'google', ['sys:html', 'sys:photos', 'sys:jsonld', 'sys:taxonomy']],
    ['sys:ai-training', 'AI training', 'ai-training', ['sys:html', 'sys:llmstxt', 'sys:okf', 'sys:entitymap']],
    ['sys:ai-search', 'AI search', 'ai-search', ['sys:html', 'sys:jsonld', 'sys:entitymap', 'sys:llmstxt', 'sys:okf']],
    ['sys:assistants', 'AI assistants', 'assistants', ['sys:html', 'sys:entitymap', 'sys:llmstxt', 'sys:okf']],
    ['sys:travelers', 'Travelers', 'travelers', ['sys:html', 'sys:photos', 'sys:taxonomy']],
  ];
  const spheres = new Map<string, THREE.Vector3>();
  // Readers sit on a circle above the outputs. Every order of readers around
  // it, at every turn of the circle, is tried (5! x 360 is nothing), and the
  // one with the shortest total beams down to the outputs each reader reads
  // wins, so a reader hangs over what it reads.
  const slots = placeOnCircle(
    consumers.map(([, , , from]) => from.map((k) => base.get(k)!)),
    CONSUMER_RADIUS,
  );
  consumers.forEach(([key, title, field, from], i) => {
    const w = numbers?.consumers[field] ?? 0.6;
    const size = 1 + 2.6 * w;
    const at = { x: slots[i].x, y: CONSUMER_Y, z: slots[i].z };
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 1),
      new THREE.MeshStandardMaterial({ color: '#66BB6A', emissive: '#66BB6A', emissiveIntensity: 0.7, flatShading: true, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(at.x, at.y + size, at.z);
    mesh.userData.key = key;
    group.add(mesh);
    pickables.push(mesh);
    // Labels sit outward of their sphere, so two spheres in line of sight keep both names.
    labels.push({ text: title, pos: { x: at.x * 1.3, y: at.y + 2 * size + 1.2, z: at.z * 1.3 }, color: '#ffffff', px: 12, priority: 4000 });
    // A reader's beams: particles as many as its monthly volume, split by blog.
    const flow = { share: numbers?.share?.[field] ?? 0.5, n: Math.round(3 + 15 * w) };
    for (const k of from) segments.push({ a: outTops[outputs.findIndex(([key]) => key === k)], b: v(at), ...flow });
    spheres.set(key, mesh.position.clone());
  });
  // Many travelers arrive through a search engine or an AI answer, not
  // directly: green arcs from those readers over to the travelers.
  const referrals = ['sys:google', 'sys:ai-search', 'sys:assistants'].map((from) => {
    const a = spheres.get(from)!;
    const b = spheres.get('sys:travelers')!;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 6 + a.distanceTo(b) * 0.12;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  });
  for (const arc of referrals)
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arc.getPoints(40)),
        new THREE.LineBasicMaterial({ color: '#81C784', transparent: true, opacity: 0.5 }),
      ),
    );
  const refCount = referrals.length * 8;
  const refPositions = new Float32Array(refCount * 3);
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.BufferAttribute(refPositions, 3));
  group.add(new THREE.Points(rgeo, new THREE.PointsMaterial({ color: '#C8E6C9', size: 0.55, transparent: true, opacity: 0.95 })));

  const beamGeo = new THREE.BufferGeometry().setFromPoints(segments.flatMap(({ a, b }) => [a, b]));
  group.add(new THREE.LineSegments(beamGeo, new THREE.LineBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.18 })));

  // Data particles in the blogs' colours. Per beam, Travelmemo's share of them
  // is interleaved evenly with Reisememo's, so a 30/70 beam reads as such.
  const riders: { seg: number; k0: number }[] = [];
  const colors: number[] = [];
  const tm = new THREE.Color('#4DD0E1');
  const rm = new THREE.Color('#B39DDB');
  segments.forEach((sg, seg) => {
    for (let j = 0; j < sg.n; j++) {
      riders.push({ seg, k0: j / sg.n + (seg % 7) * 0.13 });
      const c = Math.floor((j + 1) * sg.share) > Math.floor(j * sg.share) ? tm : rm;
      colors.push(c.r, c.g, c.b);
    }
  });
  const count = riders.length;
  const positions = new Float32Array(count * 3);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pgeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ vertexColors: true, size: 0.6, transparent: true, opacity: 0.95 }));
  group.add(particles);
  const tmp = new THREE.Vector3();
  const animate = (t: number) => {
    riders.forEach(({ seg, k0 }, i) => {
      const { a, b } = segments[seg];
      tmp.lerpVectors(a, b, (t * 0.25 + k0) % 1);
      positions.set([tmp.x, tmp.y, tmp.z], i * 3);
    });
    pgeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < linkCount; i++) {
      arcs[i % arcs.length].getPoint((t * 0.3 + i / linkCount) % 1, tmp);
      linkPositions.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    lgeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < refCount; i++) {
      referrals[i % referrals.length].getPoint((t * 0.25 + i / refCount) % 1, tmp);
      refPositions.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    rgeo.attributes.position.needsUpdate = true;
  };

  /**
   * Borders and coast on the mini globe, in the globe view's colours: the
   * countries we never write about a faint hairline, ours a muted gold, the
   * coast grey-blue. Built around the globe's own origin so the horizon cull
   * (as on the big globe) hides the far side.
   */
  const setCoastlines = (faint: number[], ours: number[], coast: number[]) => {
    const r0 = globeRadius * MINI;
    for (const [src, color, opacity] of [
      [faint, 0x5f6b73, 0.25],
      [ours, 0x9c7f35, 0.6],
      [coast, 0x86a5ad, 0.55],
    ] as const) {
      const pts = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) pts[i] = src[i] * MINI;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      withHorizonCull(mat, r0);
      const lines = new THREE.LineSegments(g, mat);
      lines.position.y = CUBE_Y;
      lines.rotation.y = Math.PI; // same half turn as miniGlobePositions
      group.add(lines);
    }
  };

  /** Land on the mini globe: the globe view's own land layer, scaled down. */
  const setLand = (features: Feature<Geometry>[]) => {
    const land = buildLand(features, globeRadius * GHOST_SHELL * MINI);
    land.position.y = CUBE_Y;
    land.rotation.y = Math.PI;
    group.add(land);
  };

  return { group, labels, pickables, animate, setCoastlines, setLand };
}
