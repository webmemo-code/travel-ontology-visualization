// The article dome: a geodesic sphere whose triangles are articles, seen from
// the inside. Countries are patches of faces sized by article count (see
// globe.cartogram); true borders are drawn by GraphScene's gold ghost lines.
// Unused triangles stay as bare wireframe.
import * as THREE from 'three';
import { DOME_R, cartogram, postKey } from '../data/globe';
import type { Vec3 } from '../data/model';
import type { Graph, GraphPost } from '../data/types';
import { fadeRange, withDepthFade } from './depthFade';

const DETAIL = 10; // 20 * 11^2 = 2420 triangles for ~1150 articles
const INSET = 0.72; // shrink each tile toward its centre so the mosaic shows gaps

export interface Dome {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  posts: GraphPost[];
  /** face index -> post index, or -1 */
  faceToPost: Int32Array;
  postFace: Map<string, number>;
  /** face index -> country key, or null */
  faceRegion: (string | null)[];
  centers: THREE.Vector3[];
  /** near = colour multiplying the photo up close; far = plain tile colour beyond the photo depth. */
  paint: (rgba: (post: GraphPost) => { near: number[]; far: number[] } | null) => void;
  /** Show photos only on tiles in the nearest sixth of the visible depth; dim tiles beyond it. Returns that depth range. */
  updateLod: (camera: THREE.Camera, focused?: boolean) => { from: number; far: number };
  /** Map each article's tile to its cell in the photo atlas. */
  setAtlas: (tex: THREE.Texture, atlas: AtlasIndex) => void;
  hasPhoto: (post: GraphPost) => boolean;
}

export interface AtlasIndex {
  cell: number;
  cols: number;
  size: number;
  index: Record<string, number>;
  src: Record<string, string>;
}

/**
 * The article shell for the "How it works" mini globe: the same tiles in their
 * plain EN/DE colours (no photos, no level of detail), sharing the dome's
 * geometry, so a repaint shows on both. Scale and place it as the caller needs.
 */
