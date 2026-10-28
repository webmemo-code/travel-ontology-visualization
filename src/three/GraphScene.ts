// Imperative three.js scene behind all three views:
//   system - entities packed into the ontology cube under the publishing stack
//   graph  - the article dome, seen from the inside, with places on inner shells
//   mirror - Travelmemo and Reisememo on one flat story map, a cell per story
// React owns the UI; this class owns WebGL and reports hover/select back.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { withDepthFade, withHorizonCull } from './depthFade';
import { withDetailFade } from './detailFade';
import { buildLand } from './land';
import { createBloomComposer, type BloomComposerResult } from './bloomComposer';
import { Labels } from './label';
import { LiveLayer } from './live';
import type { LiveBySite } from '../data/live';
import { CUBE_Y, GHOST_SHELL, MINI, buildSystem, miniGlobePositions } from './system';
import { buildDome, miniDome, type AtlasIndex, type Dome } from './dome';
import { haloTexture, makeEmblem, makePortrait } from './portrait';
import { DOME_R, domeDirection, domeLayout, orgsOverHeadquarters, placesOverTiles, postKey, topicsOverHotspots, type Headquarters } from '../data/globe';
import { footprints, liftByCountry, type Footprint } from '../data/footprint';
import type { Atlas } from '../data/atlas';
import { layoutStories } from '../data/storymap';
import { buildStoryMap, type StoryMap } from './storymap';
import { CLASS_COLORS, ancestorOfType, cooccurring, descendants, labelFor, placeTree, postsFor, slugTitle, statsFor, type PlaceTree, type Vec3 } from '../data/model';
import type { Graph, GraphNode, GraphPost, Perf, SiteMode, SiteStats } from '../data/types';
import type { Geometry } from 'geojson';

const GHOST_R = DOME_R * GHOST_SHELL;
const MAX_STEP = Math.cos((12 * Math.PI) / 180);

/** True borders on the same rotated globe, as line segments just inside the skin. */
function borderSegments(geometry: Geometry, out: number[]) {
  // A coastline mesh is a MultiLineString: treat each line as one ring.
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'MultiLineString' ? [geometry.coordinates] : [];
  for (const poly of polys) {
    for (const ring of poly) {
      let prev: [number, number, number] | null = null;
      for (const [lon, lat] of ring) {
        const d = domeDirection(lat, lon);
        // Guard against ring jumps (antimeridian-split polygons) drawing chords across the globe.
        if (prev && prev[0] * d[0] + prev[1] * d[1] + prev[2] * d[2] > MAX_STEP) {
          out.push(prev[0] * GHOST_R, prev[1] * GHOST_R, prev[2] * GHOST_R, d[0] * GHOST_R, d[1] * GHOST_R, d[2] * GHOST_R);
        }
        prev = d;
      }
    }
  }
}

export type View = 'system' | 'graph' | 'mirror';

export interface CameraKeyframe {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

const kf = (p: [number, number, number], t: [number, number, number]): CameraKeyframe => ({
  position: { x: p[0], y: p[1], z: p[2] },
  target: { x: t[0], y: t[1], z: t[2] },
});
export const HOMES: Record<View, CameraKeyframe> = {
  system: kf([52, 62, 92], [-10, 12, 0]),
  // Outside, facing Switzerland: the view that reads like the globe we know.
  graph: kf([28, 30, -142], [0, 2, 0]),
  mirror: kf([0, -12, 112], [0, 4, 0]),
};

const GLOW: Record<Perf, number> = { top10: 1.25, top25: 0.75, active: 0.45, seen: 0.22, none: 0.1 };
const TILE: Record<Perf, number> = { top10: 1.7, top25: 0.95, active: 0.5, seen: 0.28, none: 0.16 };
// Kept below 1 so photos never feed the bloom pass; brightness still ranks by perf tier.
const PHOTO: Record<Perf, number> = { top10: 0.8, top25: 0.68, active: 0.56, seen: 0.48, none: 0.42 };
const SITE_TINT = { travelmemo: new THREE.Color('#26C6DA'), reisememo: new THREE.Color('#B388FF') };
const GOLD = new THREE.Color('#FFD54F');

interface Box {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  halo: THREE.Sprite;
  face?: THREE.Sprite;
  base: Vec3;
  size: number;
  detail: { value: number };
}

interface NodeView extends Box {
  key: string;
  node: GraphNode;
  pickable: boolean;
  /** Reisememo's box in the mirror view; hidden elsewhere. */
  twin: Box & { pickable: boolean };
}

export interface SceneCallbacks {
  onHover: (key: string | null, x: number, y: number) => void;
  onSelect: (key: string | null) => void;
}

export class GraphScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  // Drawn after the bloom pass so text stays crisp instead of glowing.
  private labelScene = new THREE.Scene();
  private labels = new Labels();
  private live = new LiveLayer(this.labels);
  private liveData: LiveBySite | null = null;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private bloom: BloomComposerResult;
  private views = new Map<string, NodeView>();
  private layouts: Record<'graph' | 'system' | 'mirror' | 'mirrorDe', Map<string, Vec3>>;
  private dome: Dome;
  private postsByKey = new Map<string, GraphPost>();
  private tree: PlaceTree;
  private nodes: Map<string, GraphNode>;
  private atlas: Atlas | null = null;
  private ghost = new THREE.Group();
  private ghostFocus = new THREE.Group();
  private ghostMats: LineMaterial[] = [];
  private land?: ReturnType<typeof buildLand>;
  private globeDetail = { value: 0 };
  private photos: { tex: THREE.Texture; index: AtlasIndex } | null = null;
  // A blurred photo of the selection's best article, fading in over the sky.
  private photoSky!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private photoSkyKey: string | null = null;
  private photoSkyTarget = 0;
  private links = new THREE.Group();
  private focusLinks = new THREE.Group();
  private hotLines = new THREE.Group();
  private hotMats: LineMaterial[] = [];
  /** Footprints per site mode, computed on first use. */
  private fps = new Map<SiteMode, Map<string, Footprint>>();
  private mirrorDecor = new THREE.Group();
  private storyMap!: StoryMap;
  private system: ReturnType<typeof buildSystem>;
  private view: View = 'graph';
  private morph: { from: Map<string, Vec3>; twinFrom: Map<string, Vec3>; t0: number; ms: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private mode: SiteMode = 'both';
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private filterTop: string | null = null;
  private hovered: string | null = null;
  private flight: { from: CameraKeyframe; to: CameraKeyframe; t0: number; ms: number; done?: () => void } | null = null;
  private frame = 0;
  private clock = new THREE.Clock();
  private downAt = { x: 0, y: 0 };
  private graph: Graph;
  private container: HTMLElement;
  private cb: SceneCallbacks;

  constructor(container: HTMLElement, graph: Graph, cb: SceneCallbacks) {
    this.container = container;
    this.graph = graph;
    this.cb = cb;
    const { clientWidth: w, clientHeight: h } = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.setCamera(HOMES.graph);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 260;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    this.scene.background = new THREE.Color('#070b14');
    this.scene.fog = new THREE.FogExp2('#070b14', 0.003);
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.0);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);

