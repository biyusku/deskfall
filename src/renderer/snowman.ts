import { SNOWMAN } from './config';
import { clamp, rand, type Interval } from './geometry';
import type { Particles } from './particles';
import type { Surface } from './surfaces';

interface Ball {
  r: number;
  angle: number;
  /** Vertical animation offset (negative = above rest position). */
  dropY: number;
  dropV: number;
}

interface Stack {
  id: number;
  x: number;
  balls: Ball[];
  decoratedAt: number;
  hat: boolean;
  scarf: string;
  facing: number;
  nextBlink: number;
  blinkUntil: number;
}

/**
 * holding: the ball follows the pointer. Near the ground it sits on the snow and rolls
 * (growing as it picks snow up); lifted higher it is carried and can be dropped on a stack.
 */
type Gesture =
  | { kind: 'none' }
  | { kind: 'pending'; stack: Stack; startX: number; startY: number }
  | { kind: 'holding'; ball: Ball; x: number; y: number; grounded: boolean };

export interface Cursor {
  x: number;
  y: number;
}

const SCARF_COLORS = ['#d62839', '#2a9d8f', '#3a6ff7', '#e76f51', '#8e44ad'];
const DROP_GRAVITY = 1500;
const BOUNCE_MIN_SPEED = 140;
const BOUNCE_DAMPING = 0.3;
const POP_MS = 450;
const FACE_FOLLOW = 3;
const CRUMBLE_RETURN = 0.6;

/** Overshooting ease; clamped at 0 because float rounding gives -2e-16 at t=0 (negative arc radius throws). */
export function easeOutBack(t: number): number {
  const c = 1.7;
  const u = clamp(t, 0, 1) - 1;
  return Math.max(0, 1 + (c + 1) * u * u * u + c * u * u);
}

export class SnowmanWorld {
  private stacks: Stack[] = [];
  private gesture: Gesture = { kind: 'none' };
  private nextId = 1;
  private lastDown = { time: 0, stackId: -1 };

  get busy(): boolean {
    return this.gesture.kind !== 'none';
  }

  get holding(): boolean {
    return this.gesture.kind === 'holding';
  }

  obstacles(): Interval[] {
    const list = this.stacks.map((s) => ({ start: s.x - s.balls[0].r - 3, end: s.x + s.balls[0].r + 3 }));
    const g = this.gesture;
    if (g.kind === 'holding' && g.grounded) list.push({ start: g.x - g.ball.r - 3, end: g.x + g.ball.r + 3 });
    return list;
  }

  /** True when the pointer is over something the user can grab. */
  wantsPointer(x: number, y: number, floor: Surface | null): boolean {
    if (this.busy) return true;
    if (this.hitStack(x, y, floor)) return true;
    return this.onSnow(x, y, floor);
  }

  clear(): void {
    this.stacks = [];
    this.gesture = { kind: 'none' };
  }

  pointerDown(x: number, y: number, floor: Surface | null, now: number): boolean {
    if (!floor) return false;
    const hit = this.hitStack(x, y, floor);
    if (hit) {
      const isDouble = now - this.lastDown.time < SNOWMAN.doubleClickMs && this.lastDown.stackId === hit.id;
      this.lastDown = { time: now, stackId: hit.id };
      if (isDouble) return true;
      this.gesture = { kind: 'pending', stack: hit, startX: x, startY: y };
      return true;
    }
    this.lastDown = { time: now, stackId: -1 };
    if (!this.onSnow(x, y, floor)) return false;
    const ball: Ball = { r: SNOWMAN.startRadius, angle: 0, dropY: 0, dropV: 0 };
    const bx = this.freeX(x, ball.r, null, floor);
    floor.layer.take(bx - floor.rect.x - 4, bx - floor.rect.x + 4, 1, 6);
    this.gesture = { kind: 'holding', ball, x: bx, y: this.groundCenter(bx, ball.r, floor), grounded: true };
    return true;
  }

