// Labels: camera-facing text drawn at a constant pixel size, with overlap
// culling so a dense region shows its most important names instead of a smear.
// Priority decides who wins; the rest reappear as the camera moves.
//
// Level of detail: every label has a tier. Tier 0 (continents, the main
// countries, people, the most local topics) is a pill and always eligible;
// tier 1 (other countries, topics, companies) and tier 2 (regions, sights,
// trips) are plain text that only appear once the camera is near them, and
// every label fades with depth like the tiles behind it.
import * as THREE from 'three';
import type { Vec3 } from '../data/model';

const RES = 2; // canvas supersampling for crisp text on high-DPI screens

/** How near (world units) the camera must be for a tier to show. */
const REACH = [Infinity, 100, 55];
/** Full opacity and relative size per tier. */
const ALPHA = [1, 0.85, 0.7];
const SCALE = [1, 0.92, 0.85];

export function makeLabel(
  text: string,
  { color = '#ffffff', opacity = 1, plain = false }: { color?: string; opacity?: number; plain?: boolean } = {},
): THREE.Sprite {
  const size = 28 * RES;
  const font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const pad = size * 0.5;
  canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
  canvas.height = Math.ceil(size * 1.6);
  ctx.font = font;
  if (plain) {
    // No pill: a soft shadow keeps the text readable over the tiles.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = size * 0.25;
  } else {
    ctx.fillStyle = 'rgba(8, 12, 24, 0.75)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height / 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthTest: false, depthWrite: false, sizeAttenuation: false }),
  );
  sprite.center.set(0.5, 0);
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

interface Item {
  sprite: THREE.Sprite;
  text: string;
  pos: Vec3;
  priority: number;
  px: number;
  views: string[];
  /** Never culled: a few structural labels must always read. */
  always: boolean;
  tier: number;
}

export class Labels {
  group = new THREE.Group();
  private items = new Map<string, Item>();
  private ndc = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private at = new THREE.Vector3();

  /** Create, update or (text = null) remove a label. */
  set(
    key: string,
    text: string | null,
    pos: Vec3,
    priority: number,
    opts: { px?: number; color?: string; views?: string[]; always?: boolean; tier?: number } = {},
  ) {
    const tier = opts.tier ?? 0;
    const old = this.items.get(key);
    if (old && (!text || old.text !== text || (old.tier === 0) !== (tier === 0))) {
      this.group.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
      this.items.delete(key);
    }
    if (!text) return;
    const item = this.items.get(key);
    if (item) {
      item.pos = pos;
      item.priority = priority;
      if (opts.px) item.px = opts.px;
      item.tier = tier;
      return;
    }
    const sprite = makeLabel(text, { color: opts.color, plain: tier > 0 });
    this.group.add(sprite);
    this.items.set(key, { sprite, text, pos, priority, px: opts.px ?? 15, views: opts.views ?? [], always: !!opts.always, tier });
  }

  move(key: string, pos: Vec3) {
    const item = this.items.get(key);
    if (item) item.pos = pos;
  }

  keys(): string[] {
    return [...this.items.keys()];
  }

  /**
   * Size every label to its pixel height and hide the ones that would overlap,
   * that `hide` rejects, or whose tier the camera is too far away for. `fade`
   * is the dome's depth band: labels behind it dim like the tiles do.
   */
  update(
    camera: THREE.PerspectiveCamera,
    w: number,
    h: number,
    view: string,
    hide?: (key: string, pos: Vec3) => boolean,
    fade?: { from: number; far: number } | null,
  ) {
    const k = 2 / (camera.projectionMatrix.elements[5] * h); // sprite scale per pixel, sizeAttenuation off
    const placed: [number, number, number, number][] = [];
    camera.getWorldDirection(this.fwd);
    for (const [key, it] of [...this.items].sort((a, b) => b[1].priority - a[1].priority)) {
      const s = it.sprite;
      s.position.set(it.pos.x, it.pos.y, it.pos.z);
      const inView = !it.views.length || it.views.includes(view);
      this.ndc.set(it.pos.x, it.pos.y, it.pos.z).project(camera);
      this.at.set(it.pos.x, it.pos.y, it.pos.z).sub(camera.position);
      const tooFar = !it.always && this.at.length() > REACH[it.tier];
      if (!inView || tooFar || (!it.always && hide?.(key, it.pos)) || this.ndc.z > 1 || Math.abs(this.ndc.x) > 1.1 || Math.abs(this.ndc.y) > 1.1) {
        s.visible = false;
        continue;
      }
      const depth = fade ? THREE.MathUtils.smoothstep(this.at.dot(this.fwd), fade.from, fade.far) : 0;
      s.material.opacity = ALPHA[it.tier] * (1 - 0.6 * depth);
      const hPx = it.px * 1.6 * SCALE[it.tier];
      const wPx = hPx * s.userData.aspect;
      const x = ((this.ndc.x + 1) / 2) * w - wPx / 2;
      const y = ((1 - this.ndc.y) / 2) * h - hPx - 6;
      const rect: [number, number, number, number] = [x, y, x + wPx, y + hPx];
      const clash = !it.always && placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
      s.visible = !clash;
      if (clash) continue;
      placed.push(rect);
      s.scale.set(hPx * s.userData.aspect * k, hPx * k, 1);
      // Lift the pill a few pixels above its anchor.
      s.center.set(0.5, -6 / hPx);
    }
  }
}
