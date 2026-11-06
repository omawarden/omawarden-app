import { expect, test } from "nsh/test";
import {
  DETAIL_CONTENT_MAX_WIDTH,
  EMPTY_STATE_MAX_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_RATIO,
  sidebarWidth,
  windowTooSmall,
} from "./layout";

test("layout module owns the shell's size constants", () => {
  expect(SIDEBAR_MIN_WIDTH).toBe(320);
  expect(SIDEBAR_MAX_WIDTH).toBe(560);
  expect(SIDEBAR_WIDTH_RATIO).toBe(0.3);
  expect(MIN_WINDOW_WIDTH).toBe(900);
  expect(MIN_WINDOW_HEIGHT).toBe(620);
  expect(DETAIL_CONTENT_MAX_WIDTH).toBe(900);
  expect(EMPTY_STATE_MAX_WIDTH).toBe(420);
});

test("sidebar width follows the window curve", () => {
  expect(sidebarWidth(900)).toBe(320);
  expect(sidebarWidth(1280)).toBe(384);
  expect(sidebarWidth(1440)).toBe(432);
  expect(sidebarWidth(1920)).toBe(560);
  expect(sidebarWidth(2200)).toBe(560);
  expect(sidebarWidth(2560)).toBe(560);
  expect(sidebarWidth(3840)).toBe(560);
});

test("sidebar width clamps at both edges of its range", () => {
  // Below the preferred ratio's minimum: the list never shrinks past 320.
  expect(sidebarWidth(0)).toBe(320);
  expect(sidebarWidth(400)).toBe(320);
  expect(sidebarWidth(1066)).toBe(320);
  expect(sidebarWidth(1067)).toBe(320);
  // Past the maximum: the list holds at 560 and the detail pane keeps the rest.
  expect(sidebarWidth(1800)).toBe(540);
  expect(sidebarWidth(1866)).toBe(560);
  expect(sidebarWidth(1867)).toBe(560);
  expect(sidebarWidth(7680)).toBe(560);
});

test("sidebar width rounds to whole points", () => {
  expect(sidebarWidth(1441)).toBe(432);
  expect(sidebarWidth(1443)).toBe(433);
  expect(sidebarWidth(1449)).toBe(435);
});

test("sidebar width accepts a font scale that defaults to 1", () => {
  expect(sidebarWidth(1440)).toBe(432);
  expect(sidebarWidth(1440, 1)).toBe(432);
  expect(sidebarWidth(1440, 1.5)).toBe(648);
  expect(sidebarWidth(1440, 2)).toBe(864);
  // The scale multiplies the clamped base, not the raw window share.
  expect(sidebarWidth(900, 2)).toBe(640);
  expect(sidebarWidth(3840, 2)).toBe(1120);
});

test("window too small checks both thresholds at their boundaries", () => {
  // Width: just below, exactly at, just above the minimum.
  expect(windowTooSmall({ width: 899, height: 960 })).toBe(true);
  expect(windowTooSmall({ width: 900, height: 960 })).toBe(false);
  expect(windowTooSmall({ width: 901, height: 960 })).toBe(false);
  // Height: just below, exactly at, just above the minimum.
  expect(windowTooSmall({ width: 1440, height: 619 })).toBe(true);
  expect(windowTooSmall({ width: 1440, height: 620 })).toBe(false);
  expect(windowTooSmall({ width: 1440, height: 621 })).toBe(false);
  // Either dimension alone is enough to block the layout.
  expect(windowTooSmall({ width: 899, height: 619 })).toBe(true);
  expect(windowTooSmall({ width: 3840, height: 2160 })).toBe(false);
});