  /** Double click: knock a snowman over. Returns true when something crumbled. */
  doubleClick(x: number, y: number, floor: Surface | null, fx: Particles): boolean {
    const hit = this.hitStack(x, y, floor);
    if (!hit || !floor) return false;
    this.gesture = { kind: 'none' };
    const centers = this.centers(hit, floor);
    hit.balls.forEach((ball, i) => {
      fx.burst(hit.x, centers[i], rand(-60, 60), -80, Math.round(ball.r * 1.6));
      floor.layer.deposit(hit.x - floor.rect.x, ball.r * CRUMBLE_RETURN);
    });
    this.stacks = this.stacks.filter((s) => s !== hit);
    return true;
  }

  pointerMove(x: number, y: number, floor: Surface | null): void {
    if (!floor) return;
    const g = this.gesture;
    if (g.kind === 'pending') this.resolvePending(g, x, y);
    if (this.gesture.kind === 'holding') this.moveHeld(this.gesture, x, y, floor);
  }

  pointerUp(floor: Surface | null, now: number, fx: Particles): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind !== 'holding' || !floor) return;
    const target = g.grounded ? null : this.stackTarget(g.x, g.y, g.ball, floor);
    if (target) {
      const topY = this.centers(target, floor).at(-1) ?? g.y;
      const top = target.balls[target.balls.length - 1];
      g.ball.dropY = Math.min(0, g.y - (topY - (top.r + g.ball.r) * SNOWMAN.stackOverlap));
      g.ball.dropV = 0;
      target.balls.push(g.ball);
      this.onStackGrew(target, floor, now, fx);
      return;
    }
    const stack = this.newStack(this.freeX(g.x, g.ball.r, null, floor), g.ball);
    g.ball.dropY = Math.min(0, g.y - this.groundCenter(stack.x, g.ball.r, floor));
    g.ball.dropV = 0;
    this.stacks.push(stack);
  }

  update(dt: number, now: number, cursor: Cursor | null): void {
    for (const s of this.stacks) {
      for (const b of s.balls) this.animateDrop(b, dt);
      if (now > s.nextBlink) {
        s.blinkUntil = now + 140;
        s.nextBlink = now + rand(2500, 6000);
      }
      const wanted = cursor ? Math.sign(cursor.x - s.x) || 1 : s.facing;
      s.facing += (wanted - s.facing) * Math.min(1, dt * FACE_FOLLOW);
    }
  }

  draw(ctx: CanvasRenderingContext2D, floor: Surface | null, time: number, now: number, cursor: Cursor | null): void {
    if (!floor) return;
    for (const s of this.stacks) this.drawStack(ctx, s, floor, time, now, cursor);
    const g = this.gesture;
    if (g.kind === 'holding') drawBall(ctx, g.x, g.y, g.ball.r, g.ball.angle);
  }

  // ----- gestures -----

  /** Picks up the top ball once the pointer moved a few px from where it was pressed. */
  private resolvePending(g: Extract<Gesture, { kind: 'pending' }>, x: number, y: number): void {
    if (Math.hypot(x - g.startX, y - g.startY) < SNOWMAN.rollThreshold) return;
    const ball = g.stack.balls.pop();
    if (!ball) return;
    ball.dropY = 0;
    ball.dropV = 0;
    if (g.stack.balls.length === 0) this.stacks = this.stacks.filter((s) => s !== g.stack);
    else if (g.stack.balls.length < 2) g.stack.decoratedAt = 0;
    this.gesture = { kind: 'holding', ball, x, y, grounded: false };
  }

  /** Near the ground the held ball rolls on the snow and grows; higher up it is carried. */
  private moveHeld(g: Extract<Gesture, { kind: 'holding' }>, x: number, y: number, floor: Surface): void {
    const ball = g.ball;
    const restY = this.groundCenter(x, ball.r, floor);
    const touchesGround = y >= restY - ball.r * SNOWMAN.liftRatio;
    if (!touchesGround) {
      g.x = x;
      g.y = y;
      g.grounded = false;
      return;
    }
    const target = this.freeX(x, ball.r, null, floor);
    if (g.grounded) {
      const d = clamp(target - g.x, -SNOWMAN.maxRollStep, SNOWMAN.maxRollStep);
      ball.angle += d / ball.r;
      const lx = g.x + d - floor.rect.x;
      const removed = floor.layer.take(lx - ball.r * 0.6, lx + ball.r * 0.6, 1, Math.abs(d) * SNOWMAN.takePerPixel);
      ball.r = Math.min(SNOWMAN.maxRadius, Math.sqrt(ball.r * ball.r + removed * SNOWMAN.growFactor));
      g.x += d;
    } else {
      g.x = target;
    }
    g.y = this.groundCenter(g.x, ball.r, floor);
    g.grounded = true;
  }

  private stackTarget(x: number, y: number, ball: Ball, floor: Surface): Stack | null {
    for (const s of this.stacks) {
      const top = s.balls[s.balls.length - 1];
      const topY = this.centers(s, floor).at(-1) ?? 0;
      const near = Math.abs(s.x - x) < top.r + ball.r * 0.4 && y < topY + top.r * 0.5;
      if (near && s.balls.length < SNOWMAN.maxStack && ball.r <= top.r * 1.1) return s;
    }
    return null;
  }

  private onStackGrew(stack: Stack, floor: Surface, now: number, fx: Particles): void {
    const centers = this.centers(stack, floor);
    const headY = centers.at(-1) ?? 0;
    if (stack.balls.length >= 2 && stack.decoratedAt === 0) {
      stack.decoratedAt = now;
      stack.scarf = SCARF_COLORS[Math.floor(Math.random() * SCARF_COLORS.length)];
      fx.sparkle(stack.x, headY, 18);
    }
    if (stack.balls.length === SNOWMAN.maxStack) {
      stack.hat = Math.random() < SNOWMAN.hatChance;
      stack.decoratedAt = now;
      fx.sparkle(stack.x, headY, 36);
    }
  }

  // ----- geometry -----

  private newStack(x: number, ball: Ball): Stack {
    return {
      id: this.nextId++,
      x,
      balls: [ball],
      decoratedAt: 0,
      hat: false,
      scarf: SCARF_COLORS[0],
      facing: 1,
      nextBlink: performance.now() + rand(1500, 4000),
      blinkUntil: 0,
    };
  }

  /** Closest x to `wanted` where a ball of radius r fits without overlapping other stacks. */
  private freeX(wanted: number, r: number, self: Stack | null, floor: Surface): number {
    let x = clamp(wanted, floor.rect.x + r, floor.rect.x + floor.rect.width - r);
    const from = self ? self.x : x;
    for (const s of this.stacks) {
      if (s === self) continue;
      const gap = s.balls[0].r + r;
      if (Math.abs(x - s.x) >= gap) continue;
      x = from <= s.x ? s.x - gap : s.x + gap;
    }
    return x;
  }

  private groundCenter(x: number, r: number, floor: Surface): number {
    const ground = floor.rect.y - floor.layer.heightAt(x - floor.rect.x) * 0.7;
    return ground - r + r * SNOWMAN.sinkRatio;
  }

  private centers(stack: Stack, floor: Surface): number[] {
    const ys: number[] = [];
    stack.balls.forEach((b, i) => {
      const rest = i === 0 ? this.groundCenter(stack.x, b.r, floor) : ys[i - 1] - (stack.balls[i - 1].r + b.r) * SNOWMAN.stackOverlap;
      ys.push(rest);
    });
    return ys.map((y, i) => y + stack.balls[i].dropY);
  }

  private hitStack(x: number, y: number, floor: Surface | null): Stack | null {
    if (!floor) return null;
    for (const s of this.stacks) {
      const ys = this.centers(s, floor);
      const headR = s.balls[s.balls.length - 1].r;
      const hatRoom = s.hat ? headR * 1.2 : 0;
      if (s.balls.some((b, i) => Math.hypot(x - s.x, y - ys[i]) <= b.r + 4)) return s;
      // The part of the bottom ball buried in the snow counts too.
      if (Math.abs(x - s.x) <= s.balls[0].r && y >= ys[0] && y <= floor.rect.y) return s;
      if (hatRoom > 0 && Math.abs(x - s.x) < headR && y < (ys.at(-1) ?? 0) && y > (ys.at(-1) ?? 0) - headR - hatRoom) return s;
    }
    return null;
  }

  private onSnow(x: number, y: number, floor: Surface | null): boolean {
    if (!floor || floor.kind === 'ground') return false;
    const lx = x - floor.rect.x;
    if (lx < 0 || lx > floor.rect.width) return false;
    const h = floor.layer.heightAt(lx);
    return h >= SNOWMAN.minSnowToRoll && y >= floor.rect.y - h - 4 && y < floor.rect.y;
  }

  private animateDrop(b: Ball, dt: number): void {
    if (b.dropY === 0 && b.dropV === 0) return;
    b.dropV += DROP_GRAVITY * dt;
    b.dropY += b.dropV * dt;
    if (b.dropY < 0) return;
    b.dropY = 0;
    b.dropV = b.dropV > BOUNCE_MIN_SPEED ? -b.dropV * BOUNCE_DAMPING : 0;
  }

  // ----- drawing -----

  private drawStack(ctx: CanvasRenderingContext2D, s: Stack, floor: Surface, time: number, now: number, cursor: Cursor | null): void {
    const ys = this.centers(s, floor);
    const bottom = s.balls[0];
    const groundY = floor.rect.y - floor.layer.heightAt(s.x - floor.rect.x) * 0.7;
    ctx.fillStyle = 'rgba(40,60,100,0.18)';
    ctx.beginPath();
    ctx.ellipse(s.x, groundY, bottom.r * 1.05, bottom.r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    const decorated = s.balls.length >= 2 && s.decoratedAt > 0;
    const pop = decorated ? easeOutBack(clamp((now - s.decoratedAt) / POP_MS, 0, 1)) : 0;
    const headIndex = s.balls.length - 1;
    const bodyIndex = headIndex - 1;
    const f = clamp(s.facing, -1, 1);

    if (decorated) {
      const near = cursor !== null && Math.hypot(cursor.x - s.x, cursor.y - ys[bodyIndex]) < SNOWMAN.waveDistance;
      drawArms(ctx, s.x, ys[bodyIndex], s.balls[bodyIndex].r, pop, near ? time : -1);
    }
    s.balls.forEach((b, i) => drawBall(ctx, s.x, ys[i], b.r, b.angle));
    if (!decorated) return;

    const head = s.balls[headIndex];
    const hy = ys[headIndex];
    drawButtons(ctx, s.x, ys[bodyIndex], s.balls[bodyIndex].r, pop);
    drawScarf(ctx, s.x, hy + head.r * 0.82, head.r, s.scarf, f, time, pop);
    drawFace(ctx, s.x, hy, head.r, f, cursor, now < s.blinkUntil, pop);
    if (s.hat) drawHat(ctx, s.x, hy, head.r, f, pop);
  }
}

