import { expect, test } from "nsh/test";
import { formatLocalDateTime, gmtOffset } from "./DateTime";

test("a timestamp reads as a local date, a time and a zone", () => {
  const formatted = formatLocalDateTime("2024-03-05T06:07:08Z");
  expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT[+-]\d+(:\d{2})?$/);
});

test("the wall clock and the zone come from the reader's clock", () => {
  const instant = new Date("2024-03-05T06:07:08Z");
  const zone = gmtOffset(instant);
  const minutes = -instant.getTimezoneOffset();
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "+";
  const expectedZone =
    rest === 0
      ? `GMT${sign}${hours}`
      : `GMT${sign}${hours}:${String(rest).padStart(2, "0")}`;
  expect(zone).toBe(expectedZone);

  const two = (value: number) => String(value).padStart(2, "0");
  expect(formatLocalDateTime("2024-03-05T06:07:08Z")).toBe(
    `${instant.getFullYear()}-${two(instant.getMonth() + 1)}-${two(instant.getDate())} ` +
      `${two(instant.getHours())}:${two(instant.getMinutes())} ${zone}`,
  );
});

test("a date without a time still lands on the reader's clock", () => {
  expect(formatLocalDateTime("2026-01-01")).toMatch(
    /^2026-01-01 \d{2}:\d{2} GMT[+-]\d+(:\d{2})?$/,
  );
});

test("no value formats as nothing", () => {
  expect(formatLocalDateTime(null)).toBe("");
  expect(formatLocalDateTime(undefined)).toBe("");
  expect(formatLocalDateTime("")).toBe("");
  expect(formatLocalDateTime("   ")).toBe("");
});

test("a value that is not a timestamp comes back unchanged", () => {
  expect(formatLocalDateTime("fixture")).toBe("fixture");
  expect(formatLocalDateTime("yesterday")).toBe("yesterday");
});
