import type { Intensity, WindMode } from '../shared/types';

export const LAYER = {
  columnWidth: 3,
  windowMaxHeight: 15,
  barMaxHeight: 24,
  groundMaxHeight: 30,
  /** Snow stops at the window edge; the drawing drapes it over the rounded corner instead. */
  overhang: 0,
  /** Capacity multiplier at the very end of the overhang. */
  overhangTipCapacity: 0.15,
  /** Capacity multiplier at the window edge (blanket stays nearly full up to the corner). */
  edgeCapacity: 0.85,
  /** Lower = flatter, smoother blanket. */
  maxSlope: 0.9,
  flakeDeposit: 1.1,
  meltPerSecond: 0.05,
  minVisibleHeight: 0.25,
} as const;

export const FLAKES = {
  perMegapixel: { light: 70, medium: 170, heavy: 340, blizzard: 650 } satisfies Record<Intensity, number>,
  /** Accumulation multiplier per intensity. */
  depositScale: { light: 0.7, medium: 1, heavy: 1.35, blizzard: 1.8 } satisfies Record<Intensity, number>,
  minRadius: 0.7,
  maxRadius: 3.1,
  minSpeed: 22,
  maxSpeed: 78,
  /** Flakes with depth above this are "near" and can land on surfaces. */
  landingDepth: 0.42,
  crystalChance: 0.06,
  swayMin: 6,
  swayMax: 22,
  spawnMargin: 60,
  rampPerSecond: 0.35,
} as const;

export const WIND = {
  base: { calm: 0, breeze: 16, gusty: 42 } satisfies Record<WindMode, number>,
  gust: { calm: 4, breeze: 14, gusty: 38 } satisfies Record<WindMode, number>,
} as const;

export const CRUMBS = {
  gravity: 980,
  max: 1800,
  depositPerRadius: 0.9,
  shedSpeed: 650,
  shedDistance: 60,
} as const;

export const GARLAND = {
  span: 72,
  sag: 6,
  bulbSpacing: 15,
  bulbRadiusX: 2.2,
  bulbRadiusY: 3,
  glowSize: 22,
  minWidth: 140,
  colors: ['#ff3b3b', '#ffcc33', '#3dff7a', '#3db4ff', '#ff5ce1', '#ff8a2a'],
} as const;

export const PLOW = {
  speed: 74,
  bodyWidth: 50,
  bladeWidth: 12,
  /** Snow left behind the blade: thin, but enough to still roll snowballs from. */
  residualSnow: 3,
  /** Routine drive-bys, like the original: every minute or two whenever there is some snow. */
  firstVisitMinSeconds: 35,
  firstVisitMaxSeconds: 60,
  visitMinSeconds: 70,
  visitMaxSeconds: 130,
  visitMinAverage: 1.5,
  /** Clicked plow hurries away this much faster... */
  shooSpeedFactor: 4,
  /** ...and stays away this long. */
  shooCooldownSeconds: 240,
  /** Plow comes when the taskbar snow averages this deep... */
  triggerAverageHeight: 3.5,
  /** ...or when any spot reaches this share of the maximum depth. */
  triggerPeakRatio: 0.65,
  checkEverySeconds: 8,
  cooldownSeconds: 40,
  blockedSeconds: 1.3,
  moundMax: 18,
  /** Wedge length relative to its height. */
  wedgeLengthRatio: 2.8,
} as const;

export const SNOWMAN = {
  startRadius: 5,
  maxRadius: 30,
  /** Below the plow's residual snow, so you can keep playing right after it passes. */
  minSnowToRoll: 2,
  growFactor: 7,
  takePerPixel: 0.9,
  maxStack: 3,
  sinkRatio: 0.18,
  stackOverlap: 0.78,
  /** Held ball counts as "on the ground" while the pointer is within this many radii above rest. */
  liftRatio: 0.9,
  rollThreshold: 4,
  maxRollStep: 40,
  doubleClickMs: 330,
  hatChance: 0.6,
  waveDistance: 110,
} as const;

export const SWIPE = {
  speed: 2.4,
  radius: 12,
} as const;
