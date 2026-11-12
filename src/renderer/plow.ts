import { PLOW } from './config';
import { rand, type Interval } from './geometry';
import type { Particles } from './particles';
import type { Sprites } from './sprites';
import type { Surface } from './surfaces';

/** leaving: shooed away by a click — blade up, no plowing, hurrying off screen. */
type PlowState = 'idle' | 'driving' | 'blocked' | 'leaving';

const OFFSCREEN = 70;
const PUFF_EVERY = 0.35;
const BEACON_HZ = 2.2;
const BODY_HEIGHT = 15;
const TRACK_HEIGHT = 7;
const HONK_TEXT = '!';
const VEHICLE_HEIGHT = BODY_HEIGHT + TRACK_HEIGHT + 8;
const HIT_PADDING = 6;
const HOP_SECONDS = 0.45;
const HOP_HEIGHT = 10;
const BLADE_RAISE = 5;

/** True when the taskbar has enough snow on it that the plow should come by. */
export function needsPlowing(floor: Surface): boolean {
  const { layer } = floor;
  return (
    layer.averageHeight() > PLOW.triggerAverageHeight || layer.peakHeight() > layer.maxHeight * PLOW.triggerPeakRatio
  );
}

export class Snowplow {
  private state: PlowState = 'idle';
  private x = 0;
  private dir: 1 | -1 = 1;
  private carried = 0;
  private timer = 0;
  private puffTimer = 0;
  private sinceCheck = 0;
  private cooldown = 0;
  private reversed = false;
  /** Seconds until the next routine drive-by (comes by even when snow is not deep). */
  private untilVisit = rand(PLOW.firstVisitMinSeconds, PLOW.firstVisitMaxSeconds);

  /** Remaining seconds of the startled hop after a click. */
  private hop = 0;

  get active(): boolean {
    return this.state !== 'idle';
  }

  get leaving(): boolean {
    return this.state === 'leaving';
  }

  /** True when (x, y) is on the vehicle (or the snow it pushes). */
  hitTest(x: number, y: number, floor: Surface | null): boolean {
    if (!this.active || !floor) return false;
    const cx = floor.rect.x + this.x;
    const groundY = this.groundY(floor);
    const reach = PLOW.bodyWidth / 2 + PLOW.bladeWidth + HIT_PADDING;
    return Math.abs(x - cx) <= reach && y <= groundY + HIT_PADDING && y >= groundY - VEHICLE_HEIGHT - HIT_PADDING;
  }

  /** Click reaction: drops its snow where it is and hurries off the nearest edge, blade up. */
  shoo(floor: Surface): void {
    if (!this.active || this.state === 'leaving') return;
    this.dumpCarried(floor);
    this.dir = this.x < floor.rect.width / 2 ? -1 : 1;
    this.state = 'leaving';
    this.hop = HOP_SECONDS;
  }

  /** Front edge x of the blade. */
  private bladeFront(): number {
    return this.x + this.dir * (PLOW.bodyWidth / 2 + PLOW.bladeWidth);
  }

  start(floor: Surface, from?: 1 | -1): void {
    if (this.active) return;
    this.dir = from ?? (Math.random() < 0.5 ? 1 : -1);
    this.x = this.dir === 1 ? -OFFSCREEN : floor.rect.width + OFFSCREEN;
    this.carried = 0;
    this.reversed = false;
    this.state = 'driving';
    this.untilVisit = rand(PLOW.visitMinSeconds, PLOW.visitMaxSeconds);
  }

