/**
 * Website icons for vault rows.
 *
 * `IconPolicy` answers where an icon lives. This module owns the app's share
 * of the decision: the settings gate, the server URL, and one failure signal
 * per domain. A failed favicon falls back to the category glyph for every row
 * on that domain, and keeps doing so when `Each` recycles a row for another
 * item.
 */

import { signal, type Signal } from "nsh";
import type { CipherRowView, InspectorView } from "omawarden-app/native";
import * as store from "./appStore";
import { iconFor, iconDomainFor, resolve } from "./IconPolicy";

/** One signal per domain whose favicon failed to load. */
const failures = new Map<string, Signal<boolean>>();

/** The failure signal for `domain`, created on first use. */
function failure(domain: string): Signal<boolean> {
  const existing = failures.get(domain);
  if (existing) {
    return existing;
  }
  const created = signal(false);
  failures.set(domain, created);
  return created;
}

/** The favicon URL for a row, or "" when it draws the category glyph. */
export function rowIcon(item: () => CipherRowView): string {
  const current = store.settings();
  return iconFor(
    store.snapshot().serverUrl,
    item().uris,
    resolve(current !== null, current?.config.showWebsiteIcons),
    (domain) => failure(domain)(),
  );
}

/** Remembers that a row's favicon did not load. */
export function markIconFailed(item: () => CipherRowView): void {
  const domain = iconDomainFor(item().uris);
  if (domain) {
    failure(domain).set(true);
  }
}

/** The favicon URL for the inspector's header, or "" when it draws the glyph. */
export function inspectorIcon(item: () => InspectorView): string {
  const current = store.settings();
  return iconFor(
    store.snapshot().serverUrl,
    inspectorUris(item),
    resolve(current !== null, current?.config.showWebsiteIcons),
    (domain) => failure(domain)(),
  );
}

/** Remembers that the inspector's favicon did not load. */
export function markInspectorIconFailed(item: () => InspectorView): void {
  const domain = iconDomainFor(inspectorUris(item));
  if (domain) {
    failure(domain).set(true);
  }
}

/** The inspector's raw URIs, in the shape the icon policy takes. */
function inspectorUris(item: () => InspectorView): string[] {
  return item().uris.map((entry) => entry.uri);
}