    this.bloom = createBloomComposer(this.renderer, this.scene, this.camera, { strength: 0.85, radius: 0.5, threshold: 0.62 });
    this.bloom.updateSize(w, h);

    this.tree = placeTree(graph);
    this.nodes = new Map(graph.nodes.map((n) => [n.key, n]));
    // Geographic directions seed the cartogram; places then re-aim over the
    // patches their articles actually landed in.
    const geo = domeLayout(graph);
    this.dome = buildDome(graph, geo);
    const domePos = placesOverTiles(graph, geo, (i) => {
      const f = this.dome.postFace.get(postKey(graph.posts[i]));
      return f === undefined ? null : { center: this.dome.centers[f].toArray() as [number, number, number], region: this.dome.faceRegion[f] };
    });
    // The EN <-> DE story map: cells per story; country flags hang over their patch.
    const story = layoutStories(graph, (k) => this.nodes.get(k)?.geo ?? null);
    this.storyMap = buildStoryMap(story.cells);
    const nowhere = story.centres.get('');
    if (nowhere) this.labels.set('story:nowhere', 'No place tagged', { x: nowhere[0], y: nowhere[1] + 4, z: 1 }, 3000, { px: 12, color: '#B0BEC5', views: ['mirror'] });
    const storyPositions = new Map<string, Vec3>(
      graph.nodes.map((n) => {
        // A country's name sits on its patch centre as a label. Labels are never
        // hit-tested, so every story under one stays clickable; no flags here.
        const c = n.key ? story.centres.get(n.key) : undefined;
        return [n.key, c ? { x: c[0], y: c[1], z: 0.6 } : { x: 0, y: 0, z: -400 }];
      }),
    );
    // Topics and companies hang over where they are over-represented, judged
    // on both blogs; companies with a known headquarters move there once it loads.
    const globe = topicsOverHotspots(graph, domePos, this.footprintsFor('both'));
    this.layouts = {
      graph: globe,
      system: miniGlobePositions(globe),
      mirror: storyPositions,
      mirrorDe: storyPositions,
    };
    graph.posts.forEach((p) => this.postsByKey.set(postKey(p), p));

    this.buildBackdrop();
    this.buildNodes();
    this.buildLinks();
    this.buildMirror();
    this.system = buildSystem(graph, graph.system ?? null, DOME_R);
    // The mini globe wears the globe view's article shell, at the same scale and turn.
    const shell = miniDome(this.dome);
    shell.scale.setScalar(MINI);
    shell.rotation.y = Math.PI;
    shell.position.y = CUBE_Y;
    this.system.group.add(shell);
    this.system.labels.forEach((l, i) => this.labels.set(`sys-label:${i}`, l.text, l.pos, l.priority, { px: l.px, color: l.color, views: ['system'], always: true }));
    this.dome.group.add(this.ghost, this.ghostFocus);
    this.scene.add(this.dome.group, this.links, this.focusLinks, this.hotLines, this.mirrorDecor, this.system.group, this.live.group);
    this.labelScene.add(this.labels.group);
    this.showViewDecor();
    this.applyStyle();
    void this.loadImages();
    void this.loadHeadquarters();

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  // ---------- construction ----------

