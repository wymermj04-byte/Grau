const calendarInputPattern = /^(\d{2})-(\d{2})-(\d{2})$/;
const databaseDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Formats a stored YYYY-MM-DD calendar value without constructing a local Date. */
export function formatCalendarDate(value: string | null | undefined) {
  const match = typeof value === 'string' ? databaseDatePattern.exec(value) : null;
  if (!match || !isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return 'Date unavailable';
  return `${match[2]}-${match[3]}-${match[1].slice(-2)}`;
}

/** Formats an instant in the requested timezone; defaults to the device timezone. */
export function formatTimestampDate(value: string | null | undefined, timeZone?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Date unavailable';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(value));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('month')}-${values.get('day')}-${values.get('year')}`;
}

export function formatTimestampTime(value: string | null | undefined, timeZone?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

/** Converts a staff-entered MM-DD-YY date to the unchanged database YYYY-MM-DD value. */
export function parseCalendarDateInput(value: string) {
  const match = calendarInputPattern.exec(value.trim());
  if (!match) return null;
  const year = 2000 + Number(match[3]);
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!isRealCalendarDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isRealCalendarDate(year: number, month: number, day: number) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
