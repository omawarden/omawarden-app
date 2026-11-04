/**
 * Card number formatting, ported from `omarchy-bitwarden/components/CardFormatter.js`.
 *
 * Card numbers are grouped by issuer: American Express uses 4-6-5, Diners Club
 * uses 4-6-4, and everything else uses groups of four. Masked numbers keep the
 * same grouping and reveal only the last four digits.
 */

export function cleanCardNumber(num: string | null | undefined): string {
  if (num === null || num === undefined) {
    return "";
  }
  return String(num).replace(/\D/g, "");
}

export function sanitizeCardNumberForCopy(num: string | null | undefined): string {
  return cleanCardNumber(num);
}

export function getCardSegments(cleanDigits: string, brand: string | null | undefined): number[] {
  const length = cleanDigits ? cleanDigits.length : 0;
  if (length <= 4) {
    return [length];
  }

  const normalizedBrand = (brand ?? "").toLowerCase().trim().replace(/[\s_-]+/g, "");
  const isAmexBrand = normalizedBrand === "amex" || normalizedBrand.includes("americanexpress");
  const isAmexBin = cleanDigits.startsWith("34") || cleanDigits.startsWith("37");
  if (length === 15 && (isAmexBin || isAmexBrand)) {
    return [4, 6, 5];
  }

  const isDinersBrand = normalizedBrand.includes("diners");
  const isDinersBin =
    cleanDigits.startsWith("36") ||
    cleanDigits.startsWith("38") ||
    ["300", "301", "302", "303", "304", "305"].some((prefix) =>
      cleanDigits.startsWith(prefix),
    );
  if (length === 14 && (isDinersBin || isDinersBrand)) {
    return [4, 6, 4];
  }

  const segments: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    const chunk = Math.min(4, remaining);
    segments.push(chunk);
    remaining -= chunk;
  }
  return segments;
}

function partition(text: string, segments: number[]): string {
  const parts: string[] = [];
  let index = 0;
  for (const size of segments) {
    if (index >= text.length) {
      break;
    }
    parts.push(text.slice(index, index + size));
    index += size;
  }
  if (index < text.length) {
    parts.push(text.slice(index));
  }
  return parts.join(" ");
}

export function formatRevealedCardNumber(
  num: string | null | undefined,
  brand?: string | null,
): string {
  const clean = cleanCardNumber(num);
  if (!clean) {
    return String(num ?? "");
  }
  if (clean.length <= 4) {
    return clean;
  }
  return partition(clean, getCardSegments(clean, brand));
}

export function formatMaskedCardNumber(
  num: string | null | undefined,
  brand?: string | null,
): string {
  const raw = String(num ?? "");
  const clean = cleanCardNumber(raw);
  const alreadyMasked = raw.includes("•");

  if (!clean && !alreadyMasked) {
    return "•••• •••• •••• ••••";
  }

  // An already-masked number keeps its bullet count, so the grouping still
  // matches the issuer without exposing the hidden digits.
  const length = alreadyMasked ? (raw.match(/[•\d]/g) ?? []).length : clean.length;
  if (length <= 4) {
    return alreadyMasked ? raw : "•".repeat(length);
  }

  const lastFour = clean.slice(-4).padStart(4, "•");
  const maskedRaw = `${"•".repeat(length - 4)}${lastFour}`;
  return partition(maskedRaw, getCardSegments("0".repeat(length), brand));
}