  update(
    dt: number,
    floor: Surface | null,
    obstacles: ReadonlyArray<Interval>,
    autoStart: boolean,
    fx: Particles,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!floor || floor.kind !== 'bar') {
      this.state = 'idle';
      return;
    }
    if (this.state === 'idle') {
      this.sinceCheck += dt;
      this.untilVisit -= dt;
      if (autoStart && this.sinceCheck > PLOW.checkEverySeconds && this.cooldown === 0) {
        this.sinceCheck = 0;
        const routineVisit = this.untilVisit <= 0 && floor.layer.averageHeight() > PLOW.visitMinAverage;
        if (needsPlowing(floor) || routineVisit) this.start(floor);
      }
      return;
    }
    this.puffTimer += dt;
    if (this.puffTimer > PUFF_EVERY) {
      this.puffTimer = 0;
      fx.puff(
        floor.rect.x + this.x - this.dir * PLOW.bodyWidth * 0.3,
        floor.rect.y - BODY_HEIGHT - TRACK_HEIGHT,
        this.dir,
      );
    }
    if (this.state === 'blocked') {
      this.timer -= dt;
      if (this.timer <= 0) this.turnAround(floor);
      return;
    }
    if (this.state === 'leaving') {
      this.hop = Math.max(0, this.hop - dt);
      this.leave(dt, floor);
      return;
    }
    this.drive(dt, floor, obstacles);
  }

  private groundY(floor: Surface): number {
    return floor.rect.y - Math.min(2, floor.layer.heightAt(this.x));
  }

  draw(ctx: CanvasRenderingContext2D, floor: Surface | null, sprites: Sprites, time: number): void {
    if (!this.active || !floor) return;
    const hopLift = this.hop > 0 ? Math.sin((1 - this.hop / HOP_SECONDS) * Math.PI) * HOP_HEIGHT : 0;
    const groundY = this.groundY(floor) - hopLift;
    const cx = floor.rect.x + this.x;
    ctx.save();
    ctx.translate(cx, groundY);
    ctx.scale(this.dir, 1);
    if (this.state !== 'leaving') this.drawMound(ctx);
    const moving = this.state === 'driving' || this.state === 'leaving';
    drawVehicle(
      ctx,
      time,
      moving ? time * (this.leaving ? PLOW.shooSpeedFactor : 1) : 0,
      this.leaving ? BLADE_RAISE : 0,
    );
    ctx.globalAlpha = 0.8;
    ctx.drawImage(sprites.headlight, PLOW.bodyWidth / 2 - 4, -BODY_HEIGHT - TRACK_HEIGHT - 20, 70, 44);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (this.state === 'blocked' || this.hop > 0) {
      ctx.fillStyle = '#ffdd55';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(HONK_TEXT, cx, groundY - BODY_HEIGHT - TRACK_HEIGHT - 16);
    }
  }

  private drive(dt: number, floor: Surface, obstacles: ReadonlyArray<Interval>): void {
    const step = PLOW.speed * dt * this.dir;
    const front = this.bladeFront() + step;
    const hit = obstacles.find((o) => front >= o.start - 2 && front <= o.end + 2);
    if (hit && !this.reversed) {
      this.state = 'blocked';
      this.timer = PLOW.blockedSeconds;
      return;
    }
    this.x += step;
    const blade = this.bladeFront();
    const bx0 = blade - this.dir * PLOW.bladeWidth;
    this.carried += floor.layer.take(Math.min(bx0, blade), Math.max(bx0, blade), PLOW.residualSnow);
    if (this.offScreen(floor)) this.finish(PLOW.cooldownSeconds);
  }

  /** Shooed: fast, blade raised, plows nothing, then stays away for a while. */
  private leave(dt: number, floor: Surface): void {
    this.x += PLOW.speed * PLOW.shooSpeedFactor * dt * this.dir;
    if (this.offScreen(floor)) {
      this.finish(PLOW.shooCooldownSeconds);
      this.untilVisit = Math.max(this.untilVisit, PLOW.shooCooldownSeconds);
    }
  }

  private offScreen(floor: Surface): boolean {
    return this.dir === 1 ? this.x > floor.rect.width + OFFSCREEN : this.x < -OFFSCREEN;
  }

  private finish(cooldown: number): void {
    this.state = 'idle';
    this.cooldown = cooldown;
    this.sinceCheck = 0;
    this.hop = 0;
  }

  /** Leaves the pushed snow as a small pile in front of the blade. */
  private dumpCarried(floor: Surface): void {
    const blade = this.bladeFront();
    let left = this.carried;
    for (let k = 0; k < 6 && left > 0.1; k++) {
      left -= floor.layer.deposit(blade - this.dir * (k * 3 + 2), left / 2);
    }
    this.carried = 0;
  }

  private turnAround(floor: Surface): void {
    this.dumpCarried(floor);
    this.dir = this.dir === 1 ? -1 : 1;
    this.reversed = true;
    this.state = 'driving';
  }

  /** Wedge of pushed snow in front of the blade: tall at the blade, sloping down ahead of it. */
  private drawMound(ctx: CanvasRenderingContext2D): void {
    if (this.carried < 1) return;
    const height = Math.min(PLOW.moundMax, 3 + Math.sqrt(this.carried) * 0.9);
    const length = height * PLOW.wedgeLengthRatio;
    const x0 = PLOW.bodyWidth / 2 + PLOW.bladeWidth - 3;
    const fill = ctx.createLinearGradient(0, -height, 0, 0);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(1, '#d6e1ef');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, -height);
    ctx.quadraticCurveTo(x0 + length * 0.25, -height * 1.02, x0 + length * 0.55, -height * 0.45);
    ctx.quadraticCurveTo(x0 + length * 0.8, -height * 0.08, x0 + length, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, -height);
    ctx.quadraticCurveTo(x0 + length * 0.25, -height * 1.02, x0 + length * 0.55, -height * 0.45);
    ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Yellow tracked snowplow drawn facing +x, origin at ground center. */
