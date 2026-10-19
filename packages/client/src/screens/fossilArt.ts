/**
 * Procedural fossil artwork for the cleaning minigame.
 * Draws a skull, ribcage, arm bones or leg bones into a canvas; the cleaning grid samples the result
 * for its fossil mask and shows the pixels as the rock is cleared away.
 */
import { nextRandom } from '@ffo/shared';

export type BoneStyle = 'normal' | 'red' | 'silver' | 'gold';

interface Palette {
  fill: string;
  shade: string;
  light: string;
  outline: string;
  detail: string;
}

const PALETTES: Record<BoneStyle, Palette> = {
  normal: { fill: '#efe3c4', shade: '#cdb88c', light: '#fff8e4', outline: '#4f371a', detail: '#8a6a3a' },
  red: { fill: '#ecc1ad', shade: '#c98f78', light: '#fde6da', outline: '#5a2a1c', detail: '#9a5a44' },
  silver: { fill: '#e2e8f0', shade: '#aab6c6', light: '#ffffff', outline: '#36414f', detail: '#6f7e92' },
  gold: { fill: '#f6d66b', shade: '#cfa427', light: '#fff2b8', outline: '#6b4a05', detail: '#a77f14' },
};

class Rand {
  constructor(private state: number) {}
  next() {
    const r = nextRandom(this.state);
    this.state = r.state;
    return r.value;
  }
  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }
}

function bone(ctx: CanvasRenderingContext2D, p: Palette, x1: number, y1: number, x2: number, y2: number, w: number, knobs = true) {
  const draw = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  draw(p.outline, w + 7);
  draw(p.shade, w + 1);
  draw(p.fill, w - 3);
  // highlight along the upper edge
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  ctx.strokeStyle = p.light;
  ctx.lineWidth = Math.max(1.5, w * 0.22);
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w * 0.22, y1 + ny * w * 0.22);
  ctx.lineTo(x2 + nx * w * 0.22, y2 + ny * w * 0.22);
  ctx.stroke();
  if (knobs) {
    for (const [kx, ky] of [[x1, y1], [x2, y2]] as const) knob(ctx, p, kx, ky, w * 0.85, nx, ny);
  }
}

