/**
 * 施設のタイムゾーンと UTC の間の変換（spec §6「時刻」）。
 *
 * DB は timestamptz（UTC）で持ち、判定と表示は施設の TZ に変換する。
 * 外部ライブラリは使わず Intl に任せる。Asia/Tokyo は DST が無いが、
 * TZ を settings で持つ以上、DST のある TZ に変えられても壊れないようにしておく。
 */

/** 施設のカレンダー上の日付。UTC のずれを持ち込まないため数値で持つ。 */
export type CalendarDate = { year: number; month: number; day: number };

export type ZonedParts = CalendarDate & {
  hour: number;
  minute: number;
  second: number;
  /** 0=Sun。slots.weekday と同じ並び。 */
  weekday: number;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** ある瞬間を、指定 TZ のカレンダー上の年月日時分秒に分解する。 */
export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    second: Number(value('second')),
    weekday: WEEKDAYS.indexOf(value('weekday')),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
}

/**
 * 「施設TZでの年月日時分」を UTC の瞬間に変換する。
 *
 * オフセットは瞬間ごとに変わりうる（DST）ため、素の UTC 値で当たりをつけてから
 * その結果で引き直す。DST の切り替わり前後で1回では収束しないことがある。
 */
export function zonedToUtc(
  date: CalendarDate,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  const first = new Date(naive - offsetMs(new Date(naive), timeZone));
  return new Date(naive - offsetMs(first, timeZone));
}

export function toCalendarDate(parts: ZonedParts): CalendarDate {
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 0=Sun。slots.weekday と同じ並び。 */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** 'YYYY-MM-DD'。DB の date 型との受け渡しに使う。 */
export function toISODate(date: CalendarDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}-${mm}-${dd}`;
}

/** 'HH:MM' または 'HH:MM:SS' を分解する。DB の time 型は後者で返る。 */
export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) throw new Error(`時刻の形式が不正: ${value}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}
