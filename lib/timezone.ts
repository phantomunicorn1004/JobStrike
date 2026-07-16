export const DEFAULT_TIMEZONE = "America/New_York";

export const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
] as const;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isValidTimeZone(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return isValidTimeZone(trimmed) ? trimmed! : DEFAULT_TIMEZONE;
}

export function getTimeZoneOptionLabel(timeZone: string): string {
  const normalized = normalizeTimeZone(timeZone);
  try {
    const parts = normalized.split("/");
    const city = parts[parts.length - 1]?.replace(/_/g, " ") || normalized;
    const region = parts.length > 1 ? parts[0] : "Timezone";
    return `${city} (${region})`;
  } catch {
    return normalized;
  }
}

export function formatIsoInTimeZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: normalizeTimeZone(timeZone),
  }).format(date);
}

export function formatYmdInTimeZone(
  ymd: string,
  _timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: "UTC",
  }).format(date);
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const byType = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

export function getDayKeyInTimeZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function todayInTimeZone(timeZone: string): string {
  return getDayKeyInTimeZone(new Date().toISOString(), timeZone);
}

function zonedDateTimeToUtcIso(
  ymd: string,
  timeZone: string,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const targetAsUtc = Date.UTC(y, m - 1, d, hour, minute, second, ms);
  let guess = new Date(targetAsUtc);

  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(guess, timeZone);
    const observedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      ms,
    );
    const diff = targetAsUtc - observedAsUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return guess.toISOString();
}

export function startOfDayUtcIso(ymd: string, timeZone: string): string {
  return zonedDateTimeToUtcIso(ymd, timeZone, 0, 0, 0, 0);
}

export function endOfDayUtcIso(ymd: string, timeZone: string): string {
  return zonedDateTimeToUtcIso(ymd, timeZone, 23, 59, 59, 999);
}

