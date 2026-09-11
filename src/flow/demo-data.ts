/**
 * Supabase を用意するまでの代用データ。
 *
 * ここにあるのは settings テーブルの1行と slots テーブルの21行に相当する。
 * **Supabase を繋いだらこのファイルごと消す。**
 * 値の出所は docs/spec.md §2-1（体験枠）と §2-9（施設情報）。
 */

import type { Venue } from '../line/messages.js';
import type { AvailabilitySettings, Slot, Timeband } from '../slots/availability.js';

export const DEMO_SETTINGS: AvailabilitySettings = {
  timezone: 'Asia/Tokyo',
  bookingCutoffHour: 18,
  slotHorizonDays: 14,
};

export const DEMO_VENUE: Venue = {
  name: 'SUPREME LAB',
  address: '〒106-0041 東京都港区麻布台1-11-5',
  access: '日比谷線 神谷町駅から徒歩5分',
  bring: '着替え',
};

export const CONVERSATION_TTL_HOURS = 24;

/** 月〜日 × 12:00 / 14:00 / 16:00、各60分・定員2名（spec §2-1）。 */
export function demoSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const timeband: Timeband = weekday >= 1 && weekday <= 5 ? 'weekday_pm' : 'weekend_pm';
    for (const startTime of ['12:00:00', '14:00:00', '16:00:00']) {
      slots.push({
        id: `w${weekday}-${startTime.slice(0, 2)}`,
        weekday,
        startTime,
        durationMin: 60,
        capacity: 2,
        timeband,
      });
    }
  }
  return slots;
}