function knob(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, r: number, nx = 0, ny = -1) {
  ctx.fillStyle = p.outline;
  ctx.beginPath();
  ctx.ellipse(x, y, r + 3.5, r * 0.8 + 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.shade;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.fill;
  ctx.beginPath();
  ctx.ellipse(x + nx * r * 0.2, y + ny * r * 0.2, r * 0.75, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

function outlinedPath(ctx: CanvasRenderingContext2D, p: Palette, path: Path2D, outlineWidth = 6) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = outlineWidth;
  ctx.stroke(path);
  ctx.fillStyle = p.fill;
  ctx.fill(path);
}

function hole(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.fillStyle = p.outline;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a1d10';
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.08, y + ry * 0.1, rx * 0.72, ry * 0.72, rot, 0, Math.PI * 2);
  ctx.fill();
}

function skull(ctx: CanvasRenderingContext2D, p: Palette, r: Rand, w: number, h: number) {
  const snoutLen = r.range(0.42, 0.55) * w;
  const craniumX = w * 0.68, craniumY = h * 0.38, crx = w * 0.26, cry = h * 0.3;
  const path = new Path2D();
  // Upper skull: cranium dome and tapering snout
  path.moveTo(craniumX + crx * 0.9, craniumY + cry * 0.9);
  path.quadraticCurveTo(craniumX + crx * 1.15, craniumY - cry * 0.6, craniumX, craniumY - cry);
  path.quadraticCurveTo(craniumX - crx * 0.9, craniumY - cry * 1.05, craniumX - crx * 1.1, craniumY - cry * 0.2);
  // snout top line to tip
  const tipX = craniumX - crx - snoutLen, tipY = h * 0.56;
  path.quadraticCurveTo(craniumX - crx - snoutLen * 0.5, h * 0.22, tipX, tipY);
  // snout bottom (upper jaw edge) back to cranium
  path.lineTo(tipX + 6, tipY + h * 0.08);
  path.lineTo(craniumX - crx * 0.4, h * 0.66);
  path.quadraticCurveTo(craniumX + crx * 0.5, h * 0.7, craniumX + crx * 0.9, craniumY + cry * 0.9);
  path.closePath();
  outlinedPath(ctx, p, path, 7);
  // optional crest
  if (r.next() < 0.35) {
    const crest = new Path2D();
    crest.moveTo(craniumX - crx * 0.2, craniumY - cry * 0.9);
    crest.quadraticCurveTo(craniumX + crx * 1.4, craniumY - cry * 2.2, craniumX + crx * 1.9, craniumY - cry * 1.1);
    crest.quadraticCurveTo(craniumX + crx * 1.2, craniumY - cry * 1.2, craniumX + crx * 0.9, craniumY - cry * 0.3);
    crest.closePath();
    outlinedPath(ctx, p, crest, 6);
  }
  // teeth on the upper jaw
  ctx.fillStyle = p.light;
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 2;
  const teeth = 6 + Math.floor(r.next() * 4);
  for (let i = 0; i < teeth; i++) {
    const t = i / (teeth - 1);
    const x = tipX + 10 + t * (craniumX - crx * 0.5 - tipX - 10);
    const y = tipY + h * 0.08 + t * (h * 0.66 - tipY - h * 0.08);
    const th = h * r.range(0.06, 0.1);
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 2);
    ctx.lineTo(x, y + th);
    ctx.lineTo(x + 4, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // lower jaw
  const jaw = new Path2D();
  jaw.moveTo(tipX + 8, tipY + h * 0.2);
  jaw.quadraticCurveTo(craniumX - crx * 0.3, h * 0.84, craniumX + crx * 0.95, h * 0.78);
  jaw.lineTo(craniumX + crx * 0.85, h * 0.92);
  jaw.quadraticCurveTo(craniumX - crx * 0.4, h * 0.98, tipX + 4, tipY + h * 0.32);
  jaw.closePath();
  outlinedPath(ctx, p, jaw, 6);
  // eye socket, fenestra, nostril
  hole(ctx, p, craniumX - crx * 0.15, craniumY + cry * 0.05, crx * 0.26, cry * 0.34);
  hole(ctx, p, craniumX + crx * 0.5, craniumY - cry * 0.05, crx * 0.2, cry * 0.3);
  hole(ctx, p, tipX + snoutLen * 0.22, tipY - h * 0.02, w * 0.03, h * 0.035);
  // shading streaks
  ctx.strokeStyle = p.shade;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    const sx = tipX + snoutLen * r.range(0.3, 0.9);
    ctx.moveTo(sx, h * r.range(0.3, 0.4));
    ctx.lineTo(sx + r.range(10, 30), h * r.range(0.5, 0.6));
    ctx.stroke();
  }
}

function ribcage(ctx: CanvasRenderingContext2D, p: Palette, r: Rand, w: number, h: number) {
  const ribs = 6 + Math.floor(r.next() * 3);
  const spineY = (t: number) => h * (0.22 + 0.08 * Math.sin(t * Math.PI));
  // ribs first (behind the spine)
  for (let i = 0; i < ribs; i++) {
    const t = 0.12 + (i / (ribs - 1)) * 0.72;
    const x = w * t, y = spineY(t);
    const len = h * r.range(0.5, 0.68) * (1 - Math.abs(t - 0.45) * 0.6);
    const curve = w * r.range(0.06, 0.12);
    const rib = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - curve * 1.4, y + len * 0.55, x - curve * 0.3, y + len);
      ctx.stroke();
    };
    rib(p.outline, 13);
    rib(p.shade, 8);
    rib(p.fill, 5);
  }
  // spine with vertebrae
  const segs = ribs + 4;
  for (let i = 0; i < segs; i++) {
    const t = 0.04 + (i / (segs - 1)) * 0.92;
    const x = w * t, y = spineY(t);
    const vw = w / segs * 0.8, vh = h * 0.09;
    ctx.fillStyle = p.outline;
    ctx.fillRect(x - vw / 2 - 2.5, y - vh / 2 - 2.5, vw + 5, vh + 5);
    ctx.fillStyle = p.shade;
    ctx.fillRect(x - vw / 2, y - vh / 2, vw, vh);
    ctx.fillStyle = p.fill;
    ctx.fillRect(x - vw / 2 + 1, y - vh / 2 + 1, vw - 2, vh * 0.55);
    // neural spine
    ctx.fillStyle = p.outline;
    ctx.fillRect(x - vw * 0.2 - 2, y - vh / 2 - h * 0.08 - 2, vw * 0.4 + 4, h * 0.08 + 4);
    ctx.fillStyle = p.fill;
    ctx.fillRect(x - vw * 0.2, y - vh / 2 - h * 0.08, vw * 0.4, h * 0.08 + 2);
  }
  // pelvis
  const px = w * 0.9, py = spineY(0.9) + h * 0.12;
  const pelvis = new Path2D();
  pelvis.moveTo(px - w * 0.1, py - h * 0.1);
  pelvis.quadraticCurveTo(px + w * 0.08, py - h * 0.16, px + w * 0.06, py + h * 0.05);
  pelvis.quadraticCurveTo(px + w * 0.02, py + h * 0.3, px - w * 0.06, py + h * 0.26);
  pelvis.quadraticCurveTo(px - w * 0.12, py + h * 0.08, px - w * 0.1, py - h * 0.1);
  pelvis.closePath();
  outlinedPath(ctx, p, pelvis, 6);
  hole(ctx, p, px - w * 0.03, py + h * 0.06, w * 0.03, h * 0.05);
}