export function miniDome(dome: Dome): THREE.Group {
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 colorFar;
        varying vec4 vColorFar;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vColorFar = colorFar;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vColorFar;`)
      .replace('#include <color_fragment>', 'diffuseColor = vColorFar;');
  };
  const mesh = new THREE.Mesh(dome.mesh.geometry, material);
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(DOME_R * 1.002, DETAIL)),
    new THREE.LineBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.08, depthWrite: false }),
  );
  mesh.renderOrder = wire.renderOrder = -1;
  const group = new THREE.Group();
  group.add(mesh, wire);
  return group;
}

export function buildDome(graph: Graph, pos: Map<string, Vec3>): Dome {
  const geo = new THREE.IcosahedronGeometry(DOME_R, DETAIL); // non-indexed: 3 vertices per face
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const faces = p.count / 3;
  const corners: THREE.Vector3[][] = [];
  const centers: THREE.Vector3[] = [];
  for (let f = 0; f < faces; f++) {
    const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, f * 3 + k));
    corners.push(v);
    centers.push(v[0].clone().add(v[1]).add(v[2]).divideScalar(3));
  }

  // Borders run along shared triangle edges, so find each edge's two faces.
  const vkey = (v: THREE.Vector3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
  const edges = new Map<string, { faces: number[]; a: THREE.Vector3; b: THREE.Vector3 }>();
  corners.forEach((v, f) => {
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      const key = [vkey(a), vkey(b)].sort().join('|');
      const e = edges.get(key) ?? { faces: [], a, b };
      e.faces.push(f);
      edges.set(key, e);
    }
  });
  const posts = graph.posts;
  const unit = centers.map((c) => c.clone().normalize().toArray() as [number, number, number]);
  const neighbours: number[][] = Array.from({ length: faces }, () => []);
  for (const e of edges.values()) {
    if (e.faces.length !== 2) continue;
    neighbours[e.faces[0]].push(e.faces[1]);
    neighbours[e.faces[1]].push(e.faces[0]);
  }
  const { tile, faceRegion } = cartogram(graph, pos, unit, neighbours);

  const faceToPost = new Int32Array(faces).fill(-1);
  const postFace = new Map<string, number>();
  tile.forEach((f, i) => {
    if (f < 0) return;
    faceToPost[f] = i;
    postFace.set(postKey(posts[i]), f);
  });

  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const v = corners[f][k].clone().lerp(centers[f], 1 - INSET);
      p.setXYZ(f * 3 + k, v.x, v.y, v.z);
    }
  }
  const colors = new Float32Array(faces * 3 * 4);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  const farColors = new Float32Array(faces * 3 * 4);
  geo.setAttribute('colorFar', new THREE.BufferAttribute(farColors, 4));
  const uvs = new Float32Array(faces * 3 * 2);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  let photos: AtlasIndex | null = null;
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  // Level of detail: a photo shows only while its tile is in the nearest sixth
  // of the depth the dome spans from the camera; further back it fades to the
  // plain EN/DE tile colour, so a wide view stays calm instead of a collage.
  const lod = { uLod: { value: 1e6 }, uBand: { value: 1 }, uOverview: { value: 0 }, uPhotoDetail: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lod);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 colorFar;
        varying vec4 vColorFar;
        varying float vLodDepth;
        varying vec3 vTileNormal;
        varying vec3 vTileView;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vColorFar = colorFar;
        vLodDepth = -mvPosition.z;
        vTileNormal = normalMatrix * normal;
        vTileView = -mvPosition.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uLod;
        uniform float uBand;
        uniform float uOverview;
        uniform float uPhotoDetail;
        varying vec4 vColorFar;
        varying float vLodDepth;
        varying vec3 vTileNormal;
        varying vec3 vTileView;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 photo = texture2D( map, vMapUv );
          // Mostly desaturated, so the site tint carries the colour and the mosaic reads as texture, not a collage.
          photo.rgb = mix( vec3( dot( photo.rgb, vec3( 0.299, 0.587, 0.114 ) ) ), photo.rgb, 0.3 );
          vec4 nearColor = diffuseColor * vColor * photo;
          float lodMix = (1.0 - smoothstep( uLod - uBand, uLod + uBand, vLodDepth )) * uPhotoDetail;
          diffuseColor = mix( vColorFar, nearColor, lodMix );
        #else
          diffuseColor = vColorFar;
        #endif
        float grey = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
        // Keep the EN/DE colours in the overview, with a restrained moving
        // highlight as the globe turns. Photos retain their existing exposure.
        diffuseColor.rgb = mix( vec3( grey ) * 0.7, diffuseColor.rgb, mix( 0.78, 1.0, uOverview ) );
        vec3 halfLight = normalize( normalize( vTileView ) + normalize( vec3( -0.45, 0.65, 1.0 ) ) );
        float sheen = pow( abs( dot( normalize( vTileNormal ), halfLight ) ), 24.0 );
        diffuseColor.rgb *= mix( 1.15 + 0.3 * sheen, 1.0, uOverview );
        diffuseColor.a *= mix( 0.3, 1.0, uOverview );`,
      )
      // Vertex colour is already applied above, per depth; do not multiply it in twice.
      .replace('#include <color_fragment>', '');
  };
  withDepthFade(material, 0.7, 0.4);
  const mesh = new THREE.Mesh(geo, material);

  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(DOME_R * 1.002, DETAIL)),
    new THREE.LineBasicMaterial({ color: '#4FC3F7', transparent: true, opacity: 0.08, depthWrite: false }),
  );
  withDepthFade(wire.material, 0.7, 0.7);

  // The dome is the outermost shell: draw it first so everything inside
  // composites over it. Transparent sorting by object centre would otherwise
  // put the whole sphere (centre = origin) in front of things nearer its skin.
  mesh.renderOrder = wire.renderOrder = -1;
  const group = new THREE.Group();
  group.add(mesh, wire);

  const paint: Dome['paint'] = (rgba) => {
    for (let f = 0; f < faces; f++) {
      const i = faceToPost[f];
      const c = i >= 0 ? rgba(posts[i]) : null;
      for (let k = 0; k < 3; k++) {
        colors.set(c?.near ?? [0, 0, 0, 0], (f * 3 + k) * 4);
        farColors.set(c?.far ?? [0, 0, 0, 0], (f * 3 + k) * 4);
      }
    }
    geo.getAttribute('color').needsUpdate = true;
    geo.getAttribute('colorFar').needsUpdate = true;
  };

  const updateLod: Dome['updateLod'] = (camera, focused = false) => {
    const d = camera.position.length();
    lod.uPhotoDetail.value = 1 - THREE.MathUtils.smoothstep(d, DOME_R * 0.8, DOME_R * 1.4);
    lod.uOverview.value = focused ? 1 : 1 - THREE.MathUtils.smoothstep(d, DOME_R * 0.9, DOME_R * 1.9);
    const near = Math.abs(d - DOME_R);
    const far = d + DOME_R;
    lod.uLod.value = near + (far - near) / 6;
    lod.uBand.value = (far - near) * 0.04;
    fadeRange.uFadeFrom.value = lod.uLod.value;
    fadeRange.uFadeFar.value = far;
    return { from: lod.uLod.value, far };
  };

  const setAtlas: Dome['setAtlas'] = (tex, atlas) => {
    photos = atlas;
    const c = 1 / atlas.cols;
    for (let f = 0; f < faces; f++) {
      const i = faceToPost[f];
      // Cell 0 is white, so a tile without a photo keeps its plain colour.
      const cell = i >= 0 ? atlas.index[postKey(posts[i])] ?? 0 : 0;
      const u0 = (cell % atlas.cols) * c;
      const v0 = 1 - (Math.floor(cell / atlas.cols) + 1) * c; // texture rows run top-down, v bottom-up
      // A triangle inscribed in the square cell, kept off the edges so mipmaps do not bleed neighbours in.
      uvs.set([u0 + 0.08 * c, v0 + 0.1 * c, u0 + 0.92 * c, v0 + 0.1 * c, u0 + 0.5 * c, v0 + 0.92 * c], f * 6);
    }
    geo.getAttribute('uv').needsUpdate = true;
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
  };

  return {
    group,
    mesh,
    posts,
    faceToPost,
    postFace,
    faceRegion,
    centers,
    paint,
    setAtlas,
    updateLod,
    hasPhoto: (post) => !!photos?.index[postKey(post)],
  };
}
