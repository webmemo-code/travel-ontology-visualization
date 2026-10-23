// Scene 1, "the stack": how one ontology becomes everything the sites
// publish. The entity boxes themselves morph into the cube on the bottom floor;
// this module builds the floors above it and the beams particles travel along.
import * as THREE from 'three';
import type { Vec3 } from '../data/model';
import type { Graph } from '../data/types';

export const CUBE_Y = -16;
const TOWER_Y = 4;
const OUTPUT_Y = 22;
const CONSUMER_Y = 36;

export interface SystemTile {
  key: string;
  title: string;
  at: Vec3;
}

/** A literal cube: entities packed class by class into a 7-wide grid. */
export function cubePositions(graph: Graph): Map<string, Vec3> {
  const order = ['people', 'trips', 'organizations', 'topics', 'places'];
  const nodes = [...graph.nodes].sort(
    (a, b) => (order.indexOf(a.class) - order.indexOf(b.class)) || b.depth - a.depth || a.key.localeCompare(b.key),
  );
  const side = 7;
  const layers = Math.ceil(nodes.length / (side * side));
  const gap = 2.3;
  const pos = new Map<string, Vec3>();
  nodes.forEach((n, i) => {
    const layer = Math.floor(i / (side * side));
    const r = i % (side * side);
    pos.set(n.key, {
      x: ((r % side) - (side - 1) / 2) * gap,
      y: CUBE_Y + (layer - (layers - 1) / 2) * gap,
      z: (Math.floor(r / side) - (side - 1) / 2) * gap,
    });
  });
  return pos;
}

export function buildSystem(graph: Graph) {
  const group = new THREE.Group();
  const labels: { text: string; pos: Vec3; color: string; px: number; priority: number }[] = [];
  const pickables: THREE.Mesh[] = [];
  const segments: [THREE.Vector3, THREE.Vector3, string][] = [];
  const v = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

  const plate = (y: number, r: number, name: string) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.1, r + 0.1, 128),
      new THREE.MeshBasicMaterial({ color: '#29B6F6', transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r, 96),
      new THREE.MeshBasicMaterial({ color: '#0D47A1', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
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
    return new THREE.Vector3(t.at.x, t.at.y, t.at.z);
  };

  plate(CUBE_Y - 9.5, 14, 'SOURCE OF TRUTH');
  plate(TOWER_Y, 22, 'PUBLISHING');
  plate(OUTPUT_Y, 34, 'GENERATED OUTPUTS');
  plate(CONSUMER_Y, 34, 'WHO READS IT');

  const cubeTop = new THREE.Vector3(0, CUBE_Y + 6, 0);
  labels.push({ text: `Ontology · ${graph.nodes.length} entities in YAML`, pos: { x: 0, y: CUBE_Y + 9, z: 0 }, color: '#FFD54F', px: 16, priority: 5000 });

  const towers = graph.sites.map((s, i) => {
    const h = Math.max(2, s.posts / 70);
    const x = (i === 0 ? -1 : 1) * 11;
    const color = i === 0 ? '#26C6DA' : '#7E57C2';
    return tile({ key: `sys:site:${s.key}`, title: `${s.name} · ${s.posts}`, at: { x, y: TOWER_Y, z: 0 } }, color, 6, h, 6)
      .setY(TOWER_Y + h);
  });
  for (const t of towers) segments.push([cubeTop, t.clone().setY(TOWER_Y), 'up']);

  const outputs: [string, string][] = [
    ['sys:jsonld', 'JSON-LD'],
    ['sys:taxonomy', 'Taxonomies'],
    ['sys:entitymap', 'EntityMap'],
    ['sys:llmstxt', 'llms.txt'],
    ['sys:okf', 'OKF bundle'],
  ];
  const outTops = outputs.map(([key, title], i) => {
    const at = { x: (i - (outputs.length - 1) / 2) * 14, y: OUTPUT_Y, z: 0 };
    return tile({ key, title, at }, '#FF8F00', 5, 2.4, 5).setY(OUTPUT_Y + 2.4);
  });
  for (const o of outTops) for (const t of towers) segments.push([t, o.clone().setY(OUTPUT_Y), 'up']);

  const consumers: [string, string, number[]][] = [
    ['sys:google', 'Google Search', [0, 1]],
    ['sys:ai-search', 'AI search', [0, 2, 3, 4]],
    ['sys:assistants', 'AI assistants', [2, 3, 4]],
    ['sys:readers', 'Readers', [1]],
  ];
  consumers.forEach(([key, title, from], i) => {
    const at = { x: (i - 1.5) * 16, y: CONSUMER_Y, z: 0 };
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.2, 1),
      new THREE.MeshStandardMaterial({ color: '#66BB6A', emissive: '#66BB6A', emissiveIntensity: 0.7, flatShading: true, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(at.x, at.y + 2.2, at.z);
    mesh.userData.key = key;
    group.add(mesh);
    pickables.push(mesh);
    labels.push({ text: title, pos: { x: at.x, y: at.y + 4.6, z: at.z }, color: '#ffffff', px: 12, priority: 4000 });
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
