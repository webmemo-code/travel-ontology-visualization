// Authors appear as their own faces instead of boxes: a round photo with a
// glowing rim, drawn into a canvas once the image arrives.
import * as THREE from 'three';

export function makePortrait(id: string, rim: string): THREE.Sprite {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: '#b8b8b8' }));

  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d')!;
    const r = size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 10, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);
    ctx.restore();
    ctx.lineWidth = 10;
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.arc(r, r, r - 6, 0, Math.PI * 2);
    ctx.stroke();
    tex.needsUpdate = true;
  };
  img.src = `faces/${id}.png`;
  return sprite;
}

/** Soft additive halo used to mark top-performing entities. */
export function haloTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Countries show their flag as a card, Swiss cantons their coat of arms,
 * organizations their logo on a white disc (logos are drawn for light
 * backgrounds and often transparent).
 * userData.aspect tells the scene how wide to scale the sprite.
 */
export function makeEmblem(url: string, kind: 'flag' | 'logo' | 'arms', rim: string): THREE.Sprite {
  const w = kind === 'flag' ? 300 : kind === 'arms' ? 216 : 256;
  const h = kind === 'flag' ? 200 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Slightly dimmed and see-through, so emblems sit in the scene instead of on top of it.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: '#c8c8c8', opacity: 0.9 }));
  sprite.userData.aspect = w / h;

  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d')!;
    if (kind === 'arms') {
      // A coat of arms is already a shield with its own outline: draw it as is.
      const s = Math.min(w / img.width, h / img.height) * 0.94;
      ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
    } else if (kind === 'flag') {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(6, 6, w - 12, h - 12, 18);
      ctx.clip();
      const s = Math.max((w - 12) / img.width, (h - 12) / img.height);
      ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.roundRect(6, 6, w - 12, h - 12, 18);
      ctx.stroke();
    } else {
      const r = w / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(r, r, r - 8, 0, Math.PI * 2);
      ctx.fill();
      const box = (r - 8) * 1.3; // logo fits inside the disc with a margin
      const s = Math.min(box / img.width, box / img.height);
      ctx.drawImage(img, r - (img.width * s) / 2, r - (img.height * s) / 2, img.width * s, img.height * s);
      ctx.lineWidth = 8;
      ctx.strokeStyle = rim;
      ctx.beginPath();
      ctx.arc(r, r, r - 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    tex.needsUpdate = true;
  };
  img.src = url;
  return sprite;
}