  private buildBackdrop() {
    const tex = new THREE.TextureLoader().load('textures/mj-2.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(600, 48, 48),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: '#2e3548', fog: false }),
      ),
    );
    this.photoSky = new THREE.Mesh(
      new THREE.SphereGeometry(590, 48, 48),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false, color: '#6f7a8c' }),
    );
    this.photoSky.renderOrder = -2;
    this.scene.add(this.photoSky);
    const stars = new Float32Array(1500 * 3);
    for (let i = 0; i < stars.length; i += 3) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(180 + Math.random() * 300);
      stars.set([v.x, v.y, v.z], i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#9ecbff', size: 0.7, transparent: true, opacity: 0.7, fog: false })));
  }

  private makeBox(node: GraphNode, box: THREE.BoxGeometry, edges: THREE.EdgesGeometry, halo: THREE.Texture, base: Vec3): Box {
    const color = new THREE.Color(CLASS_COLORS[node.class] ?? '#B0BEC5');
    const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color, emissive: color, transparent: true, depthWrite: false, metalness: 0.2, roughness: 0.4 }));
    mesh.userData.key = node.key;
    const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const face = node.class === 'people' ? makePortrait(node.id, CLASS_COLORS.people) : undefined;
    const detail = { value: 1 };
    withDetailFade(mesh.material, detail, 0.045);
    withDetailFade(outline.material, detail, 0.08);
    withDetailFade(glow.material, detail, 0.01, 0.15);
    if (face) withDetailFade(face.material, detail, 0.08);
    this.scene.add(mesh, outline, glow, ...(face ? [face] : []));
    return { mesh, outline, halo: glow, face, base: { ...base }, size: 1, detail };
  }

  private buildNodes() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    const halo = haloTexture();
    for (const node of this.graph.nodes) {
      const base = this.layouts.graph.get(node.key)!;
      const main = this.makeBox(node, box, edges, halo, base);
      const twin = { ...this.makeBox(node, box, edges, halo, base), pickable: false };
      this.views.set(node.key, { key: node.key, node, pickable: true, ...main, twin });
      this.place(main);
    }
  }

  private place(b: Box) {
    b.mesh.position.set(b.base.x, b.base.y, b.base.z);
    b.outline.position.copy(b.mesh.position);
    b.halo.position.copy(b.mesh.position);
    b.face?.position.copy(b.mesh.position);
  }

  private buildLinks() {
    const pos = this.layouts.graph;
    const segs: number[] = [];
    for (const e of this.graph.edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (a && b && e.rel === 'parent') segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.links.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.25 })));
    withDetailFade((this.links.children[0] as THREE.LineSegments).material as THREE.Material, this.globeDetail, 0.06);

    // A trip is drawn as the route itself, stop by stop in itinerary order.
    for (const node of this.graph.nodes) {
      if (!node.route?.length) continue;
      const pts = [node.key, ...node.route].map((k) => pos.get(k)).filter(Boolean).map((p) => new THREE.Vector3(p!.x, p!.y, p!.z));
      if (pts.length < 2) continue;
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.16, 6, false),
        new THREE.MeshBasicMaterial({ color: '#CE93D8', transparent: true, opacity: 0.7 }),
      );
      tube.material.depthWrite = false;
      withDetailFade(tube.material, this.globeDetail, 0.06);
      this.links.add(tube);
    }
  }

  private buildMirror() {
    this.mirrorDecor.add(this.storyMap.group);
  }

  // ---------- styling ----------

  setMode(mode: SiteMode) {
    this.mode = mode;
    this.applyStyle();
    this.refreshFocus();
    this.refreshLive();
  }

  /** Live readers and AI agents (null clears the layer). */
  setLive(data: LiveBySite | null) {
    this.liveData = data;
    this.refreshLive();
  }

  private refreshLive() {
    const data = this.liveData && this.mode !== 'both' ? { [this.mode]: this.liveData[this.mode] } : this.liveData;
    this.live.set(data, {
      atlas: this.atlas,
      tile: (site, id) => {
        const f = this.dome.postFace.get(`post:${site}:${id}`);
        return f === undefined ? null : this.dome.centers[f].clone();
      },
      entity: (key) => this.layouts.graph.get(key) ?? null,
      name: ({ site, post, entity }) => {
        if (post) {
          const p = this.postsByKey.get(`post:${site}:${post}`);
          return p ? this.titleOf(p) : null;
        }
        const n = entity ? this.nodes.get(entity) : undefined;
        return n ? labelFor(n, site) : null;
      },
    });
  }

  /** How an article is named on the globe; the app swaps in real titles once they load. */
  titleOf: (post: GraphPost) => string = (p) => slugTitle(p.url);

  /** Re-label the live layer, e.g. after real titles loaded. */
  refreshLiveNames() {
    this.refreshLive();
  }

  /** Search: dim all but `keys`; `top` (what Enter would pick) also lights its articles. */
  setFilter(keys: Set<string> | null, top: string | null = null) {
    this.filter = keys;
    this.filterTop = top;
    this.applyStyle();
  }

  /** Flags, logos and the article photo atlas arrive after first paint; the scene works without them. */
  /** Companies move over their headquarters; one without stays on its footprint. */
  private async loadHeadquarters() {
    try {
      const hq: Record<string, Headquarters> = await fetch('identity/hq.json').then((r) => r.json());
      this.layouts.graph = orgsOverHeadquarters(this.graph, this.layouts.graph, hq);
      if (this.view !== 'graph' || this.morph) return;
      const from = new Map([...this.views.values()].map((v) => [v.key, { ...v.base }]));
      this.morph = { from, twinFrom: new Map(from), t0: performance.now(), ms: 1200 };
    } catch {
      // no headquarters file: companies keep their footprint position
    }
  }

  private async loadImages() {
    try {
      const credits: Record<string, { image: string; kind?: 'flag' | 'logo' | 'arms' }> = await fetch('identity/credits.json').then((r) => r.json());
      for (const v of this.views.values()) {
        const c = credits[v.key];
        if (!c || v.face) continue;
        const kind = c.kind ?? (v.node.type === 'Country' ? 'flag' : 'logo');
        for (const b of [v, v.twin] as Box[]) {
          b.face = makeEmblem(c.image, kind, CLASS_COLORS[v.node.class] ?? '#ffffff');
          withDetailFade(b.face.material, b.detail, v.node.type === 'Country' ? 0.09 : 0.035);
          b.face.position.copy(b.mesh.position);
          this.scene.add(b.face);
        }
      }
      this.applyStyle();
    } catch (e) {
      console.warn('identity images:', e);
    }
    try {
      const index: AtlasIndex = await fetch('atlas/articles.json').then((r) => r.json());
      const tex = await new THREE.TextureLoader().loadAsync('atlas/articles.jpg');
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.photos = { tex, index };
      this.dome.setAtlas(tex, index);
      this.applyStyle();
    } catch (e) {
      console.warn('photo atlas:', e);
    }
  }

  /** Fade the best lit article's photo, blurred, into the sky behind the globe. */
  private updatePhotoSky(lit: Set<string> | null) {
    const rank = { top10: 0, top25: 1, active: 2, seen: 3, none: 4 };
    const best = this.view === 'graph' && lit && this.photos
      ? [...lit]
          .map((k) => this.postsByKey.get(k)!)
          .filter((p) => p && this.photos!.index.index[postKey(p)])
          .sort((a, b) => rank[a.perf] - rank[b.perf] || b.id - a.id)[0]
      : undefined;
    // A hint of the place's mood, not a wallpaper: bright snow photos would wash the scene out.
    this.photoSkyTarget = best ? 0.14 : 0;
    if (!best || postKey(best) === this.photoSkyKey) return;
    this.photoSkyKey = postKey(best);
    const { index, tex } = this.photos!;
    const cell = index.index[this.photoSkyKey];
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.filter = 'blur(14px) saturate(1.2)';
    const sx = (cell % index.cols) * index.cell;
    const sy = Math.floor(cell / index.cols) * index.cell;
    ctx.drawImage(tex.image as CanvasImageSource, sx + 2, sy + 2, index.cell - 4, index.cell - 4, -40, -40, 592, 336);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    this.photoSky.material.map?.dispose();
    this.photoSky.material.map = map;
    this.photoSky.material.needsUpdate = true;
    // Turn the photo towards where the viewer is looking.
    const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    this.photoSky.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
  }

  /** Show the true borders as a ghost under the cartogram. */
  setAtlas(atlas: Atlas) {
    this.atlas = atlas;
    this.ghost.clear();
    if (this.land) {
      this.land.geometry.dispose();
      this.land.material.map?.dispose();
      this.land.material.dispose();
    }
    this.land = buildLand(atlas.features, GHOST_R * 0.998);
    this.ghost.add(this.land);
    const covered = new Set(atlas.byNode.values());
    const faint: number[] = [];
    const ours: number[] = [];
    for (const f of atlas.features) borderSegments(f.geometry, covered.has(f) ? ours : faint);
    // Continent outlines carry the geography, so they get real line weight
    // (a muted gold: anything brighter crosses the bloom threshold and glows)
    // (screen-space width); the countries we never write about stay a hairline.
    const { clientWidth: w, clientHeight: h } = this.container;
    this.ghostMats = [];
    for (const [segs, color, opacity, width] of [
      [faint, 0x5f6b73, 0.25, 1.0],
      [ours, 0x9c7f35, 0.6, 1.4],
    ] as const) {
      const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
      withDepthFade(mat, 0.7, 0.75);
      withHorizonCull(mat, GHOST_R);
      withDetailFade(mat, this.globeDetail, 0.4, 0.8);
      mat.resolution.set(w, h);
      this.ghostMats.push(mat);
      const lines = new LineSegments2(new LineSegmentsGeometry().setPositions(segs), mat);
      lines.renderOrder = -1;
      this.ghost.add(lines);
    }
    const coast: number[] = [];
    borderSegments(atlas.coast, coast);
    const coastMat = new LineMaterial({ color: 0x86a5ad, linewidth: 1.5, transparent: true, opacity: 0.55, depthWrite: false });
    coastMat.resolution.set(w, h);
    withHorizonCull(coastMat, GHOST_R);
    this.ghostMats.push(coastMat);
    const coastLines = new LineSegments2(new LineSegmentsGeometry().setPositions(coast), coastMat);
    coastLines.renderOrder = -1;
    this.ghost.add(coastLines);
    this.system.setCoastlines(faint, ours, coast);
    this.system.setLand(atlas.features);
    this.storyMap.setAtlas(atlas.features, atlas.coast);
    this.refreshGhostFocus();
    this.refreshLive(); // readers are placed by country, which needs the atlas
  }

  /** The selection's country, traced in gold along its true border. */
  private refreshGhostFocus() {
    this.ghostFocus.clear();
    if (!this.atlas || !this.selected) return;
    const post = this.postsByKey.get(this.selected);
    const keys = post ? post.entities : [this.selected];
    const countries = new Set(keys.map((k) => ancestorOfType(this.tree, this.nodes, k, 'Country')).filter(Boolean) as string[]);
    const segs: number[] = [];
    for (const c of countries) {
      const f = this.atlas.byNode.get(c);
      if (f) borderSegments(f.geometry, segs);
    }
    if (!segs.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.ghostFocus.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#FFD54F', transparent: true, opacity: 0.95, depthWrite: false })));
  }

  /** The top search hit lights its articles, so it shows where it lives; all hits would flood the globe. */
  private filterPosts(): Set<string> | null {
    if (!this.filter || !this.filterTop) return null;
    const under = descendants(this.tree, this.filterTop);
    return new Set(postsFor(this.graph, this.mode).filter((p) => p.entities.some((e) => under.has(e))).map(postKey));
  }

  private footprintsFor(mode: SiteMode): Map<string, Footprint> {
    let fp = this.fps.get(mode);
    if (!fp) this.fps.set(mode, (fp = footprints(this.graph, postsFor(this.graph, mode))));
    return fp;
  }

  /** The selected topic's or company's footprint, for the lens; null for anything else. */
  private selectedFootprint(): Footprint | null {
    const n = this.selected ? this.nodes.get(this.selected) : undefined;
    if (!n || (n.class !== 'topics' && n.class !== 'organizations')) return null;
    return this.footprintsFor(this.mode).get(n.key) ?? null;
  }

  /** Entities and articles to keep lit for the current selection. */
  private highlight(): { entities: Set<string>; posts: Set<string> } | null {
    const sel = this.selected;
    if (!sel) return null;
    const post = this.postsByKey.get(sel);
    if (post) return { entities: new Set(post.entities), posts: new Set([sel]) };
    if (!this.views.has(sel)) return null;
    const entities = new Set([sel]);
    for (const e of this.graph.edges) {
      if (e.from === sel) entities.add(e.to);
      if (e.to === sel) entities.add(e.from);
    }
    const scoped = postsFor(this.graph, this.mode);
    for (const [k] of cooccurring(scoped, sel, 12)) entities.add(k);
    // A place owns the articles of everything inside it: Italy lights Tuscany's too.
    const under = descendants(this.tree, sel);
    return { entities, posts: new Set(scoped.filter((p) => p.entities.some((e) => under.has(e))).map(postKey)) };
  }

  private styleBox(b: Box, node: GraphNode, s: SiteStats | null, dim: boolean, maxSize: number) {
    const present = !!s;
    const orphan = !s || s.status === 'orphan';
    b.size = present ? Math.min(0.7 + 0.32 * Math.sqrt(s!.posts), maxSize) : 0.5;
    b.mesh.scale.setScalar(b.size);
    b.outline.scale.setScalar(b.size * 1.04);
    const m = b.mesh.material;
    // Authors sit on every article, so their tier says little; keep them from outshining the map.
    m.emissiveIntensity = orphan ? 0 : GLOW[s!.perf] * (node.class === 'people' ? 0.45 : 1);
    // Orphans are outlines only: in the ontology, no article yet.
    m.opacity = b.face || orphan ? 0 : dim ? 0.07 : 0.85;
    const lo = b.outline.material;
    lo.color.set(orphan ? '#78909C' : CLASS_COLORS[node.class] ?? '#B0BEC5');
    lo.userData.base = lo.color.clone(); // depthFade scales from here
    lo.opacity = b.face ? 0 : !present ? 0.1 : dim ? 0.08 : orphan ? 0.45 : 0.9;
    const tier = present && !orphan && !dim && !b.face ? s!.perf : 'none';
    b.halo.visible = (tier === 'top10' || tier === 'top25') && this.view !== 'system';
    b.halo.scale.setScalar(b.size * (tier === 'top10' ? 3.4 : 2.4));
    b.halo.material.opacity = tier === 'top10' ? 0.6 : 0.3;
    if (b.face) {
      const person = node.class === 'people';
      const f = this.view === 'system' ? 1.3 : this.view === 'mirror' ? 1.3 : person ? 6.5 : Math.max(2.2, b.size * (node.type === 'Country' ? 1.05 : node.class === 'places' ? 1.25 : 1.5));
      b.face.scale.set(f * (b.face.userData.aspect ?? 1), f, 1);
      // Emblems stay a little see-through; an orphan's flag or logo fades like its outline would.
      b.face.material.opacity = dim || !present ? 0.2 : orphan ? 0.4 : person ? 1 : 0.7;
    }
    return present;
  }

  private applyStyle() {
    const hl = this.highlight();
    const mirror = this.view === 'mirror';
    const maxSize = this.view === 'system' ? 1.1 : mirror ? 1.6 : 3.6;
    const ranked = [...this.graph.nodes].sort((a, b) => (statsFor(b, this.mode)?.posts ?? 0) - (statsFor(a, this.mode)?.posts ?? 0));
    const rank = new Map(ranked.map((n, i) => [n.key, i]));
    // Label tiers (see label.ts): the main countries and the most local topics read from afar.
    const topCountries = new Set(ranked.filter((n) => n.type === 'Country').slice(0, 8).map((n) => n.key));
    const topTopics = new Set(
      [...this.footprintsFor('both')]
        .filter(([k]) => this.nodes.get(k)?.class === 'topics')
        .sort((a, b) => b[1].concentration - a[1].concentration)
        .slice(0, 5)
        .map(([k]) => k),
    );
    const tierOf = (n: GraphNode) =>
      n.class === 'people' || topCountries.has(n.key) || topTopics.has(n.key) || (n.class === 'places' && n.depth === 0)
        ? 0
        : n.type === 'Country' || n.class === 'topics' || n.class === 'organizations'
          ? 1
          : 2;

    for (const node of this.graph.nodes) {
      const v = this.views.get(node.key)!;
      const dim = !!((hl && !hl.entities.has(node.key)) || (this.filter && !this.filter.has(node.key)));
      const s = statsFor(node, mirror ? 'both' : this.mode);
      // On the story map no boxes or flags at all (they would cover stories);
      // only countries keep a label, on their patch. In "How it works" the mini
      // globe is one object among the floors: its article shell says enough,
      // and 200 boxes inside it made the scene too busy.
      const offMap = mirror && !(node.type === 'Country' && this.layouts.mirror.get(node.key)!.z > 0);
      const noBox = mirror || this.view === 'system';
      const present = this.styleBox(v, node, s, dim, maxSize);
      v.pickable = (present || !dim) && !noBox;
      // A face replaces the box; an invisible box would still write depth and hide it.
      v.mesh.visible = v.outline.visible = !v.face && !noBox;
      if (v.face) v.face.visible = !noBox;
      if (noBox) v.halo.visible = false;

      const sd = node.sites.reisememo ?? null;
      const twinPresent = this.styleBox(v.twin, node, sd, dim, maxSize);
      // Twins belonged to the old two-wall view; the story map has one box per entity.
      for (const o of [v.twin.mesh, v.twin.outline, v.twin.halo, ...(v.twin.face ? [v.twin.face] : [])]) o.visible = false;
      v.twin.pickable = false;
      void twinPresent;

      // Labels: every entity is a candidate; priority decides who survives the overlap cull.
      const orphan = !s || s.status === 'orphan';
      const bonus = node.class === 'people' ? 400 : node.class === 'trips' ? 300 : node.depth === 0 && node.class === 'places' ? 250 : 0;
      // A main country beats its continent: Europe hangs right in front of Switzerland.
      let priority = 1000 - (rank.get(node.key) ?? 999) + bonus + (topCountries.has(node.key) ? 300 : 0) - (orphan ? 800 : 0);
      if (this.filter?.has(node.key)) priority += 4000;
      if (hl?.entities.has(node.key)) priority += 5000;
      if (node.key === this.selected) priority += 20000;
      const showMain = this.view !== 'system' && !offMap && !(dim && !this.filter?.has(node.key)) && (present || this.filter?.has(node.key));
      const text = labelFor(node, mirror ? 'travelmemo' : this.mode);
      // The selection, its neighbours and search hits always read, whatever their tier.
      const tier = hl?.entities.has(node.key) || this.filter?.has(node.key) ? 0 : tierOf(node);
      this.labels.set(node.key, showMain ? text : null, this.anchor(v), priority, { px: node.key === this.selected ? 18 : 14, tier });
      this.labels.set(`twin:${node.key}`, null, this.anchor(v.twin), priority);
    }

    this.links.children.forEach((c) => {
      const mat = (c as THREE.Mesh).material as THREE.Material & { opacity: number };
      mat.opacity = hl || this.filter ? 0.07 : c instanceof THREE.LineSegments ? 0.25 : 0.7;
    });
    // Articles filed inside the selection's own country patch light fully;
    // ones that merely mention it but were filed elsewhere stay dim amber.
    const home = this.selected && this.views.has(this.selected) ? ancestorOfType(this.tree, this.nodes, this.selected, 'Country') : null;
    const fp = this.selectedFootprint();
    this.paintDome(hl?.posts ?? this.filterPosts(), home, fp ? liftByCountry(fp) : null);
    this.storyMap.paint(hl?.posts ?? this.filterPosts());
    this.updatePhotoSky(hl?.posts ?? null);
  }

  /**
   * `lens` (a topic or company selected): country -> lift. Its articles light
   * by how over-represented it is in their country, and the rest of a hotspot
   * country's patch gets a faint wash, so the patch reads as a heat region.
   */
  private paintDome(lit: Set<string> | null, home: string | null = null, lens: Map<string, number> | null = null) {
    const tmp = new THREE.Color();
    const boost = lit && lit.size > 60 ? 0.85 : 1.8;
    const v4 = (c: THREE.Color, a: number) => [c.r, c.g, c.b, a];
    this.dome.paint((post) => {
      if (this.mode !== 'both' && post.site !== this.mode) return null;
      const key = postKey(post);
      // `far` is the plain tile; `near` multiplies the photo where the LOD shows it
      // (near-white keeps the photo, a light site tint says EN or DE, gold marks the selection).
      const photo = this.dome.hasPhoto(post);
      const f = this.dome.postFace.get(key);
      const lift = lens && f !== undefined ? lens.get(this.dome.faceRegion[f] ?? '') ?? 0 : 0;
      let far: number[];
      let near: number[];
      if (lit && lit.has(key) && lens && lift < 1.5) {
        // Tagged, but no more than the blog's usual share here: dim amber.
        far = [0.3, 0.17, 0.02, 0.55];
        near = [0.45, 0.32, 0.12, 0.5];
      } else if (lit && lit.has(key) && lens) {
        const k = Math.min(1, 0.45 + 0.2 * Math.log2(lift)) * 1.8;
        far = [GOLD.r * k, GOLD.g * k, GOLD.b * k, 1];
        near = [1.0, 0.88, 0.55, 0.92];
      } else if (lit && lens && lift >= 1.5) {
        far = near = [0.22, 0.12, 0.02, 0.5];
      } else if (lit && lit.has(key)) {
        if (home && f !== undefined && this.dome.faceRegion[f] !== home) {
          far = [0.3, 0.17, 0.02, 0.55];
          near = [0.45, 0.32, 0.12, 0.5];
        } else {
          // A big selection (Switzerland: ~600 tiles) would bloom into one white disc.
          far = [GOLD.r * boost, GOLD.g * boost, GOLD.b * boost, 1];
          near = [1.0, 0.88, 0.55, 0.92];
        }
      } else if (lit) {
        far = near = v4(tmp.copy(SITE_TINT[post.site]).multiplyScalar(0.25), 0.3);
      } else {
        far = v4(tmp.copy(SITE_TINT[post.site]).multiplyScalar(TILE[post.perf]), post.perf === 'top10' || post.perf === 'top25' ? 0.95 : 0.6);
        near = v4(tmp.setRGB(1, 1, 1).lerp(SITE_TINT[post.site], 0.45).multiplyScalar(PHOTO[post.perf]), 0.45);
      }
      return { near: photo ? near : far, far };
    });
  }

  /** Globe view: entities behind the photo band dim like the dome tiles, so the near side reads first. */
  private depthFade(range: { from: number; far: number } | null) {
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const at = new THREE.Vector3();
    // Outside: geography first. Countries regain colour before cantons/sights
    // as the camera approaches their own shell; other views retain full detail.
    const overview = this.view === 'graph'
      ? 1 - THREE.MathUtils.smoothstep(this.camera.position.length(), DOME_R * 0.9, DOME_R * 1.9)
      : 1;
    this.globeDetail.value = overview;
    if (this.land) this.land.material.opacity = THREE.MathUtils.lerp(0.25, 0.08, overview);
    const tint = (m: THREE.Material & { color: THREE.Color }, f: number) => {
      m.color.copy((m.userData.base ??= m.color.clone()) as THREE.Color).multiplyScalar(f);
    };
    for (const v of this.views.values()) {
      for (const b of [v, v.twin]) {
        const focus = this.selected === v.key || this.filter?.has(v.key);
        const reach = v.node.class === 'places' && v.node.depth > 1 ? 55 : 90;
        const local = 1 - THREE.MathUtils.smoothstep(this.camera.position.distanceTo(b.mesh.position), reach * 0.45, reach);
        b.detail.value = this.view !== 'graph' || focus ? 1 : Math.min(overview, local);
        let f = 1;
        if (range && this.view === 'graph') {
          const depth = at.copy(b.mesh.position).sub(this.camera.position).dot(fwd);
          f = 1 - 0.7 * THREE.MathUtils.smoothstep(depth, range.from, range.far);
        }
        const m = b.mesh.material;
        tint(m, f);
        m.emissive.copy((m.userData.emissive ??= m.emissive.clone()) as THREE.Color).multiplyScalar(f);
        tint(b.outline.material, f);
        tint(b.halo.material, f);
        if (b.face) tint(b.face.material, f);
      }
    }
  }

  private anchor(b: Box): Vec3 {
    const lift = b.face ? b.face.scale.y / 2 : b.size / 2;
    return { x: b.base.x, y: b.base.y + lift, z: b.base.z };
  }

  /** A selected topic or company: bold lines to its top three hotspot countries, weighted by share. */
  private refreshHotLines() {
    this.hotLines.children.forEach((c) => (c as LineSegments2).geometry.dispose());
    this.hotLines.clear();
    this.hotMats.forEach((m) => m.dispose());
    this.hotMats = [];
    const fp = this.selectedFootprint();
    const from = this.selected ? this.views.get(this.selected)?.base : undefined;
    if (this.view !== 'graph' || !fp || !from) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    for (const hot of fp.hotspots.slice(0, 3)) {
      const to = this.views.get(hot.country)?.base;
      if (!to) continue;
      const mat = new LineMaterial({ color: 0xffd54f, linewidth: 1.5 + 5 * hot.share, transparent: true, opacity: 0.9, depthWrite: false });
      mat.resolution.set(w, h);
      this.hotMats.push(mat);
      this.hotLines.add(new LineSegments2(new LineSegmentsGeometry().setPositions([from.x, from.y, from.z, to.x, to.y, to.z]), mat));
    }
  }

  private refreshFocus() {
    this.focusLinks.clear();
    this.refreshGhostFocus();
    this.refreshHotLines();
    if (this.view !== 'graph' || !this.selected) return;
    const segs: number[] = [];
    const post = this.postsByKey.get(this.selected);
    if (post) {
      // Rays from the article tile to the entities it is tagged with.
      const f = this.dome.postFace.get(this.selected);
      if (f === undefined) return;
      const c = this.dome.centers[f].clone().multiplyScalar(0.995);
      for (const k of post.entities) {
        const b = this.views.get(k)?.base;
        if (b) segs.push(c.x, c.y, c.z, b.x, b.y, b.z);
      }
    } else {
      const v = this.views.get(this.selected);
      if (!v) return; // a system tile
      const a = v.base;
      for (const [k] of cooccurring(postsFor(this.graph, this.mode), v.key, 12)) {
        const b = this.views.get(k)?.base;
        if (b) segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      // ...and from the entity out to each of its articles on the dome.
      for (const p of postsFor(this.graph, this.mode)) {
        if (!p.entities.includes(v.key)) continue;
        const f = this.dome.postFace.get(postKey(p));
        if (f === undefined) continue;
        const c = this.dome.centers[f];
        segs.push(a.x, a.y, a.z, c.x, c.y, c.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.focusLinks.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#FFD54F', transparent: true, opacity: 0.55 })));
  }

  // ---------- selection & camera ----------

  select(key: string | null, fly = true) {
    this.selected = key;
    this.applyStyle();
    this.refreshFocus();
    if (!fly) return;
    if (!key) return this.flyTo(HOMES[this.view]);
    const post = this.postsByKey.get(key);
    if (post && this.view === 'mirror') {
      const c = this.storyMap.cellOf(key);
      return c ? this.flyTo(kf([c.x, c.y - 3, 22], [c.x, c.y, 0])) : undefined;
    }
    if (post && this.view === 'graph') {
      const f = this.dome.postFace.get(key);
      if (f === undefined) return;
      // From inside, a tile is just a lit triangle. Step outside instead, beside
      // and above it, and aim between the tile and its entities, so the tile
      // sits off-centre and its rays fan across the frame.
      const c = this.dome.centers[f];
      const ents = post.entities.map((k) => this.views.get(k)?.base).filter(Boolean) as Vec3[];
      const mid = ents.length
        ? ents.reduce<THREE.Vector3>((a, b) => a.add(new THREE.Vector3(b.x, b.y, b.z)), new THREE.Vector3()).divideScalar(ents.length)
        : new THREE.Vector3();
      const target = c.clone().lerp(mid, 0.45);
      const out = c.clone().normalize();
      let side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-4) side = new THREE.Vector3(1, 0, 0);
      side.normalize();
      const up = new THREE.Vector3().crossVectors(side, out).normalize();
      const eye = out.multiplyScalar(DOME_R * 1.75).addScaledVector(side, DOME_R * 0.95).addScaledVector(up, DOME_R * 0.5);
      return this.flyTo(kf(eye.toArray(), target.toArray()), 1900);
    }
    const v = this.views.get(key);
    if (!v) return;
    const p = v.base;
    if (this.view === 'system') return this.flyTo(kf([p.x + 18, p.y + 10, p.z + 22], [p.x, p.y, p.z]));
    if (this.view === 'mirror') return this.flyTo(kf([p.x, p.y - 4, 30], [p.x, p.y, 0]));
    // Inside the dome, stand behind the entity on the line from its articles
    // and look past it: the tag sits in the foreground, a little off-centre,
    // with its stories glowing behind it. Not all of them fit, and need not.
    // The eye stays clear of the skin, so the dome's own tiles stay out of frame.
    const t = new THREE.Vector3(p.x, p.y, p.z);
    const tiles = [...(this.highlight()?.posts ?? [])]
      .map((k) => this.dome.postFace.get(k))
      .filter((f): f is number => f !== undefined)
      .map((f) => this.dome.centers[f]);
    const toward = tiles.length ? tiles.reduce((a, c) => a.add(c), new THREE.Vector3()).divideScalar(tiles.length) : t.clone();
    if (toward.lengthSq() < 1) toward.copy(t); // articles all around the globe cancel out
    toward.setLength(DOME_R);
    const look = toward.clone().sub(t);
    if (look.lengthSq() < 1) look.copy(t).negate(); // entity sits on its own articles: look outward from the centre side
    look.normalize();
    let side = new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-4) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const eye = t.clone().addScaledVector(look, -22).addScaledVector(side, 5);
    if (eye.length() > DOME_R * 0.82) eye.setLength(DOME_R * 0.82);
    this.flyTo(kf(eye.toArray(), t.clone().lerp(toward, 0.35).toArray()), 1800);
  }

  private setCamera(k: CameraKeyframe) {
    this.camera.position.set(k.position.x, k.position.y, k.position.z);
    this.controls.target.set(k.target.x, k.target.y, k.target.z);
  }

  flyTo(to: CameraKeyframe, ms = 1600): Promise<void> {
    this.controls.autoRotate = false;
    return new Promise((done) => {
      this.flight = {
        from: { position: this.camera.position.clone(), target: this.controls.target.clone() },
        to,
        t0: performance.now(),
        ms,
        done,
      };
    });
  }

  private showViewDecor() {
    const v = this.view;
    this.dome.group.visible = this.links.visible = this.hotLines.visible = this.live.group.visible = v === 'graph';
    this.mirrorDecor.visible = v === 'mirror';
    this.system.group.visible = v === 'system';
  }

  setView(view: View) {
    if (view === this.view) return;
    const leavingMirror = this.view === 'mirror';
    this.view = view;
    const from = new Map([...this.views.values()].map((v) => [v.key, { ...v.base }]));
    // Reisememo's twins split off from the shared box on the way into the mirror.
    const twinFrom = new Map([...this.views.values()].map((v) => [v.key, { ...(leavingMirror ? v.twin.base : v.base) }]));
    this.morph = { from, twinFrom, t0: performance.now(), ms: 2200 };
    this.showViewDecor();
    this.focusLinks.clear();
    this.applyStyle();
    this.flyTo(HOMES[view], 2200);
  }

  getCamera(): CameraKeyframe {
    const r = (v: THREE.Vector3) => ({ x: +v.x.toFixed(1), y: +v.y.toFixed(1), z: +v.z.toFixed(1) });
    return { position: r(this.camera.position), target: r(this.controls.target) };
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on;
  }

  // ---------- events ----------

  private pick(ev: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const v of this.views.values()) {
      if (v.pickable) targets.push(v.face ?? v.mesh);
      if (v.twin.pickable) targets.push(v.twin.face ?? v.twin.mesh);
    }
    if (this.view === 'system') targets.push(...this.system.pickables);
    if (this.view === 'graph') targets.push(this.dome.mesh);
    if (this.view === 'mirror') targets.push(this.storyMap.mesh);
    const hits = this.raycaster.intersectObjects(targets, false);
    // On the story map a story under a flag still wins: cells first, flags only on empty ground.
    if (this.view === 'mirror') {
      const cell = hits.find((h) => h.object === this.storyMap.mesh && h.faceIndex != null && this.storyMap.postAt(h.faceIndex));
      if (cell) return this.storyMap.postAt(cell.faceIndex!);
    }
    for (const hit of hits) {
      if (hit.object === this.dome.mesh) {
        const i = hit.faceIndex !== undefined && hit.faceIndex !== null ? this.dome.faceToPost[hit.faceIndex] : -1;
        const post = i >= 0 ? this.dome.posts[i] : undefined;
        if (post && (this.mode === 'both' || post.site === this.mode)) return postKey(post);
        continue; // empty tile: look further along the ray
      }
      if (hit.object === this.storyMap.mesh) {
        const key = hit.faceIndex !== undefined && hit.faceIndex !== null ? this.storyMap.postAt(hit.faceIndex) : null;
        if (key) return key;
        continue;
      }
      const key = (hit.object.userData.key as string | undefined) ?? this.faceOwner(hit.object);
      if (key) return key;
    }
    return null;
  }

  private faceOwner(o: THREE.Object3D): string | null {
    for (const v of this.views.values()) if (v.face === o || v.twin.face === o) return v.key;
    return null;
  }

  private onPointerMove = (ev: PointerEvent) => {
    const key = this.pick(ev);
    if (key !== this.hovered) {
      this.hovered = key;
      this.renderer.domElement.style.cursor = key ? 'pointer' : 'grab';
    }
    this.cb.onHover(key, ev.clientX, ev.clientY);
  };

  private onPointerDown = (ev: PointerEvent) => {
    this.downAt = { x: ev.clientX, y: ev.clientY };
  };

  private onPointerUp = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y) > 5) return; // a drag, not a click
    this.cb.onSelect(this.pick(ev));
  };

  private onResize = () => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.bloom.updateSize(w, h);
    this.ghostMats.forEach((m) => m.resolution.set(w, h));
    this.hotMats.forEach((m) => m.resolution.set(w, h));
  };

  private stepMorph() {
    const m = this.morph!;
    const k = Math.min(1, (performance.now() - m.t0) / m.ms);
    const to = this.layouts[this.view];
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    let i = 0;
    const n = this.views.size;
    for (const v of this.views.values()) {
      // Stagger so the boxes stream into place instead of jumping together.
      const delay = 0.3 * (i++ / n);
      const e = ease(Math.min(1, Math.max(0, (k - delay) / 0.7)));
      const lerp = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e });
      v.base = lerp(m.from.get(v.key)!, to.get(v.key)!);
      this.place(v);
      const twinTo = this.view === 'mirror' ? this.layouts.mirrorDe.get(v.key)! : to.get(v.key)!;
      v.twin.base = lerp(m.twinFrom.get(v.key)!, twinTo);
      this.place(v.twin);
      this.labels.move(v.key, this.anchor(v));
      this.labels.move(`twin:${v.key}`, this.anchor(v.twin));
    }
    if (k === 1) {
      this.morph = null;
      this.applyStyle();
      this.refreshFocus();
    }
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const t = this.clock.getElapsedTime();
    if (this.flight) {
      const f = this.flight;
      const k = Math.min(1, (performance.now() - f.t0) / f.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // cubic in-out, as in the Cube
      const lerp = (a: CameraKeyframe['target'], b: CameraKeyframe['target']) =>
        new THREE.Vector3(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e);
      this.camera.position.copy(lerp(f.from.position, f.to.position));
      this.controls.target.copy(lerp(f.from.target, f.to.target));
      if (k === 1) {
        this.flight = null;
        f.done?.();
      }
    }
    if (this.morph) this.stepMorph();
    if (this.system.group.visible) this.system.animate(t);
    if (this.live.group.visible) this.live.tick(t);
    const fade = this.dome.group.visible ? this.dome.updateLod(this.camera, !!this.selected || !!this.filter) : null;
    this.depthFade(fade);
    const sky = this.photoSky.material;
    sky.opacity += (this.photoSkyTarget - sky.opacity) * 0.04;
    const v = this.selected ? this.views.get(this.selected) : undefined;
    if (v && !v.face) {
      for (const b of this.view === 'mirror' ? [v, v.twin] : [v]) {
        const s = b.size * (1 + 0.12 * Math.sin(t * 4));
        b.mesh.scale.setScalar(s);
        b.outline.scale.setScalar(s * 1.04);
        b.mesh.rotation.y = b.outline.rotation.y = t * 0.8;
      }
    }
    this.controls.update();
    const { clientWidth: w, clientHeight: h } = this.container;
    // Labels anchor to the interior entity shells, not the geographic surface.
    // Hide the entire label layer outside, including selections and live labels.
    const outside = this.view === 'graph' && this.camera.position.length() > DOME_R;
    this.labels.group.visible = !outside;
    if (!outside) this.labels.update(this.camera, w, h, this.view, undefined, fade, this.view === 'graph' ? THREE.MathUtils.lerp(0.62, 1, this.globeDetail.value) : 1);
    this.bloom.composer.render();
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.labelScene, this.camera);
    this.renderer.autoClear = true;
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.bloom.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
