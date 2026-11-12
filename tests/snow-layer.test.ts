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

  it('relax limits slopes between neighbouring columns', () => {
    const layer = new SnowLayer(60, OPTS);
    layer.deposit(30, 8);
    for (let k = 0; k < 50; k++) layer.relax();
    for (let i = 0; i + 1 < layer.columns; i++) {
      expect(Math.abs(layer.heightOf(i) - layer.heightOf(i + 1))).toBeLessThanOrEqual(OPTS.maxSlope + 1e-3);
    }
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
