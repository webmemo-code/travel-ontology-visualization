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

  // The source of truth is the globe itself, small: the entity boxes settle
  // inside it, and its continents are drawn once the atlas loads (setCoastlines).
  const r = globeRadius * MINI;
  plate(CUBE_Y - r - 1.5, r + 4, 'SOURCE OF TRUTH');
  plate(TOWER_Y, 22, 'PUBLISHING');
  plate(OUTPUT_Y, 30, 'GENERATED OUTPUTS');
  plate(CONSUMER_Y, 36, 'WHO READS IT');

  const globeTop = new THREE.Vector3(0, CUBE_Y + r, 0);
  labels.push({ text: `Ontology · ${graph.nodes.length} entities in YAML`, pos: { x: r + 9, y: CUBE_Y, z: 0 }, color: '#FFD54F', px: 16, priority: 5000 });

  // Publishing: each blog a cube whose VOLUME is its article count, so its
  // side faces are square and the logo can fill them.
  const logos = new THREE.TextureLoader();
  const towers = graph.sites.map((s, i) => {
    const side = 0.79 * Math.cbrt(Math.max(1, s.posts));
    const x = (i === 0 ? -1 : 1) * 9;
    const color = i === 0 ? '#26C6DA' : '#7E57C2';
    const plain = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 });
    const face = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.35 });
    // Box faces: +x, -x, +y, -y, +z, -z. The logo goes on the four sides.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, side, side), [face, face, plain, plain, face, face]);
    mesh.position.set(x, TOWER_Y + side / 2, 0);
    mesh.userData.key = `sys:site:${s.key}`;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
    edges.position.copy(mesh.position);
    group.add(mesh, edges);
    pickables.push(mesh);
    labels.push({ text: `${s.name} · ${s.posts}`, pos: { x, y: TOWER_Y + side + 0.4, z: 0 }, color: '#ffffff', px: 12, priority: 4000 });
    logos.load(`identity/organizations-${s.key}.png`, (img) => {
      // The logo is light text on a transparent PNG: paint it full-width onto
      // the blog's colour, darkened so the lettering reads.
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 512, 512);
      ctx.fillStyle = 'rgba(8, 12, 24, 0.35)';
      ctx.fillRect(0, 0, 512, 512);
      const w = 470;
      const h = (w * img.image.height) / img.image.width;
      ctx.drawImage(img.image, (512 - w) / 2, (512 - h) / 2, w, h);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      face.map = tex;
      face.emissiveMap = tex;
      face.needsUpdate = true;
    });
    return new THREE.Vector3(x, TOWER_Y + side, 0);
  });
  for (const t of towers) segments.push([globeTop, t.clone().setY(TOWER_Y), 'up']);

  // Generated outputs, on a circle so the links between them can show:
  // height = log of the items each one serves. Order keeps linked ones near.
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
    tile({ key, title: n ? `${title} · ${n.toLocaleString('en')}` : title, at }, '#FF8F00', 4.5, h, 4.5);
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
  for (const o of outTops) for (const t of towers) segments.push([t, o.clone().setY(OUTPUT_Y), 'up']);

  // Who reads it: sphere size = relative monthly volume (log-scaled upstream).
  const consumers: [string, string, string, string[]][] = [
    ['sys:google', 'Google Search', 'google', ['sys:html', 'sys:photos', 'sys:jsonld', 'sys:taxonomy']],
    ['sys:ai-search', 'AI search', 'ai-search', ['sys:html', 'sys:jsonld', 'sys:entitymap', 'sys:llmstxt', 'sys:okf']],
    ['sys:assistants', 'AI assistants', 'assistants', ['sys:html', 'sys:entitymap', 'sys:llmstxt', 'sys:okf']],
    ['sys:travelers', 'Travelers', 'travelers', ['sys:html', 'sys:photos', 'sys:taxonomy']],
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
    for (const k of from) segments.push([outTops[outputs.findIndex(([key]) => key === k)], v(at), 'up']);
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
    for (let i = 0; i < linkCount; i++) {
      arcs[i % arcs.length].getPoint((t * 0.3 + i / linkCount) % 1, tmp);
      linkPositions.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    lgeo.attributes.position.needsUpdate = true;
  };

  /** Continents on the mini globe: the globe view's border segments, scaled down. */
  const setCoastlines = (segs: number[]) => {
    const pts = new Float32Array(segs.length);
    for (let i = 0; i < segs.length; i += 3) {
      pts[i] = segs[i] * MINI;
      pts[i + 1] = CUBE_Y + segs[i + 1] * MINI;
      pts[i + 2] = segs[i + 2] * MINI;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#9c7f35', transparent: true, opacity: 0.7 })));
  };

  return { group, labels, pickables, animate, setCoastlines };
}
