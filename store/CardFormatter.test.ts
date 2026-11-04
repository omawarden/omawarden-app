import { expect, test } from "nsh/test";
import {
  cleanCardNumber,
  formatMaskedCardNumber,
  formatRevealedCardNumber,
  getCardSegments,
  sanitizeCardNumberForCopy,
} from "./CardFormatter";

test("card formatter cleans digits and grouping", () => {
  expect(cleanCardNumber("4111-1111 1111.1111")).toBe("4111111111111111");
  expect(cleanCardNumber(null)).toBe("");
  expect(sanitizeCardNumberForCopy("4111 1111 1111 1111")).toBe("4111111111111111");
  expect(getCardSegments("4111111111111111", "Visa")).toEqual([4, 4, 4, 4]);
  expect(getCardSegments("5555555555554444", "Mastercard")).toEqual([4, 4, 4, 4]);
});

test("card formatter uses issuer-specific grouping", () => {
  expect(formatRevealedCardNumber("4111111111111111", "Visa")).toBe("4111 1111 1111 1111");
  expect(formatRevealedCardNumber("378282246310005", "American Express")).toBe(
    "3782 822463 10005",
  );
  expect(formatRevealedCardNumber("36123456789012", "Diners Club")).toBe("3612 345678 9012");
  expect(getCardSegments("378282246310005", "Amex")).toEqual([4, 6, 5]);
  expect(getCardSegments("36123456789012", "Diners")).toEqual([4, 6, 4]);
});

test("card formatter masks numbers with issuer grouping", () => {
  expect(formatMaskedCardNumber("4111111111111111", "Visa")).toBe("•••• •••• •••• 1111");
  expect(formatMaskedCardNumber("378282246310005", "Amex")).toBe("•••• •••••• •0005");
  expect(formatMaskedCardNumber("36123456789012", "Diners")).toBe("•••• •••••• 9012");
  // An already-masked value keeps its grouping and hidden-digit count.
  expect(formatMaskedCardNumber("•••• •••• •••• 1111", "Visa")).toBe("•••• •••• •••• 1111");
});

test("card formatter handles short and empty input", () => {
  expect(formatRevealedCardNumber("")).toBe("");
  expect(formatRevealedCardNumber("1234")).toBe("1234");
  expect(formatMaskedCardNumber("")).toBe("•••• •••• •••• ••••");
  expect(formatMaskedCardNumber("1234")).toBe("••••");
  expect(formatMaskedCardNumber("12")).toBe("••");
});
