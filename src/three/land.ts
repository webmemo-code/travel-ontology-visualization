// A translucent geographic surface lets the continents read before the
// article cartogram and entity shells. Uses the same rotation as the borders.
import * as THREE from 'three';
import { geoEquirectangular, geoPath } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';
import { domeDirection } from '../data/globe';
import { withHorizonCull } from './depthFade';

export function buildLand(features: Feature<Geometry>[], radius: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const path = geoPath(geoEquirectangular().scale(canvas.width / (2 * Math.PI)).translate([canvas.width / 2, canvas.height / 2]), ctx);
  ctx.fillStyle = '#78959e';
  for (const feature of features) {
    ctx.beginPath();
    path(feature);
    ctx.fill();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const rows = 64;
  const cols = 128;
  const positions: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const d = domeDirection(90 - 180 * row / rows, -180 + 360 * col / cols);
      positions.push(d[0] * radius, d[1] * radius, d[2] * radius);
      uv.push(col / cols, 1 - row / rows);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * (cols + 1) + col;
      const b = a + cols + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  withHorizonCull(material, radius);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -2;
  return mesh;
}