function armBones(ctx: CanvasRenderingContext2D, p: Palette, r: Rand, w: number, h: number) {
  const sx = w * 0.12, sy = h * r.range(0.15, 0.3);
  const ex = w * r.range(0.42, 0.52), ey = h * r.range(0.5, 0.62);
  const wx = w * r.range(0.74, 0.82), wy = h * r.range(0.68, 0.8);
  const thick = Math.min(w, h) * 0.11;
  bone(ctx, p, sx, sy, ex, ey, thick); // humerus
  // radius and ulna
  const dx = wx - ex, dy = wy - ey, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  bone(ctx, p, ex + nx * thick * 0.55, ey + ny * thick * 0.55, wx + nx * thick * 0.45, wy + ny * thick * 0.45, thick * 0.75);
  bone(ctx, p, ex - nx * thick * 0.55, ey - ny * thick * 0.55, wx - nx * thick * 0.45, wy - ny * thick * 0.45, thick * 0.6);
  // hand: metacarpals and claws
  const fingers = 3;
  for (let i = 0; i < fingers; i++) {
    const ang = Math.atan2(dy, dx) + (i - 1) * 0.45 + r.range(-0.1, 0.1);
    const fl = w * r.range(0.08, 0.12);
    const fx = wx + Math.cos(ang) * fl, fy = wy + Math.sin(ang) * fl;
    bone(ctx, p, wx, wy, fx, fy, thick * 0.4, false);
    // claw
    const claw = new Path2D();
    const cl = fl * 0.9;
    claw.moveTo(fx, fy);
    claw.quadraticCurveTo(fx + Math.cos(ang) * cl * 0.7, fy + Math.sin(ang) * cl * 0.7 + cl * 0.3, fx + Math.cos(ang + 0.5) * cl, fy + Math.sin(ang + 0.5) * cl);
    claw.lineTo(fx + Math.cos(ang - 0.4) * thick * 0.25, fy + Math.sin(ang - 0.4) * thick * 0.25);
    claw.closePath();
    outlinedPath(ctx, p, claw, 4);
  }
  knob(ctx, p, sx, sy, thick * 1.1);
  knob(ctx, p, ex, ey, thick * 0.95);
}

function legBones(ctx: CanvasRenderingContext2D, p: Palette, r: Rand, w: number, h: number) {
  const hx = w * r.range(0.3, 0.42), hy = h * 0.08;
  const kx = w * r.range(0.52, 0.62), ky = h * r.range(0.46, 0.54);
  const ax = w * r.range(0.4, 0.5), ay = h * 0.84;
  const thick = Math.min(w, h) * 0.13;
  bone(ctx, p, hx, hy, kx, ky, thick); // femur
  const dx = ax - kx, dy = ay - ky, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  bone(ctx, p, kx + nx * thick * 0.5, ky + ny * thick * 0.5, ax + nx * thick * 0.4, ay + ny * thick * 0.4, thick * 0.8); // tibia
  bone(ctx, p, kx - nx * thick * 0.6, ky - ny * thick * 0.6, ax - nx * thick * 0.5, ay - ny * thick * 0.5, thick * 0.5); // fibula
  // foot: three toes forward
  for (let i = 0; i < 3; i++) {
    const ang = -0.35 + i * 0.35 + r.range(-0.08, 0.08);
    const tl = w * r.range(0.14, 0.2);
    const tx = ax + Math.cos(ang) * tl, ty = ay + Math.sin(ang) * tl * 0.5 + h * 0.04;
    bone(ctx, p, ax, ay + h * 0.02, tx, ty, thick * 0.45, false);
    const claw = new Path2D();
    claw.moveTo(tx, ty - thick * 0.2);
    claw.quadraticCurveTo(tx + tl * 0.35, ty - thick * 0.1, tx + tl * 0.4, ty + thick * 0.3);
    claw.lineTo(tx, ty + thick * 0.25);
    claw.closePath();
    outlinedPath(ctx, p, claw, 4);
  }
  knob(ctx, p, hx, hy, thick * 1.2);
  knob(ctx, p, kx, ky, thick);
  knob(ctx, p, ax, ay, thick * 0.8);
}

/** Draws the fossil for a part into `ctx` within the given box. */
export function drawFossil(ctx: CanvasRenderingContext2D, part: 'head' | 'body' | 'arms' | 'legs', style: BoneStyle, seed: number, box: { x: number; y: number; w: number; h: number }) {
  const p = PALETTES[style];
  const r = new Rand(seed || 1);
  ctx.save();
  ctx.translate(box.x, box.y);
  // slight random tilt
  const tilt = r.range(-0.18, 0.18);
  ctx.translate(box.w / 2, box.h / 2);
  ctx.rotate(tilt);
  ctx.translate(-box.w / 2, -box.h / 2);
  switch (part) {
    case 'head': skull(ctx, p, r, box.w, box.h); break;
    case 'body': ribcage(ctx, p, r, box.w, box.h); break;
    case 'arms': armBones(ctx, p, r, box.w, box.h); break;
    case 'legs': legBones(ctx, p, r, box.w, box.h); break;
  }
  ctx.restore();
}
