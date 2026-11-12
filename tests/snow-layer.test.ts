import { describe, expect, it } from 'vitest';
import { SnowLayer, type LayerOptions } from '../src/renderer/snow-layer';

const OPTS: LayerOptions = {
  columnWidth: 3,
  maxHeight: 10,
  overhang: 6,
  edgeCapacity: 0.7,
  overhangTipCapacity: 0.15,
  maxSlope: 1.5,
};

describe('SnowLayer', () => {
  it('covers the surface plus overhang on both sides', () => {
    const layer = new SnowLayer(300, OPTS);
    expect(layer.columns).toBe(Math.ceil((300 + 12) / 3));
    expect(layer.columnX(0)).toBeCloseTo(-4.5);
  });

  it('never exceeds capacity, and overhang tips hold less than the middle', () => {
    const layer = new SnowLayer(90, OPTS);
    for (let k = 0; k < 500; k++) {
      for (let x = -6; x <= 96; x += 1) layer.deposit(x, 1);
    }
    for (let i = 0; i < layer.columns; i++) expect(layer.heightOf(i)).toBeLessThanOrEqual(OPTS.maxHeight + 1e-6);
    expect(layer.heightAt(45)).toBeCloseTo(OPTS.maxHeight, 1);
    expect(layer.heightOf(0)).toBeLessThan(OPTS.maxHeight * 0.5);
  });

  it('ignores deposits outside its range', () => {
    const layer = new SnowLayer(30, OPTS);
    expect(layer.deposit(-100, 5)).toBe(0);
    expect(layer.deposit(500, 5)).toBe(0);
    expect(layer.totalVolume()).toBe(0);
  });

  it('take removes only snow above the kept depth and respects the limit', () => {
    const layer = new SnowLayer(60, OPTS);
    for (let k = 0; k < 50; k++) for (let x = 0; x < 60; x += 3) layer.deposit(x, 1);
    const before = layer.totalVolume();
    const removed = layer.take(10, 20, 2, 5);
    expect(removed).toBeCloseTo(5);
    expect(layer.totalVolume()).toBeCloseTo(before - 5);
    layer.take(10, 20, 2);
    expect(layer.heightAt(15)).toBeCloseTo(2, 5);
  });

  it('relax limits slopes between neighbouring snowy columns', () => {
    // Arrange: a thin even layer with one tall spike on it.
    const layer = new SnowLayer(60, OPTS);
    for (let x = -6; x <= 66; x += 1) layer.deposit(x, 0.5);
    layer.deposit(30, 8);
    // Act
    for (let k = 0; k < 50; k++) layer.relax();
    // Assert
    for (let i = 0; i + 1 < layer.columns; i++) {
      expect(Math.abs(layer.heightOf(i) - layer.heightOf(i + 1))).toBeLessThanOrEqual(OPTS.maxSlope + 1e-3);
    }
  });

  it('should_keep_a_brushed_gap_clear_when_snow_relaxes_for_a_long_time', () => {
    // Arrange: a deep even layer, then a gap cleared in the middle.
    const layer = new SnowLayer(90, OPTS);
    for (let k = 0; k < 40; k++) for (let x = -6; x <= 96; x += 1) layer.deposit(x, 1);
    layer.take(36, 54, 0);
    // Act: ten seconds of relaxing at 30 fps.
    for (let k = 0; k < 300; k++) layer.relax();
    // Assert: the middle of the gap stayed bare, the snow beside it stayed put.
    expect(layer.heightAt(45)).toBe(0);
    expect(layer.heightAt(15)).toBeGreaterThan(5);
  });

  it('resize keeps snow and clamps to new capacity', () => {
    const layer = new SnowLayer(60, OPTS);
    for (let k = 0; k < 30; k++) for (let x = 0; x < 60; x += 3) layer.deposit(x, 1);
    layer.resize(120);
    expect(layer.width).toBe(120);
    expect(layer.totalVolume()).toBeGreaterThan(0);
    for (let i = 0; i < layer.columns; i++) expect(layer.heightOf(i)).toBeLessThanOrEqual(OPTS.maxHeight);
  });

  it('melt lowers every column without going negative', () => {
    const layer = new SnowLayer(30, OPTS);
    layer.deposit(15, 2);
    layer.melt(100);
    expect(layer.totalVolume()).toBe(0);
  });
});
