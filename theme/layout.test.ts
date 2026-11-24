import { expect, test } from "nsh/test";
import {
  EMPTY_STATE_MAX_WIDTH,
  GENERATOR_LABEL_WIDTH,
  INPUT_MIN_HEIGHT,
  LABEL_GUTTER_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_LAYOUT_WIDTH,
  NAV_SIDEBAR_MIN_WINDOW_WIDTH,
  NAV_SIDEBAR_WIDTH,
  OTP_CELL_HEIGHT,
  OTP_CELL_WIDTH,
  ITEM_LIST_MAX_WIDTH,
  ITEM_LIST_MIN_WIDTH,
  ITEM_LIST_WIDTH_RATIO,
  SEARCH_CONTROL_HEIGHT,
  SYNC_INDICATOR_SIZE,
  VAULT_ICON_SIZE,
  WIDE_INPUT_WIDTH,
  minimumWindowHeight,
  scaleLength,
  itemListWidth,
  shellContentWidth,
  sidebarForcedCollapsed,
  windowTooShort,
} from "./layout";

test("layout module owns the shell's size constants", () => {
  expect(ITEM_LIST_MIN_WIDTH).toBe(320);
  expect(ITEM_LIST_MAX_WIDTH).toBe(560);
  expect(ITEM_LIST_WIDTH_RATIO).toBe(0.3);
  expect(MIN_LAYOUT_WIDTH).toBe(900);
  expect(MIN_WINDOW_HEIGHT).toBe(620);
  expect(EMPTY_STATE_MAX_WIDTH).toBe(420);
  expect(NAV_SIDEBAR_WIDTH).toBe(240);
  expect(NAV_SIDEBAR_MIN_WINDOW_WIDTH).toBe(1140);
});

test("layout module owns the lengths that make room for text", () => {
  expect(LABEL_GUTTER_WIDTH).toBe(132);
  expect(GENERATOR_LABEL_WIDTH).toBe(130);
  expect(WIDE_INPUT_WIDTH).toBe(160);
  expect(OTP_CELL_WIDTH).toBe(40);
  expect(OTP_CELL_HEIGHT).toBe(44);
  expect(INPUT_MIN_HEIGHT).toBe(36);
  expect(SEARCH_CONTROL_HEIGHT).toBe(32);
  expect(SYNC_INDICATOR_SIZE).toBe(14);
  expect(VAULT_ICON_SIZE).toBe(16);
});

test("scale length multiplies and rounds to whole points", () => {
  expect(scaleLength(132, 1)).toBe(132);
  expect(scaleLength(132, 1.5)).toBe(198);
  expect(scaleLength(132, 2)).toBe(264);
  expect(scaleLength(9, 1.5)).toBe(14);
  expect(scaleLength(11, 1.5)).toBe(17);
  expect(scaleLength(13, 1.25)).toBe(16);
});

test("scale length never returns less than one point", () => {
  expect(scaleLength(1, 0.1)).toBe(1);
  expect(scaleLength(0, 2)).toBe(1);
  expect(scaleLength(36, 0)).toBe(1);
});

test("item list width follows the window curve", () => {
  expect(itemListWidth(900)).toBe(320);
  expect(itemListWidth(1280)).toBe(384);
  expect(itemListWidth(1440)).toBe(432);
  expect(itemListWidth(1920)).toBe(560);
  expect(itemListWidth(2200)).toBe(560);
  expect(itemListWidth(2560)).toBe(560);
  expect(itemListWidth(3840)).toBe(560);
});

test("item list width clamps at both edges of its range", () => {
  // Below the preferred ratio's minimum: the list never shrinks past 320.
  expect(itemListWidth(0)).toBe(320);
  expect(itemListWidth(400)).toBe(320);
  expect(itemListWidth(1066)).toBe(320);
  expect(itemListWidth(1067)).toBe(320);
  // Past the maximum: the list holds at 560 and the detail pane keeps the rest.
  expect(itemListWidth(1800)).toBe(540);
  expect(itemListWidth(1866)).toBe(560);
  expect(itemListWidth(1867)).toBe(560);
  expect(itemListWidth(7680)).toBe(560);
});

test("item list width rounds to whole points", () => {
  expect(itemListWidth(1441)).toBe(432);
  expect(itemListWidth(1443)).toBe(433);
  expect(itemListWidth(1449)).toBe(435);
});

test("window too short checks the height alone", () => {
  // Width no longer takes part: a narrow window scrolls rather than gating.
  expect(windowTooShort({ width: 899, height: 960 })).toBe(false);
  expect(windowTooShort({ width: 200, height: 960 })).toBe(false);
  // Height: just below, exactly at, just above the minimum.
  expect(windowTooShort({ width: 1440, height: 619 })).toBe(true);
  expect(windowTooShort({ width: 1440, height: 620 })).toBe(false);
  expect(windowTooShort({ width: 1440, height: 621 })).toBe(false);
  // A short window is short whatever its width.
  expect(windowTooShort({ width: 899, height: 619 })).toBe(true);
  expect(windowTooShort({ width: 3840, height: 2160 })).toBe(false);
});

test("the minimum window height is a fixed floor", () => {
  expect(minimumWindowHeight()).toBe(620);
});

test("the shell content keeps its floor and scrolls below it", () => {
  expect(shellContentWidth(1440)).toBe(1440);
  expect(shellContentWidth(900)).toBe(900);
  // A narrower window does not reflow the shell: the content stays at the
  // floor and the shell scrolls sideways instead.
  expect(shellContentWidth(899)).toBe(900);
  expect(shellContentWidth(400)).toBe(900);
  expect(shellContentWidth(0)).toBe(900);
});

test("the sidebar renders collapsed below its threshold", () => {
  // 1140 is the exact 1139 rounded up: 240 sidebar + 20 padding + 320 list
  // + 9 handle + 550 inspector.
  expect(sidebarForcedCollapsed(1139)).toBe(true);
  expect(sidebarForcedCollapsed(1140)).toBe(false);
  expect(sidebarForcedCollapsed(1141)).toBe(false);
  // Every window the shell lays out collapsed is also too narrow for the
  // sidebar, so the two thresholds cannot contradict each other.
  expect(sidebarForcedCollapsed(MIN_LAYOUT_WIDTH)).toBe(true);
  expect(sidebarForcedCollapsed(1440)).toBe(false);
});
