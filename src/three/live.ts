// The live layer on the globe: readers as glowing dots at their country (city
// jittered, never a precise location) with a flowing arc to the article
// they read; AI agents as satellites coloured by what they fetch for
// (training, search, a user's question). A satellite hovers, geostationary,
// over its operator's headquarters, drops a thin tether to the country its
// requests came from, and beams to the article or entity it fetched. Bots
// with no known operator keep orbiting.
// What is being read glows: each target article or entity gets a pulsing ring
// in the reader's or bot's colour and its title as a label. A ring grows a
// little with more readers on it, but never shows a count.
// No numbers anywhere: one dot per distinct reader row, one satellite per bot.
import * as THREE from 'three';
import { DOME_R, domeDirection } from '../data/globe';
import { botName, countryCentre, operatorOf, tierOf, type BotTier, type LiveBySite } from '../data/live';
import type { Atlas } from '../data/atlas';
import type { SiteKey } from '../data/types';
import type { Vec3 } from '../data/model';
import type { Labels } from './label';
import { haloTexture } from './portrait';
import { withDepthFade } from './depthFade';

export const READER_COLOR = '#69F0AE';
export const TIER_COLORS: Record<BotTier, string> = { training: '#FF7043', search: '#FFEE58', user: '#9CCC65', other: '#B0BEC5' };
const TIER_ORBIT: Record<BotTier, number> = { training: 1.55, search: 1.42, user: 1.3, other: 1.65 };
const WINDOW_S = 1800;
// Six operators sit within 60 km of each other in the Bay Area; at globe scale
// they would stack into one point, so their satellites spread on a small ring.
const BAY = ['openai', 'anthropic', 'perplexity', 'google', 'apple', 'meta'];
function hover(op: string, hq: [number, number]): [number, number] {
  const i = BAY.indexOf(op);
  if (i < 0) return hq;
  const a = (i / BAY.length) * Math.PI * 2;
  return [37.6 + 6 * Math.sin(a), -122.2 + 7.5 * Math.cos(a)];
}

/** Small stable hash, so a city or bot keeps its jitter and orbit across polls. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * LineDashedMaterial whose dashes can travel: three.js has no dash offset for
 * it, so shift the line distance in the shader. Returns the shift uniform.
 */
function flowingDash(params: THREE.LineDashedMaterialParameters) {
  const mat = new THREE.LineDashedMaterial(params);
  const shift = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDashShift = shift;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDashShift;')
      .replace('mod( vLineDistance, totalSize )', 'mod( vLineDistance + uDashShift, totalSize )');
  };
  return { mat, shift };
}

export interface LiveContext {
  atlas: Atlas | null;
  /** Centre of an article's tile, or null when the article is not on the globe. */
  tile: (site: SiteKey, id: number) => THREE.Vector3 | null;
  /** An entity's box position, or null. */
  entity: (key: string) => Vec3 | null;
  /** What to call a target: an article's title or an entity's label. */
  name: (target: { site: SiteKey; post?: number | null; entity?: string }) => string | null;
}

interface Target {
  at: THREE.Vector3;
  color: string;
  /** Readers and bots on it; only ever drives the ring size, never shown. */
  weight: number;
  name: string | null;
}

/** A thin bright ring on a transparent canvas, for the target pulses. */
function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

interface Satellite {
  key: string;
  mesh: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  /** Pinned over the operator; null for an unknown operator, which orbits instead. */
  anchor: THREE.Vector3 | null;
  axis: THREE.Vector3;
  start: THREE.Vector3;
  speed: number;
  phase: number;
  targets: { at: THREE.Vector3; fresh: number }[];
  beams: THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  /** Request countries, as points on the surface. */
  origins: Map<string, THREE.Vector3>;
  tethers: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

export class LiveLayer {
  readonly group = new THREE.Group();
  private readerGroup = new THREE.Group();
  private arcs: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>[] = [];
  private dots: THREE.Sprite[] = [];
  private sats = new Map<string, Satellite>();
  private dotTex = haloTexture();
  private ringTex = ringTexture();
  private rings: THREE.Sprite[] = [];
  private targets = new Map<string, Target>();

  private labels: Labels;

  constructor(labels: Labels) {
    this.labels = labels;
    this.group.add(this.readerGroup);
  }