export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#eef3fb');
  g.addColorStop(1, '#b9c9df');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(140,160,195,0.3)';
  for (let k = 0; k < 5; k++) {
    const a = angle + k * 1.9;
    const rr = r * (k % 2 === 0 ? 0.55 : 0.3);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9, Math.max(0.6, r * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  R: number,
  f: number,
  cursor: Cursor | null,
  blinking: boolean,
  pop: number,
): void {
  const coal = '#1d1f27';
  const eyeR = Math.max(1.2, R * 0.1) * pop;
  const look = cursor ? Math.atan2(cursor.y - hy, cursor.x - hx) : 0;
  const lookOffset = cursor ? R * 0.035 : 0;
  ctx.fillStyle = coal;
  for (const side of [-1, 1]) {
    const ex = hx + side * R * 0.3 + f * R * 0.1 + Math.cos(look) * lookOffset;
    const ey = hy - R * 0.2 + Math.sin(look) * lookOffset;
    ctx.beginPath();
    if (blinking) ctx.ellipse(ex, ey, eyeR, eyeR * 0.2, 0, 0, Math.PI * 2);
    else ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
  // Carrot nose
  const baseX = hx + f * R * 0.12;
  const baseY = hy + R * 0.02;
  const tipX = hx + f * R * 0.85 * pop;
  const g = ctx.createLinearGradient(baseX, baseY, tipX, baseY);
  g.addColorStop(0, '#ff8a1e');
  g.addColorStop(1, '#e85d04');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY - R * 0.09);
  ctx.lineTo(tipX, baseY + R * 0.1);
  ctx.lineTo(baseX, baseY + R * 0.11);
  ctx.closePath();
  ctx.fill();
  // Smile
  ctx.fillStyle = coal;
  for (let k = -2; k <= 2; k++) {
    const mx = hx + k * R * 0.14 + f * R * 0.06;
    const my = hy + R * 0.36 - (Math.abs(k) === 2 ? R * 0.08 : Math.abs(k) === 1 ? R * 0.015 : 0);
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(0.8, R * 0.05) * pop, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScarf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  color: string,
  f: number,
  time: number,
  pop: number,
): void {
  const w = R * 1.9 * pop;
  const h = R * 0.34;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  // Tail
  const tailX = x - f * R * 0.45;
  const sway = Math.sin(time * 2.6) * 0.12;
  ctx.save();
  ctx.translate(tailX, y);
  ctx.rotate(sway - f * 0.15);
  ctx.beginPath();
  ctx.roundRect(-R * 0.15, 0, R * 0.3, R * 1.0 * pop, R * 0.08);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let k = 1; k <= 2; k++) ctx.fillRect(-R * 0.15, R * 0.28 * k * pop, R * 0.3, R * 0.07);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let k = -2; k <= 2; k++) ctx.fillRect(x + k * R * 0.32 - R * 0.035, y - h / 2, R * 0.07, h);
}

