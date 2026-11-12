import { describe, expect, it } from 'vitest';
import { needsPlowing, Snowplow } from '../src/renderer/plow';
import { Particles } from '../src/renderer/particles';
import { SnowLayer } from '../src/renderer/snow-layer';
import type { Surface } from '../src/renderer/surfaces';

function bar(depth: number): Surface {
  const layer = new SnowLayer(1920, {
    columnWidth: 3,
    maxHeight: 24,
    overhang: 0,
    edgeCapacity: 1,
    overhangTipCapacity: 1,
    maxSlope: 1,
  });
  for (let k = 0; k < depth; k++) for (let x = 0; x < 1920; x += 3) layer.deposit(x, 0.5);
  return {
    id: 'bar',
    kind: 'bar',
    rect: { x: 0, y: 1032, width: 1920, height: 48 },
    layer,
    visible: [],
    collects: true,
  };
}

/** Scans the taskbar for the x where the plow currently is. */
function findPlowX(plow: Snowplow, floor: Surface): number {
  for (let x = 0; x < floor.rect.width; x += 2) {
    if (plow.hitTest(x, floor.rect.y - 10, floor)) return x + 20;
  }
  return -1;
}

describe('Snowplow', () => {
  it('should_not_come_when_the_taskbar_is_almost_clear', () => {
    expect(needsPlowing(bar(1))).toBe(false);
  });

  it('should_come_when_snow_has_built_up', () => {
    expect(needsPlowing(bar(4))).toBe(true);
  });

  it('should_come_when_one_spot_is_deep_even_if_the_average_is_low', () => {
    const floor = bar(0);
    for (let k = 0; k < 40; k++) floor.layer.deposit(900, 1);
    expect(needsPlowing(floor)).toBe(true);
  });

  it('should_come_by_on_a_routine_visit_when_there_is_only_a_little_snow', () => {
    // Arrange: thin snow, below the "deep pile" trigger.
    const floor = bar(4);
    floor.layer.take(0, 1920, 2);
    expect(needsPlowing(floor)).toBe(false);
    const plow = new Snowplow();
    // Act: let two minutes pass.
    for (let t = 0; t < 130 && !plow.active; t += 0.5) plow.update(0.5, floor, [], true, new Particles());
    // Assert
    expect(plow.active).toBe(true);
  });

  it('should_leave_enough_snow_to_build_snowmen_when_it_passes', () => {
    const floor = bar(12);
    const plow = new Snowplow();
    plow.start(floor, 1);
    for (let t = 0; t < 40 && plow.active; t += 0.05) plow.update(0.05, floor, [], false, new Particles());
    expect(floor.layer.heightAt(900)).toBeGreaterThanOrEqual(2);
  });

  it('should_hurry_off_without_plowing_when_clicked', () => {
    // Arrange: plow halfway across a snowy taskbar, driving right.
    const floor = bar(12);
    const plow = new Snowplow();
    const fx = new Particles();
    plow.start(floor, 1);
    for (let t = 0; t < 14; t += 0.05) plow.update(0.05, floor, [], false, fx);
    const aheadBefore = floor.layer.heightAt(1600);
    // Act: click on it; it leaves via the nearest screen edge.
    const hitX = findPlowX(plow, floor);
    expect(plow.hitTest(hitX, floor.rect.y - 10, floor)).toBe(true);
    plow.shoo(floor);
    let elapsed = 0;
    for (; elapsed < 30 && plow.active; elapsed += 0.05) plow.update(0.05, floor, [], false, fx);
    // Assert: gone quickly, snow it had not reached is untouched.
    expect(plow.active).toBe(false);
    expect(elapsed).toBeLessThan(6);
    expect(floor.layer.heightAt(1600)).toBeCloseTo(aheadBefore);
  });

  it('should_stay_away_for_a_while_after_being_shooed', () => {
    const floor = bar(12);
    const plow = new Snowplow();
    const fx = new Particles();
    plow.start(floor, 1);
    plow.update(0.05, floor, [], false, fx);
    plow.shoo(floor);
    for (let t = 0; t < 10 && plow.active; t += 0.05) plow.update(0.05, floor, [], true, fx);
    // Act: two more minutes of deep snow.
    for (let t = 0; t < 120; t += 0.5) plow.update(0.5, floor, [], true, fx);
    // Assert
    expect(plow.active).toBe(false);
  });

  it('should_not_be_hit_when_clicking_empty_taskbar', () => {
    const floor = bar(4);
    const plow = new Snowplow();
    expect(plow.hitTest(500, floor.rect.y - 10, floor)).toBe(false);
  });

  it('should_clear_the_taskbar_when_it_drives_across', () => {
    // Arrange
    const floor = bar(8);
    const plow = new Snowplow();
    const fx = new Particles();
    const before = floor.layer.averageHeight();
    // Act: drive across (about 2000px at 74px/s ≈ 28s).
    plow.start(floor, 1);
    for (let t = 0; t < 40 && plow.active; t += 0.05) plow.update(0.05, floor, [], false, fx);
    // Assert
    expect(plow.active).toBe(false);
    expect(floor.layer.averageHeight()).toBeLessThan(before / 2);
  });

  it('should_turn_around_when_a_snowman_blocks_the_way', () => {
    const floor = bar(8);
    const plow = new Snowplow();
    const fx = new Particles();
    plow.start(floor, 1);
    for (let t = 0; t < 60 && plow.active; t += 0.05) plow.update(0.05, floor, [{ start: 900, end: 960 }], false, fx);
    // It went back the way it came: the far side of the snowman is untouched.
    expect(plow.active).toBe(false);
    expect(floor.layer.heightAt(400)).toBeLessThan(floor.layer.heightAt(1500));
    expect(floor.layer.heightAt(400)).toBeLessThanOrEqual(3.01);
  });
});