  set(data: LiveBySite | null, ctx: LiveContext) {
    this.clear();
    if (!data) return;
    for (const [site, snap] of Object.entries(data) as [SiteKey, NonNullable<LiveBySite[SiteKey]>][]) {
      if (ctx.atlas) for (const r of snap.readers) this.addReader(site, r.country, r.city, r.post, ctx);
      for (const b of snap.bots) {
        const at =
          b.kind === 'post' && b.post ? ctx.tile(site, b.post) : b.kind === 'entity' && b.entity ? toVec(ctx.entity(b.entity)) : null;
        const sat = this.satellite(b.bot);
        if (at) sat.targets.push({ at, fresh: 1 - (0.7 * Math.min(b.seconds_ago, WINDOW_S)) / WINDOW_S });
        if (at) this.mark(b.kind === 'post' ? `${site}:${b.post}` : `entity:${b.entity}`, at, TIER_COLORS[tierOf(b.bot)], ctx.name({ site, post: b.post, entity: b.entity }));
        const centre = b.country && ctx.atlas && !sat.origins.has(b.country) ? countryCentre(ctx.atlas, b.country) : null;
        if (centre) sat.origins.set(b.country!, new THREE.Vector3(...domeDirection(centre[0], centre[1])).multiplyScalar(DOME_R * 1.01));
      }
    }
    this.drawTargets();
    for (const s of this.sats.values()) {
      s.beams.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, s.targets.length) * 6), 3));
      s.tethers.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, s.origins.size) * 6), 3));
    }
  }

  private addReader(site: SiteKey, country: string, city: string, post: number | null, ctx: LiveContext) {
    const centre = countryCentre(ctx.atlas!, country);
    if (!centre) return;
    // Cities spread around their country's centre; nothing finer is ever known.
    const j = hash(`${country}:${city}`);
    const d = domeDirection(centre[0] + (j - 0.5) * 3, centre[1] + (hash(city + country) - 0.5) * 4);
    const from = new THREE.Vector3(...d).multiplyScalar(DOME_R * 1.015);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex, color: READER_COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    dot.position.copy(from);
    dot.scale.setScalar(4.2);
    dot.userData.phase = j * Math.PI * 2;
    this.readerGroup.add(dot);
    this.dots.push(dot);
    const to = post ? ctx.tile(site, post) : null;
    if (!to) return;
    this.mark(`${site}:${post}`, to, READER_COLOR, ctx.name({ site, post }));
    // Arc over the skin: lift the control point outward, more for longer hops.
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const lift = DOME_R * (1.05 + 0.35 * from.distanceTo(to) / (2 * DOME_R));
    const ctrl = mid.lengthSq() > 1 ? mid.setLength(lift) : new THREE.Vector3(0, lift, 0);
    const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to.clone().multiplyScalar(1.005));
    const { mat, shift } = flowingDash({ color: READER_COLOR, dashSize: 2.2, gapSize: 1.2, transparent: true, opacity: 0.95, depthWrite: false });
    withDepthFade(mat, 0.6, 0.6);
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), mat);
    arc.userData.shift = shift;
    arc.computeLineDistances();
    this.readerGroup.add(arc);
    this.arcs.push(arc);
  }

  /** Note a target; a reader's colour wins over a bot's, since people reading is the headline. */
  private mark(key: string, at: THREE.Vector3, color: string, name: string | null) {
    const t = this.targets.get(key);
    if (!t) return void this.targets.set(key, { at, color, weight: 1, name });
    t.weight++;
    if (color === READER_COLOR) t.color = color;
  }

  /** Rings on every target; titles only on the busiest few, readers first, so the globe stays legible. */
  private drawTargets() {
    const named = new Set(
      [...this.targets]
        .sort((a, b) => +(b[1].color === READER_COLOR) - +(a[1].color === READER_COLOR) || b[1].weight - a[1].weight)
        .slice(0, 6)
        .map(([k]) => k),
    );
    for (const [key, t] of this.targets) {
      const ring = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.ringTex, color: t.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      // Just above the tile or box, so the ring is never buried in it.
      ring.position.copy(t.at).multiplyScalar(t.at.length() > DOME_R * 0.9 ? 1.012 : 1);
      ring.userData.base = 4.5 + 1.2 * Math.min(t.weight - 1, 4);
      ring.userData.phase = hash(key) * Math.PI * 2;
      this.group.add(ring);
      this.rings.push(ring);
      if (t.name && named.has(key)) this.labels.set(`live-target:${key}`, t.name, toPlain(ring.position.clone().multiplyScalar(1.02)), 5500, { px: 13, color: t.color, views: ['graph'] });
    }
  }

  private satellite(bot: string): Satellite {
    const have = this.sats.get(bot);
    if (have) return have;
    const tier = tierOf(bot);
    const color = TIER_COLORS[tier];
    const h = hash(bot);
    const op = operatorOf(bot);
    const at = op ? hover(op[0], op[1].hq) : null;
    const anchor = at ? new THREE.Vector3(...domeDirection(at[0], at[1])).multiplyScalar(DOME_R * TIER_ORBIT[tier]) : null;
    const axis = new THREE.Vector3(Math.cos(h * 9) * 0.5, 1, Math.sin(h * 7) * 0.5).normalize();
    const start = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), h * Math.PI * 2);
    start.sub(axis.clone().multiplyScalar(start.dot(axis))).setLength(DOME_R * TIER_ORBIT[tier]);
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.4), new THREE.MeshBasicMaterial({ color, wireframe: true }));
    const { mat: beamMat, shift } = flowingDash({ color, dashSize: 0.8, gapSize: 0.8, transparent: true, depthWrite: false });
    const beams = new THREE.LineSegments(new THREE.BufferGeometry(), beamMat);
    beams.userData.shift = shift;
    const tetherMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false });
    withDepthFade(tetherMat, 0.6, 0.6);
    const tethers = new THREE.LineSegments(new THREE.BufferGeometry(), tetherMat);
    this.group.add(mesh, beams, tethers);
    const sat: Satellite = { key: `live-bot:${bot}`, mesh, anchor, axis, start, speed: 0.05 + 0.04 * h, phase: h * 6.28, targets: [], beams, origins: new Map(), tethers };
    this.sats.set(bot, sat);
    const name = op && op[1].name !== botName(bot) ? `${botName(bot)} · ${op[1].name}` : botName(bot);
    this.labels.set(sat.key, name, toPlain(anchor ?? start), 6000, { px: 13, color, views: ['graph'] });
    return sat;
  }

  /** Orbits, beams and pulses; call every frame. */
  tick(t: number) {
    for (const dot of this.dots) dot.material.opacity = 0.7 + 0.3 * Math.sin(t * 2.2 + dot.userData.phase);
    // Target rings breathe outward and fade, like a ping.
    for (const ring of this.rings) {
      const k = ((t * 0.6 + ring.userData.phase) % 1 + 1) % 1;
      ring.scale.setScalar(ring.userData.base * (0.7 + 0.6 * k));
      ring.material.opacity = 0.95 * (1 - k * 0.8);
    }
    // Dashes flow toward the article. Each arc has its own uniform; they share one clock.
    for (const arc of this.arcs) (arc.userData.shift as { value: number }).value = -t * 3;
    for (const s of this.sats.values()) {
      if (s.anchor) s.mesh.position.copy(s.anchor).multiplyScalar(1 + 0.012 * Math.sin(t * 1.3 + s.phase)); // a gentle hover
      else s.mesh.position.copy(s.start).applyAxisAngle(s.axis, t * s.speed);
      s.mesh.rotation.set(t * 0.7, t * 1.1, 0);
      this.labels.move(s.key, toPlain(s.mesh.position.clone().multiplyScalar(1.06)));
      const tie = s.tethers.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (tie) {
        [...s.origins.values()].forEach((o, i) => {
          tie.setXYZ(i * 2, s.mesh.position.x, s.mesh.position.y, s.mesh.position.z);
          tie.setXYZ(i * 2 + 1, o.x, o.y, o.z);
        });
        tie.needsUpdate = true;
      }
      const pos = s.beams.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      s.targets.forEach((g, i) => {
        pos.setXYZ(i * 2, s.mesh.position.x, s.mesh.position.y, s.mesh.position.z);
        pos.setXYZ(i * 2 + 1, g.at.x, g.at.y, g.at.z);
      });
      pos.needsUpdate = true;
      s.beams.computeLineDistances();
      (s.beams.userData.shift as { value: number }).value = -t * 4;
      s.beams.material.opacity = s.targets.length ? 0.35 + 0.5 * Math.max(...s.targets.map((g) => g.fresh)) : 0;
    }
  }

  clear() {
    for (const arc of this.arcs) {
      this.readerGroup.remove(arc);
      arc.geometry.dispose();
      arc.material.dispose();
    }
    // Sprites share one geometry across three.js: dispose only their materials.
    for (const dot of this.dots) {
      this.readerGroup.remove(dot);
      dot.material.dispose();
    }
    for (const ring of this.rings) {
      this.group.remove(ring);
      ring.material.dispose();
    }
    for (const key of this.targets.keys()) this.labels.set(`live-target:${key}`, null, { x: 0, y: 0, z: 0 }, 0);
    this.rings = [];
    this.targets.clear();
    this.arcs = [];
    this.dots = [];
    for (const s of this.sats.values()) {
      this.group.remove(s.mesh, s.beams, s.tethers);
      s.tethers.geometry.dispose();
      s.tethers.material.dispose();
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      s.beams.geometry.dispose();
      s.beams.material.dispose();
      this.labels.set(s.key, null, toPlain(s.start), 0);
    }
    this.sats.clear();
  }
}

const toVec = (v: Vec3 | null) => (v ? new THREE.Vector3(v.x, v.y, v.z) : null);
const toPlain = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
