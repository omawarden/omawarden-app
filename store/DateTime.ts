/**
 * Timestamp formatting for every place the interface shows a moment.
 *
 * The engine hands out ISO-8601 instants in UTC: a cipher's creation and
 * revision dates, the last successful sync, a replaced password, and a
 * release's publication. They are shown on the reader's own clock, with the
 * zone spelled out, so a value means the same thing wherever it is read.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `GMT+8`, `GMT-5` or `GMT+5:30`: the zone `date` is read in. */
export function gmtOffset(date: Date): string {
  // `getTimezoneOffset` counts minutes *behind* UTC, so the sign flips.
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return rest === 0 ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${pad(rest)}`;
}

/**
 * `YYYY-MM-DD HH:mm GMT+X` on the reader's clock, or "" when there is no
 * value. A string that is not a timestamp comes back as it went in, so an
 * engine that hands over something unexpected still shows something.
 */
export function formatLocalDateTime(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (raw === "") {
    return "";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())} ${gmtOffset(date)}`
  );
}
