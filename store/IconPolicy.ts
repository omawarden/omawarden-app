/**
 * Website icon policy, ported from `omarchy-bitwarden/components/IconPolicy.js`.
 *
 * Official Bitwarden servers use Bitwarden's icon service. Self-hosted servers
 * serve icons from their own `/icons` path. App-only URI schemes never produce
 * a favicon request.
 */

const APP_SCHEMES = [
  "androidapp:",
  "iosapp:",
  "ssh:",
  "otpauth:",
  "file:",
  "data:",
  "blob:",
  "chrome:",
  "about:",
];

export function resolve(configLoaded: boolean, configValue: unknown): boolean {
  if (!configLoaded) {
    return false;
  }
  return configValue !== false;
}

export function extractHost(serverUrl: string | null | undefined): string {
  if (!serverUrl) {
    return "";
  }
  const match = String(serverUrl)
    .trim()
    .match(/^(?:https?:\/\/)?(?:[^@\n]+@)?([^:/\n?#]+)/i);
  return match ? match[1].toLowerCase() : "";
}

export function extractOrigin(serverUrl: string | null | undefined): string {
  if (!serverUrl) {
    return "";
  }
  let value = String(serverUrl).trim();
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  const match = value.match(/^(https?:\/\/[^/\s?#]+)/i);
  return match ? match[1].toLowerCase() : "";
}

export function isSameOrigin(urlA: string, urlB: string): boolean {
  const originA = extractOrigin(urlA);
  const originB = extractOrigin(urlB);
  return Boolean(originA && originB && originA === originB);
}

export function isOfficialServer(serverUrl: string | null | undefined): boolean {
  const host = extractHost(serverUrl);
  if (!host) {
    return true;
  }
  return (
    host === "bitwarden.com" ||
    host.endsWith(".bitwarden.com") ||
    host === "bitwarden.eu" ||
    host.endsWith(".bitwarden.eu")
  );
}

export function getIconBaseUrl(serverUrl: string | null | undefined): string {
  if (isOfficialServer(serverUrl)) {
    return "https://icons.bitwarden.net";
  }
  let normalized = String(serverUrl ?? "").trim();
  if (!normalized) {
    return "https://icons.bitwarden.net";
  }
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  normalized = normalized
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "")
    .replace(/\/identity$/i, "")
    .replace(/\/+$/, "");
  return `${normalized}/icons`;
}

export function resolveIconUrl(
  serverUrl: string | null | undefined,
  domain: string | null | undefined,
): string {
  if (!domain) {
    return "";
  }
  return `${getIconBaseUrl(serverUrl)}/${domain}/icon.png`;
}

export function isAppScheme(uri: string): boolean {
  const lowered = uri.trim().toLowerCase();
  return APP_SCHEMES.some((scheme) => lowered.startsWith(scheme));
}

/** Extracts the hostname used by the icon service from a login URI. */
export function extractDomain(uri: string | null | undefined): string {
  if (!uri) {
    return "";
  }
  const trimmed = String(uri).trim();
  if (!trimmed || isAppScheme(trimmed)) {
    return "";
  }
  const host = extractHost(trimmed);
  if (!host) {
    return "";
  }
  const cleaned = host.replace(/^www\./i, "");
  if (!cleaned.includes(".") && cleaned !== "localhost") {
    return "";
  }
  return cleaned;
}

/** The first usable login URI's icon domain, or "" when none is usable. */
export function iconDomainFor(uris: string[] | null | undefined): string {
  for (const uri of uris ?? []) {
    const domain = extractDomain(uri);
    if (domain) {
      return domain;
    }
  }
  return "";
}

/** Resolves a row's icon URL, or "" when it draws the category glyph. */
export function iconFor(
  serverUrl: string | null | undefined,
  uris: string[] | null | undefined,
  enabled: boolean,
  failed: (domain: string) => boolean,
): string {
  if (!enabled) {
    return "";
  }
  const domain = iconDomainFor(uris);
  if (!domain || failed(domain)) {
    return "";
  }
  return resolveIconUrl(serverUrl, domain);
}

export function urlToLocalPath(fileUrl: string | null | undefined): string {
  if (!fileUrl) {
    return "";
  }
  let value = String(fileUrl);
  if (value.startsWith("file://")) {
    value = value.slice(7);
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
