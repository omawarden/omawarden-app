import { expect, test } from "nsh/test";
import {
  TYPE_SCALE,
  noteLineHeight,
  scaleType,
  type TypeStep,
} from "./typeScale";

const STEPS: TypeStep[] = [
  "2xs",
  "xs",
  "sm",
  "base",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
];

test("type scale owns the base ladder", () => {
  expect(TYPE_SCALE["2xs"]).toBe(9);
  expect(TYPE_SCALE.xs).toBe(10);
  expect(TYPE_SCALE.sm).toBe(11);
  expect(TYPE_SCALE.base).toBe(12);
  expect(TYPE_SCALE.md).toBe(13);
  expect(TYPE_SCALE.lg).toBe(14);
  expect(TYPE_SCALE.xl).toBe(15);
  expect(TYPE_SCALE["2xl"]).toBe(16);
  expect(TYPE_SCALE["3xl"]).toBe(17);
  expect(TYPE_SCALE["4xl"]).toBe(18);
  expect(TYPE_SCALE["5xl"]).toBe(20);
  expect(TYPE_SCALE["6xl"]).toBe(24);
  expect(TYPE_SCALE["7xl"]).toBe(28);
});

test("every one of the thirteen steps is present", () => {
  expect(Object.keys(TYPE_SCALE).sort()).toEqual([...STEPS].sort());
  expect(Object.keys(scaleType(1)).sort()).toEqual([...STEPS].sort());
});

test("scaleType(1) returns exactly the base ladder", () => {
  expect(scaleType(1)).toEqual(TYPE_SCALE);
});

test("scaleType(2) doubles every step", () => {
  const doubled = scaleType(2);
  for (const step of STEPS) {
    expect(doubled[step]).toBe(TYPE_SCALE[step] * 2);
  }
});

test("fractional factors round to whole points", () => {
  const scaled = scaleType(1.5);
  expect(scaled["2xs"]).toBe(14);
  expect(scaled.xs).toBe(15);
  expect(scaled.sm).toBe(17);
  expect(scaled.base).toBe(18);
  expect(scaled.md).toBe(20);
  expect(scaled.lg).toBe(21);
  expect(scaled.xl).toBe(23);
  expect(scaled["2xl"]).toBe(24);
  expect(scaled["3xl"]).toBe(26);
  expect(scaled["4xl"]).toBe(27);
  expect(scaled["5xl"]).toBe(30);
  expect(scaled["6xl"]).toBe(36);
  expect(scaled["7xl"]).toBe(42);
  for (const step of STEPS) {
    expect(Number.isInteger(scaled[step])).toBe(true);
  }
});

test("a tiny factor still yields at least one point", () => {
  for (const factor of [0.01, 0, -1]) {
    const scaled = scaleType(factor);
    for (const step of STEPS) {
      expect(scaled[step]).toBe(1);
    }
  }
});

test("text metrics outside the ladder follow the scale", () => {
  const base = scaleType(1);
  const doubled = scaleType(2);
  expect(noteLineHeight(base)).toBe(19);
  expect(noteLineHeight(doubled)).toBe(38);
});
