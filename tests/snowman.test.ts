import { describe, expect, it } from 'vitest';
import { easeOutBack, SnowmanWorld } from '../src/renderer/snowman';
import { Particles } from '../src/renderer/particles';
import { SnowLayer } from '../src/renderer/snow-layer';
import type { Surface } from '../src/renderer/surfaces';

const BAR_Y = 1032;

function snowyFloor(): Surface {
  const layer = new SnowLayer(1920, {
    columnWidth: 3,
    maxHeight: 24,
    overhang: 0,
    edgeCapacity: 1,
    overhangTipCapacity: 1,
    maxSlope: 1.6,
  });
  for (let k = 0; k < 40; k++) for (let x = 0; x < 1920; x += 3) layer.deposit(x, 1);
  return {
    id: 'bar',
    kind: 'bar',
    rect: { x: 0, y: BAR_Y, width: 1920, height: 48 },
    layer,
    visible: [],
    collects: true,
  };
}

describe('easeOutBack', () => {
  it('should_never_return_negative_when_animation_just_started', () => {
    // Regression: float rounding gave -2.2e-16 at t=0, and a negative arc radius froze rendering.
    expect(easeOutBack(0)).toBeGreaterThanOrEqual(0);
    expect(easeOutBack(-5)).toBeGreaterThanOrEqual(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
  });
});

describe('SnowmanWorld', () => {
  it('should_roll_and_grow_a_ball_when_dragging_along_the_snow', () => {
    // Arrange
    const world = new SnowmanWorld();
    const floor = snowyFloor();
    const fx = new Particles();
    const snowBefore = floor.layer.totalVolume();
    // Act
    world.pointerDown(300, BAR_Y - 5, floor, 0);
    for (let x = 300; x <= 600; x += 10) world.pointerMove(x, BAR_Y - 5, floor);
    world.pointerUp(floor, 100, fx);
    // Assert
    const [ball] = world.obstacles();
    expect(ball.end - ball.start).toBeGreaterThan(30);
    expect(floor.layer.totalVolume()).toBeLessThan(snowBefore);
  });

  it('should_stack_a_carried_ball_when_dropped_on_another', () => {
    // Arrange: two balls on the ground.
    const world = new SnowmanWorld();
    const floor = snowyFloor();
    const fx = new Particles();
    const roll = (from: number, to: number): void => {
      world.pointerDown(from, BAR_Y - 5, floor, 0);
      for (let x = from; x <= to; x += 10) world.pointerMove(x, BAR_Y - 5, floor);
      world.pointerUp(floor, 100, fx);
    };
    roll(200, 600);
    roll(900, 1000);
    expect(world.obstacles()).toHaveLength(2);
    const small = world.obstacles()[1];
    const smallX = (small.start + small.end) / 2;
    const smallR = (small.end - small.start) / 2 - 3;
    const smallCenterY = BAR_Y - floor.layer.heightAt(smallX) * 0.7 - smallR * 0.82;
    // Act: pick the small ball up, carry it high above the big one, drop.
    expect(world.pointerDown(smallX, smallCenterY, floor, 1000)).toBe(true);
    world.pointerMove(smallX, BAR_Y - 100, floor);
    world.pointerMove(600, BAR_Y - 120, floor);
    world.pointerUp(floor, 1100, fx);
    // Assert: only one stack left on the ground.
    expect(world.obstacles()).toHaveLength(1);
  });

  it('should_ignore_presses_when_there_is_no_snow', () => {
    const world = new SnowmanWorld();
    const floor = snowyFloor();
    floor.layer.clear();
    expect(world.pointerDown(300, BAR_Y - 2, floor, 0)).toBe(false);
    expect(world.busy).toBe(false);
  });
});
