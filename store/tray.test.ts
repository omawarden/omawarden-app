import { expect, test } from "nsh/test";
import type { MenuItem, TrayOptions } from "nsh/desktop";
import type { AppPhase, SshPromptView } from "omawarden-app/native";
import { paletteFor } from "../theme/palette";
import { buildTrayOptions, type TrayContext, type TrayHandlers } from "./tray";

type TrayMenuItem = Exclude<MenuItem, { type: "separator" }>;

const handlers: TrayHandlers = {
  onToggleWindow: () => {},
  onLockVault: () => {},
  onLogOut: () => {},
  onOpenSettings: () => {},
  onQuit: () => {},
};

const prompt: SshPromptView = {
  id: 7,
  title: "Sign a commit",
  action: "git commit",
  keyName: "work",
  fingerprint: "SHA256:example",
  client: "git",
  command: "git commit -S",
  forwarded: false,
  remembered: false,
  remaining: 2,
};

function context(phase: AppPhase, overrides: Partial<TrayContext> = {}): TrayContext {
  return {
    phase,
    sshPrompt: null,
    windowVisible: true,
    palette: paletteFor("dark"),
    ...overrides,
  };
}

function menuItem(options: TrayOptions, label: string): TrayMenuItem | undefined {
  for (const item of options.menu ?? []) {
    if (item && "label" in item && item.label === label) {
      return item;
    }
  }
  return undefined;
}

function menuLabels(options: TrayOptions): string[] {
  return (options.menu ?? []).flatMap((item) =>
    item && "label" in item && item.label ? [item.label] : [],
  );
}

test("the tray has a distinct icon for each state", () => {
  const locked = buildTrayOptions(context("locked"), handlers);
  const unlocked = buildTrayOptions(context("unlocked"), handlers);
  const attention = buildTrayOptions(context("unlocked", { sshPrompt: prompt }), handlers);

  for (const options of [locked, unlocked, attention]) {
    expect(options.icon).toMatch(/^data:image\/svg\+xml/);
  }
  expect(new Set([locked.icon, unlocked.icon, attention.icon]).size).toBe(3);
});

test("every phase before the vault is unlocked shows the locked icon", () => {
  const lockedIcon = buildTrayOptions(context("locked"), handlers).icon;
  for (const phase of ["dependencyCheck", "login", "twoFactor", "locked"] as const) {
    expect(buildTrayOptions(context(phase), handlers).icon).toBe(lockedIcon);
  }
});

test("a pending SSH request is the attention state, not the unlocked one", () => {
  const unlocked = buildTrayOptions(context("unlocked"), handlers);
  const attention = buildTrayOptions(context("unlocked", { sshPrompt: prompt }), handlers);

  expect(attention.icon).not.toBe(unlocked.icon);
  expect(attention.tooltip).toContain("SSH");
  expect(attention.tooltip).toContain("git");
  expect(attention.tooltip).toContain("2 more");
});

test("a single pending request has no count in the tooltip", () => {
  const options = buildTrayOptions(
    context("unlocked", { sshPrompt: { ...prompt, remaining: 0 } }),
    handlers,
  );

  expect(options.tooltip).not.toContain("more");
});

test("an unnamed SSH client still reads as a request", () => {
  const options = buildTrayOptions(
    context("unlocked", { sshPrompt: { ...prompt, client: "" } }),
    handlers,
  );

  expect(options.tooltip).toContain("an app");
});

test("the tooltip says what the app is doing in each state", () => {
  expect(buildTrayOptions(context("dependencyCheck"), handlers).tooltip).toContain("dependencies");
  expect(buildTrayOptions(context("login"), handlers).tooltip).toContain("log in");
  expect(buildTrayOptions(context("twoFactor"), handlers).tooltip).toContain("log in");
  expect(buildTrayOptions(context("locked"), handlers).tooltip).toContain("locked");
  expect(buildTrayOptions(context("unlocked"), handlers).tooltip).toContain("unlocked");
});