function drawVehicle(ctx: CanvasRenderingContext2D, time: number, trackTime: number, bladeRaise: number): void {
  const w = PLOW.bodyWidth;
  const half = w / 2;
  // Tracks
  ctx.fillStyle = '#23262d';
  roundRect(ctx, -half, -TRACK_HEIGHT, w, TRACK_HEIGHT, TRACK_HEIGHT / 2);
  ctx.fill();
  ctx.fillStyle = '#5a606b';
  for (let i = 0; i < 5; i++) {
    const wx = -half + 5 + i * ((w - 10) / 4);
    ctx.beginPath();
    ctx.arc(wx, -TRACK_HEIGHT / 2, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3b4049';
  ctx.lineWidth = 1;
  const offset = (trackTime * 30) % 4;
  ctx.beginPath();
  for (let x = -half + 2 - offset; x < half - 2; x += 4) {
    ctx.moveTo(x, -TRACK_HEIGHT);
    ctx.lineTo(x, -TRACK_HEIGHT + 1.5);
  }
  ctx.stroke();

  // Body
  const bodyTop = -TRACK_HEIGHT - BODY_HEIGHT + 6;
  const bodyGrad = ctx.createLinearGradient(0, bodyTop, 0, -TRACK_HEIGHT);
  bodyGrad.addColorStop(0, '#ffd23a');
  bodyGrad.addColorStop(1, '#e09a12');
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, -half + 2, bodyTop, w - 8, BODY_HEIGHT - 6, 2.5);
  ctx.fill();

  // Cab
  const cabTop = -TRACK_HEIGHT - BODY_HEIGHT - 6;
  ctx.fillStyle = '#f5b91c';
  roundRect(ctx, -half + 4, cabTop, 20, 13, 3);
  ctx.fill();
  ctx.fillStyle = '#9fd3ff';
  roundRect(ctx, -half + 13, cabTop + 2.5, 9, 6.5, 1.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(-half + 14, cabTop + 3, 2, 5);

  // Exhaust pipe
  ctx.fillStyle = '#3b4049';
  ctx.fillRect(-half + 1, cabTop - 1, 2.2, 9);

  // Beacon
  const on = Math.sin(time * Math.PI * 2 * BEACON_HZ) > 0;
  ctx.fillStyle = on ? '#ff7a00' : '#8a3d00';
  ctx.beginPath();
  ctx.arc(-half + 14, cabTop - 1, 2.6, Math.PI, Math.PI * 2);
  ctx.fill();
  if (on) {
    const g = ctx.createRadialGradient(-half + 14, cabTop - 2, 0, -half + 14, cabTop - 2, 14);
    g.addColorStop(0, 'rgba(255,140,0,0.65)');
    g.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-half, cabTop - 16, 30, 30);
  }

  // Headlight
  ctx.fillStyle = '#fff6c9';
  ctx.fillRect(half - 7, bodyTop + 2, 2.5, 3);

  // Blade arm + blade (raised when shooed away, so it stops scraping)
  ctx.save();
  ctx.translate(0, -bladeRaise);
  ctx.fillStyle = '#4b515c';
  ctx.fillRect(half - 6, -TRACK_HEIGHT - 4, PLOW.bladeWidth - 2, 2.5);
  const bladeGrad = ctx.createLinearGradient(half + PLOW.bladeWidth - 6, 0, half + PLOW.bladeWidth, 0);
  bladeGrad.addColorStop(0, '#9aa3b0');
  bladeGrad.addColorStop(1, '#dfe5ee');
  ctx.fillStyle = bladeGrad;
  ctx.beginPath();
  ctx.moveTo(half + PLOW.bladeWidth - 5, -TRACK_HEIGHT - 9);
  ctx.quadraticCurveTo(half + PLOW.bladeWidth + 2, -TRACK_HEIGHT - 4, half + PLOW.bladeWidth, 0);
  ctx.lineTo(half + PLOW.bladeWidth - 4, 0);
  ctx.quadraticCurveTo(half + PLOW.bladeWidth - 2, -TRACK_HEIGHT - 4, half + PLOW.bladeWidth - 8, -TRACK_HEIGHT - 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff9f1a';
  ctx.fillRect(half + PLOW.bladeWidth - 7, -TRACK_HEIGHT - 9, 3, 2);
  ctx.restore();
}
