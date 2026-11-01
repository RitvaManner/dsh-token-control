/**
 * Pure peak/off-peak calendar math. No IO, no clock reads: every function takes
 * the instant (`atMs`) it should reason about, so results are reproducible.
 *
 * Beijing time has no DST; we shift the instant by a fixed +08:00 and read UTC
 * fields, which is exact for every date this policy covers.
 */

export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} PeriodPolicy
 * @property {number} year
 * @property {readonly (readonly [string, string])[]} peakWindows
 * @property {number} offPeakRatioOfPeak
 * @property {readonly {name:string, from:string, to:string}[]} holidays
 * @property {readonly string[]} [makeUpWorkdays]
 * @property {boolean} [estimated]
 */

/** @typedef {'peak'|'idle'} PeriodKind */

/**
 * @param {number} atMs
 * @returns {{year:number, month:number, day:number, weekday:number, minutes:number, dateKey:string}}
 */
export function beijingParts(atMs) {
  const d = new Date(atMs + BEIJING_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const weekday = d.getUTCDay(); // 0 = Sunday
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { year, month, day, weekday, minutes, dateKey: dateKeyOf(year, month, day) };
}

/**
 * @param {number} year
 * @returns {number}
 */
export function beijingYear(atMs) {
  return new Date(atMs + BEIJING_OFFSET_MS).getUTCFullYear();
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @returns {string} YYYY-MM-DD
 */
export function dateKeyOf(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Start of the Beijing calendar day containing `atMs`, as an instant.
 * @param {number} atMs
 * @returns {number}
 */
export function beijingDayStart(atMs) {
  return Math.floor((atMs + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
}

/**
 * @param {string} hhmm
 * @returns {number} minutes since midnight
 */
function parseHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  if (m === null) throw new TypeError(`invalid HH:MM: ${String(hhmm)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * @param {PeriodPolicy} policy
 * @param {string} dateKey
 * @returns {{name:string, from:string, to:string}|undefined}
 */
export function holidayOn(policy, dateKey) {
  return policy.holidays.find((h) => h.from <= dateKey && dateKey <= h.to);
}

/**
 * A date is idle when it is a weekend or a statutory holiday.
 * @param {PeriodPolicy} policy
 * @param {ReturnType<typeof beijingParts>} parts
 * @returns {boolean}
 */
export function isIdleDate(policy, parts) {
  if (parts.weekday === 0 || parts.weekday === 6) return true;
  return holidayOn(policy, parts.dateKey) !== undefined;
}

/**
 * Segments of one Beijing calendar day, always covering [0, 1440).
 * @param {PeriodPolicy} policy
 * @param {string} dateKey
 * @param {number} weekday
 * @returns {{startMin:number, endMin:number, kind:PeriodKind}[]}
 */
export function daySegments(policy, dateKey, weekday) {
  if (weekday === 0 || weekday === 6 || holidayOn(policy, dateKey) !== undefined) {
    return [{ startMin: 0, endMin: 1440, kind: 'idle' }];
  }
  const windows = policy.peakWindows
    .map(([from, to]) => ({ startMin: parseHHMM(from), endMin: parseHHMM(to) }))
    .sort((a, b) => a.startMin - b.startMin);

  /** @type {{startMin:number, endMin:number, kind:PeriodKind}[]} */
  const segments = [];
  let cursor = 0;
  for (const peakRange of windows) {
    if (peakRange.startMin > cursor) segments.push({ startMin: cursor, endMin: peakRange.startMin, kind: 'idle' });
    segments.push({ startMin: peakRange.startMin, endMin: peakRange.endMin, kind: 'peak' });
    cursor = Math.max(cursor, peakRange.endMin);
  }
  if (cursor < 1440) segments.push({ startMin: cursor, endMin: 1440, kind: 'idle' });
  return segments;
}

/**
 * @param {PeriodPolicy} policy
 * @param {number} atMs
 * @returns {{kind:PeriodKind, dateKey:string, minutes:number}}
 */
export function getCurrentPeriod(policy, atMs) {
  const parts = beijingParts(atMs);
  const segments = daySegments(policy, parts.dateKey, parts.weekday);
  const hit = segments.find((s) => parts.minutes >= s.startMin && parts.minutes < s.endMin) ?? segments[segments.length - 1];
  return { kind: hit.kind, dateKey: parts.dateKey, minutes: parts.minutes };
}

/**
 * The first instant strictly after `atMs` at which the period kind changes.
 * Scans at most 11 Beijing days, which always contains a transition because
 * every day starts idle and peak windows never span midnight.
 *
 * @param {PeriodPolicy} policy
 * @param {number} atMs
 * @returns {{atMs:number, to:PeriodKind}}
 */
export function getNextTransition(policy, atMs) {
  const current = getCurrentPeriod(policy, atMs).kind;
  const today = beijingDayStart(atMs);
  for (let offset = 0; offset <= 11; offset += 1) {
    const dayStart = today + offset * DAY_MS;
    const parts = beijingParts(dayStart + 60 * 1000); // 00:01 resolves the correct date/weekday
    const segments = daySegments(policy, parts.dateKey, parts.weekday);
    for (const segment of segments) {
      const startMs = dayStart + segment.startMin * 60 * 1000;
      if (startMs <= atMs) continue;
      if (segment.kind !== current) return { atMs: startMs, to: segment.kind };
    }
  }
  // Unreachable with a valid policy; keep the provider total by returning the
  // next day boundary rather than throwing inside a render path.
  return { atMs: today + DAY_MS, to: current === 'peak' ? 'idle' : 'peak' };
}

/**
 * @param {PeriodPolicy} policy
 * @param {number} atMs
 * @returns {number} whole seconds until the next transition, never negative
 */
export function getRemainingSeconds(policy, atMs) {
  const next = getNextTransition(policy, atMs);
  return Math.max(0, Math.floor((next.atMs - atMs) / 1000));
}

/**
 * @param {PeriodPolicy} policy
 * @param {number} atMs
 * @returns {{kind:PeriodKind, next:number, to:PeriodKind, remainingSeconds:number}}
 */
export function describePeriod(policy, atMs) {
  const { kind } = getCurrentPeriod(policy, atMs);
  const next = getNextTransition(policy, atMs);
  return {
    kind,
    next: next.atMs,
    to: next.to,
    remainingSeconds: Math.max(0, Math.floor((next.atMs - atMs) / 1000)),
  };
}
