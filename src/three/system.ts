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
import type { Vec3 } from '../data/model';
import type { Graph, SystemNumbers } from '../data/types';

export const CUBE_Y = -16;
const MINI = 0.2; // the mini globe is the globe view at a fifth of its size
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
  for (const [k, p] of globe) pos.set(k, { x: p.x * MINI, y: CUBE_Y + p.y * MINI, z: p.z * MINI });
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

export function buildSystem(graph: Graph, numbers: SystemNumbers | null, globeRadius: number) {
  const group = new THREE.Group();
  const labels: { text: string; pos: Vec3; color: string; px: number; priority: number }[] = [];
  const pickables: THREE.Mesh[] = [];
  const segments: [THREE.Vector3, THREE.Vector3, string][] = [];
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

  const tile = (t: SystemTile, color: string, w: number, h: number, d: number) => {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(t.at.x, t.at.y + h / 2, t.at.z);
    mesh.userData.key = t.key;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
    edges.position.copy(mesh.position);
    group.add(mesh, edges);
    pickables.push(mesh);
    labels.push({ text: t.title, pos: { x: t.at.x, y: t.at.y + h + 0.4, z: t.at.z }, color: '#ffffff', px: 12, priority: 4000 });
    return mesh;
  };

  // The source of truth is the globe itself, small: a faint wire sphere the
  // entity boxes settle into.
  const r = globeRadius * MINI;
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(r, 3)),
    new THREE.LineBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.12 }),
  );
  wire.position.y = CUBE_Y;
  group.add(wire);
  plate(CUBE_Y - r - 1.5, r + 4, 'SOURCE OF TRUTH');
  plate(TOWER_Y, 22, 'PUBLISHING');
  plate(OUTPUT_Y, 42, 'GENERATED OUTPUTS');
  plate(CONSUMER_Y, 36, 'WHO READS IT');

  const globeTop = new THREE.Vector3(0, CUBE_Y + r, 0);
  labels.push({ text: `Ontology · ${graph.nodes.length} entities in YAML`, pos: { x: 0, y: CUBE_Y + r + 2.5, z: 0 }, color: '#FFD54F', px: 16, priority: 5000 });

  // Publishing: each blog a tower as tall as its article count, wearing its logo.
  const logos = new THREE.TextureLoader();
  const towers = graph.sites.map((s, i) => {
    const h = Math.max(2, s.posts / 70);
    const x = (i === 0 ? -1 : 1) * 11;
    const color = i === 0 ? '#26C6DA' : '#7E57C2';
    tile({ key: `sys:site:${s.key}`, title: `${s.name} · ${s.posts}`, at: { x, y: TOWER_Y, z: 0 } }, color, 6, h, 6);
    // The logo is light text on a transparent PNG: give it a dark badge, sized to
    // the logo's own aspect once it has loaded, on each side face near the top.
    const face = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const badge = new THREE.MeshBasicMaterial({ color: '#0b1020', transparent: true, opacity: 0.88, depthWrite: false });
    const planes: THREE.Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), badge);
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), face);
      for (const [m, off, order] of [[back, 3.02, 2], [logo, 3.04, 3]] as const) {
        m.position.set(x + Math.sin(a) * off, TOWER_Y + h - 1.8, Math.cos(a) * off);
        m.rotation.y = a;
        m.renderOrder = order; // after the see-through tower, or it washes them out
        group.add(m);
      }
      planes.push(back, logo);
    }
    logos.load(`identity/organizations-${s.key}.png`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      face.map = tex;
      face.needsUpdate = true;
      const aspect = tex.image.width / tex.image.height;
      const w = 5.2;
      planes.forEach((p, i) => p.scale.set(i % 2 ? w : w + 0.5, i % 2 ? w / aspect : w / aspect + 0.5, 1));
    });
    return new THREE.Vector3(x, TOWER_Y + h, 0);
  });
  for (const t of towers) segments.push([globeTop, t.clone().setY(TOWER_Y), 'up']);

  // Generated outputs: height = log of the items each one serves.
  const outputs: [string, string, string][] = [
    ['sys:html', 'HTML pages', 'html'],
    ['sys:images', 'Images', 'images'],
    ['sys:jsonld', 'JSON-LD', 'jsonld'],
    ['sys:taxonomy', 'Taxonomies', 'taxonomy'],
    ['sys:entitymap', 'EntityMap', 'entitymap'],
    ['sys:llmstxt', 'llms.txt', 'llms'],
    ['sys:okf', 'OKF bundle', 'okf'],
  ];
  const outTops = outputs.map(([key, title, field], i) => {
    const n = numbers?.outputs[field];
    // Log, offset so the smallest (llms.txt, ~120) still reads as a box and
    // each tenfold step adds the same height: images stand clearly tallest.
    const h = n ? Math.max(1, 1 + 2.6 * (Math.log10(n) - 1.8)) : 2.4;
    const at = { x: (i - (outputs.length - 1) / 2) * 10.5, y: OUTPUT_Y, z: 0 };
    tile({ key, title: n ? `${title} · ${n.toLocaleString('en')}` : title, at }, '#FF8F00', 4.5, h, 4.5);
    return new THREE.Vector3(at.x, OUTPUT_Y + h, at.z);
  });
  for (const o of outTops) for (const t of towers) segments.push([t, o.clone().setY(OUTPUT_Y), 'up']);

  // Who reads it: sphere size = relative monthly volume (log-scaled upstream).
  const consumers: [string, string, string, number[]][] = [
    ['sys:google', 'Google Search', 'google', [0, 1, 2, 3]],
    ['sys:ai-search', 'AI search', 'ai-search', [0, 2, 4, 5, 6]],
    ['sys:assistants', 'AI assistants', 'assistants', [0, 4, 5, 6]],
    ['sys:travelers', 'Travelers', 'travelers', [0, 1, 3]],
  ];
  consumers.forEach(([key, title, field, from], i) => {
    const w = numbers?.consumers[field] ?? 0.6;
    const size = 1 + 2.6 * w;
    const at = { x: (i - 1.5) * 16, y: CONSUMER_Y, z: 0 };
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 1),
      new THREE.MeshStandardMaterial({ color: '#66BB6A', emissive: '#66BB6A', emissiveIntensity: 0.7, flatShading: true, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(at.x, at.y + size, at.z);
    mesh.userData.key = key;
    group.add(mesh);
    pickables.push(mesh);
    labels.push({ text: title, pos: { x: at.x, y: at.y + 2 * size + 1.2, z: at.z }, color: '#ffffff', px: 12, priority: 4000 });
    for (const j of from) segments.push([outTops[j], v(at), 'up']);
  });

  const beamGeo = new THREE.BufferGeometry().setFromPoints(segments.flatMap(([a, b]) => [a, b]));
  group.add(new THREE.LineSegments(beamGeo, new THREE.LineBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.18 })));

  // Data particles: each rides one beam upward, staggered so the flow reads as continuous.
  const count = segments.length * 10;
  const positions = new Float32Array(count * 3);
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: '#E1F5FE', size: 0.55, transparent: true, opacity: 0.95 }));
  group.add(particles);
  const tmp = new THREE.Vector3();
  const animate = (t: number) => {
    for (let i = 0; i < count; i++) {
      const [a, b] = segments[i % segments.length];
      const k = (t * 0.25 + i / count + (i % 7) * 0.13) % 1;
      tmp.lerpVectors(a, b, k);
      positions.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    pgeo.attributes.position.needsUpdate = true;
  };

  return { group, labels, pickables, animate };
}