test("the icon color comes from the theme palette", () => {
  const dark = buildTrayOptions(context("unlocked", { palette: paletteFor("dark") }), handlers);
  const light = buildTrayOptions(context("unlocked", { palette: paletteFor("light") }), handlers);

  expect(dark.icon).not.toBe(light.icon);
  expect(dark.icon).toContain(encodeURIComponent(paletteFor("dark").success));
  expect(light.icon).toContain(encodeURIComponent(paletteFor("light").success));
});

test("Lock Vault is enabled only while unlocked and Log Out only while signed in", () => {
  const cases: readonly [AppPhase, boolean, boolean][] = [
    ["dependencyCheck", false, false],
    ["login", false, false],
    ["twoFactor", false, false],
    ["locked", false, true],
    ["unlocked", true, true],
  ];

  for (const [phase, lockEnabled, logOutEnabled] of cases) {
    const options = buildTrayOptions(context(phase), handlers);
    expect(menuItem(options, "Lock Vault")?.disabled).toBe(!lockEnabled);
    expect(menuItem(options, "Log Out")?.disabled).toBe(!logOutEnabled);
  }
});

test("every state keeps the same five items and the same non-vault actions", () => {
  const states = [
    context("locked"),
    context("unlocked"),
    context("unlocked", { sshPrompt: prompt }),
  ];

  for (const state of states) {
    const options = buildTrayOptions(state, handlers);
    expect(menuLabels(options)).toEqual([
      "Hide Omawarden",
      "Lock Vault",
      "Log Out",
      "Settings…",
      "Quit",
    ]);
    expect(menuItem(options, "Settings…")?.disabled).toBeFalsy();
    expect(menuItem(options, "Quit")?.disabled).toBeFalsy();
  }
});

test("the first item shows or hides the window by its current visibility", () => {
  const visible = buildTrayOptions(context("unlocked", { windowVisible: true }), handlers);
  const hidden = buildTrayOptions(context("unlocked", { windowVisible: false }), handlers);

  expect(menuItem(visible, "Hide Omawarden")).toBeTruthy();
  expect(menuItem(visible, "Show Omawarden")).toBeUndefined();
  expect(menuItem(hidden, "Show Omawarden")).toBeTruthy();
  expect(menuItem(hidden, "Hide Omawarden")).toBeUndefined();
});

test("the menu groups the window, vault, settings and quit actions", () => {
  const options = buildTrayOptions(context("unlocked"), handlers);
  const shape = (options.menu ?? []).map((item) =>
    item && "label" in item ? item.label : "—",
  );

  expect(shape).toEqual([
    "Hide Omawarden",
    "—",
    "Lock Vault",
    "Log Out",
    "—",
    "Settings…",
    "—",
    "Quit",
  ]);
});

test("the icon and every menu item call the handler they belong to", () => {
  const calls: string[] = [];
  const recording: TrayHandlers = {
    onToggleWindow: () => calls.push("toggle"),
    onLockVault: () => calls.push("lock"),
    onLogOut: () => calls.push("logout"),
    onOpenSettings: () => calls.push("settings"),
    onQuit: () => calls.push("quit"),
  };

  const options = buildTrayOptions(context("unlocked"), recording);
  options.onClick?.({ bounds: null });
  menuItem(options, "Hide Omawarden")?.onSelect?.();
  menuItem(options, "Lock Vault")?.onSelect?.();
  menuItem(options, "Log Out")?.onSelect?.();
  menuItem(options, "Settings…")?.onSelect?.();
  menuItem(options, "Quit")?.onSelect?.();

  expect(calls).toEqual(["toggle", "toggle", "lock", "logout", "settings", "quit"]);
});

test("the builder returns the same description for the same inputs", () => {
  const input = context("unlocked", { sshPrompt: prompt });

  expect(JSON.stringify(buildTrayOptions(input, handlers))).toBe(
    JSON.stringify(buildTrayOptions(input, handlers)),
  );
});
