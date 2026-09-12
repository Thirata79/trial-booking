/**
 * 空き枠の算出（spec §6「空き枠の算出」）。
 *
 * DB を直接触らず AvailabilityRepo 越しに読む。デモ用のメモリ実装と
 * Supabase 実装を差し替えられるようにするため。
 */

import {
  addDays,
  parseTimeOfDay,
  partsInZone,
  toCalendarDate,
  toISODate,
  weekdayOf,
  zonedToUtc,
} from './time.js';

export type Timeband = 'weekday_pm' | 'weekend_pm';

export type Slot = {
  id: string;
  /** 0=Sun */
  weekday: number;
  /** 'HH:MM' または 'HH:MM:SS' */
  startTime: string;
  durationMin: number;
  capacity: number;
  timeband: Timeband;
};

/** slotId が null なら、その日は全枠クローズ（spec §5）。 */
export type SlotException = { date: string; slotId: string | null };

export type AvailabilitySettings = {
  timezone: string;
  /** 前日のこの時刻で締め切る（施設TZ基準） */
  bookingCutoffHour: number;
  slotHorizonDays: number;
};

export type Occurrence = {
  slotId: string;
  /** 'YYYY-MM-DD'（施設TZのカレンダー上の日付） */
  date: string;
  startAt: Date;
  durationMin: number;
  /** 受け入れ人数の上限 */
  capacity: number;
  /** すでに埋まっている人数（予約件数ではない） */
  booked: number;
  /** あと何名入れるか */
  remaining: number;
};

export type AvailabilityRepo = {
  getSettings(): Promise<AvailabilitySettings>;
  listActiveSlots(timeband: Timeband): Promise<Slot[]>;
  listExceptions(fromDate: string, toDate: string): Promise<SlotException[]>;
  /**
   * キーは occurrenceKey(slotId, date)。confirmed の **人数の合計**。
   * 1予約が複数名を連れてくるため、件数ではなく party_size の和で数える。
   */
  countConfirmed(fromDate: string, toDate: string): Promise<Map<string, number>>;
};

/** 13個目は「別の日を相談」に充てるため、枠は最大12件（spec §6, §7）。 */
export const MAX_OCCURRENCES = 12;

export function occurrenceKey(slotId: string, date: string): string {
  return `${slotId}|${date}`;
}

export async function availableOccurrences(
  repo: AvailabilityRepo,
  timeband: Timeband,
  now: Date,
): Promise<Occurrence[]> {
  const settings = await repo.getSettings();
  const slots = await repo.listActiveSlots(timeband);
  if (slots.length === 0) return [];

  const today = toCalendarDate(partsInZone(now, settings.timezone));
  const lastDay = addDays(today, settings.slotHorizonDays);
  const [fromDate, toDate] = [toISODate(today), toISODate(lastDay)];

  const [exceptions, booked] = await Promise.all([
    repo.listExceptions(fromDate, toDate),
    repo.countConfirmed(fromDate, toDate),
  ]);

  // その日を丸ごと閉じる指定と、枠単位で閉じる指定を分けて持つ。
  const closedDays = new Set<string>();
  const closedSlots = new Set<string>();
  for (const e of exceptions) {
    if (e.slotId === null) closedDays.add(e.date);
    else closedSlots.add(occurrenceKey(e.slotId, e.date));
  }

  const byWeekday = new Map<number, Slot[]>();
  for (const slot of slots) {
    const list = byWeekday.get(slot.weekday);
    if (list) list.push(slot);
    else byWeekday.set(slot.weekday, [slot]);
  }

  const found: Occurrence[] = [];

  // 「now から slot_horizon_days 先まで」なので、当日を含めて horizon+1 日ぶん見る。
  for (let offset = 0; offset <= settings.slotHorizonDays; offset += 1) {
    const date = addDays(today, offset);
    const iso = toISODate(date);
    if (closedDays.has(iso)) continue;

    // 締切は「前日の bookingCutoffHour 時」。その瞬間を過ぎた日付は丸ごと落ちる。
    // 境界は spec §6 の元の式（cutoff <= now を除外）に合わせ、ちょうどは締切済みとする。
    const cutoff = zonedToUtc(addDays(date, -1), settings.bookingCutoffHour, 0, settings.timezone);
    if (cutoff.getTime() <= now.getTime()) continue;

    for (const slot of byWeekday.get(weekdayOf(date)) ?? []) {
      const key = occurrenceKey(slot.id, iso);
      if (closedSlots.has(key)) continue;

      const taken = booked.get(key) ?? 0;
      if (taken >= slot.capacity) continue;

      const { hour, minute } = parseTimeOfDay(slot.startTime);
      found.push({
        slotId: slot.id,
        date: iso,
        startAt: zonedToUtc(date, hour, minute, settings.timezone),
        durationMin: slot.durationMin,
        capacity: slot.capacity,
        booked: taken,
        remaining: slot.capacity - taken,
      });
    }
  }

  found.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return found.slice(0, MAX_OCCURRENCES);
}

/**
 * timeband を問わず、直近から順に候補を返す（CV優先の導線）。
 *
 * 時間帯の選択を1段挟むより、最短の候補を直に見せた方が離脱が少ない。
 * 都合が合わない人向けの逃げ道は「他の日時を見る」で timeband 選択に回す。
 */
export async function soonestOccurrences(
  repo: AvailabilityRepo,
  now: Date,
  limit: number,
): Promise<Occurrence[]> {
  const bands: Timeband[] = ['weekday_pm', 'weekend_pm'];
  const lists = await Promise.all(bands.map((band) => availableOccurrences(repo, band, now)));
  return lists
    .flat()
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, limit);
}
