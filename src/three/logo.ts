// The blogs' logos as textures. The logo files are light text on transparent
// PNGs: they are painted onto the blog's colour, darkened a little so the
// lettering reads. Reisememo's file carries its bar icon; Travelmemo's header
// logo is the wordmark alone, so its site icon is drawn in front of it.
import * as THREE from 'three';

const ICONS: Record<string, string> = { travelmemo: 'identity/organizations-travelmemo-icon.png' };
const loader = new THREE.TextureLoader();

/** A `w` x `h` canvas texture: the blog colour with icon + wordmark centred at 90% width. */
export async function logoTexture(site: string, color: string, w = 768, h = 256): Promise<THREE.CanvasTexture> {
  const icon = ICONS[site];
  const [mark, bars] = await Promise.all([loader.loadAsync(`identity/organizations-${site}.png`), icon ? loader.loadAsync(icon) : null]);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(8, 12, 24, 0.35)';
  ctx.fillRect(0, 0, w, h);
  const mw = mark.image.width;
  const mh = mark.image.height;
  const iw = bars ? mh * 1.15 : 0;
  const gap = bars ? mh * 0.2 : 0;
  const k = Math.min((w * 0.9) / (iw + gap + mw), (h * 0.8) / mh);
  const left = (w - (iw + gap + mw) * k) / 2;
  const top = (h - mh * k) / 2;
  if (bars) ctx.drawImage(bars.image, left, top - mh * k * 0.075, iw * k, iw * k);
  ctx.drawImage(mark.image, left + (iw + gap) * k, top, mw * k, mh * k);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