function drawHat(ctx: CanvasRenderingContext2D, hx: number, hy: number, R: number, f: number, pop: number): void {
  ctx.save();
  ctx.translate(hx, hy - R * 0.78);
  ctx.rotate(-0.14 * f);
  ctx.scale(pop, pop);
  ctx.fillStyle = '#17181d';
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.78, R * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-R * 0.48, -R * 0.9, R * 0.96, R * 0.9);
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(-R * 0.48, -R * 0.28, R * 0.96, R * 0.17);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.9, R * 0.48, R * 0.1, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawButtons(ctx: CanvasRenderingContext2D, bx: number, by: number, R: number, pop: number): void {
  ctx.fillStyle = '#1d1f27';
  for (const t of [-0.45, -0.1, 0.25]) {
    ctx.beginPath();
    ctx.arc(bx, by + R * t, Math.max(1, R * 0.08) * pop, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawArms(ctx: CanvasRenderingContext2D, bx: number, by: number, R: number, pop: number, waveTime: number): void {
  ctx.strokeStyle = '#5b3a1e';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, R * 0.08);
  for (const side of [-1, 1]) {
    const wave = side === 1 && waveTime >= 0 ? Math.sin(waveTime * 9) * 0.35 - 0.35 : 0;
    ctx.save();
    ctx.translate(bx + side * R * 0.7, by - R * 0.25);
    ctx.rotate(side * (-0.55 + wave));
    const len = R * 1.05 * pop;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(side * len, 0);
    ctx.moveTo(side * len * 0.7, 0);
    ctx.lineTo(side * len * 0.95, -len * 0.25);
    ctx.moveTo(side * len * 0.8, 0);
    ctx.lineTo(side * len * 1.05, len * 0.15);
    ctx.stroke();
    ctx.restore();
  }
}
