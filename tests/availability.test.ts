import { describe, expect, it } from 'vitest';
import {
  MAX_OCCURRENCES,
  availableOccurrences,
  occurrenceKey,
  type AvailabilityRepo,
  type AvailabilitySettings,
  type Slot,
  type SlotException,
  type Timeband,
} from '../src/slots/availability.js';

const TZ = 'Asia/Tokyo';

/** '2026-09-11T10:00:00' を JST として解釈する。 */
function jst(local: string): Date {
  return new Date(`${local}+09:00`);
}

/** 確定した体験枠そのもの：月〜日 × 12:00 / 14:00 / 16:00、定員2（spec §2-1）。 */
function realSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    for (const startTime of ['12:00:00', '14:00:00', '16:00:00']) {
      slots.push({
        id: `w${weekday}-${startTime.slice(0, 2)}`,
        weekday,
        startTime,
        durationMin: 60,
        capacity: 2,
        timeband: weekday >= 1 && weekday <= 5 ? 'weekday_pm' : 'weekend_pm',
      });
    }
  }
  return slots;
}

function makeRepo(opts: {
  slots?: Slot[];
  exceptions?: SlotException[];
  booked?: Record<string, number>;
  settings?: Partial<AvailabilitySettings>;
} = {}): AvailabilityRepo {
  const slots = opts.slots ?? realSlots();
  const settings: AvailabilitySettings = {
    timezone: TZ,
    bookingCutoffHour: 18,
    slotHorizonDays: 14,
    ...opts.settings,
  };
  return {
    getSettings: async () => settings,
    listActiveSlots: async (timeband: Timeband) => slots.filter((s) => s.timeband === timeband),
    listExceptions: async () => opts.exceptions ?? [],
    countConfirmed: async () => new Map(Object.entries(opts.booked ?? {})),
  };
}

const dates = (occ: { date: string }[]) => [...new Set(occ.map((o) => o.date))];

describe('availableOccurrences / 締切', () => {
  // 2026-09-11 は金曜。土曜 09-12 の締切は前日18:00 = 09-11 18:00 JST。
  it('締切ちょうどの1ミリ秒前なら、その日はまだ出る', async () => {
    const occ = await availableOccurrences(makeRepo(), 'weekend_pm', jst('2026-09-11T17:59:59.999'));
    expect(dates(occ)).toContain('2026-09-12');
  });

  it('締切ちょうどは、もう出ない', async () => {
    const occ = await availableOccurrences(makeRepo(), 'weekend_pm', jst('2026-09-11T18:00:00.000'));
    expect(dates(occ)).not.toContain('2026-09-12');
    // 翌々日は締切前なので残る
    expect(dates(occ)).toContain('2026-09-13');
  });

  it('当日の枠は出ない（締切は前日18:00のため、当日は必ず締切済み）', async () => {
    const occ = await availableOccurrences(makeRepo(), 'weekday_pm', jst('2026-09-11T09:00:00'));
    expect(dates(occ)).not.toContain('2026-09-11');
  });
});

describe('availableOccurrences / 定員', () => {
  const now = jst('2026-09-11T10:00:00');

  it('定員ちょうどまで埋まった枠は出ない', async () => {
    const repo = makeRepo({ booked: { [occurrenceKey('w1-12', '2026-09-14')]: 2 } });
    const occ = await availableOccurrences(repo, 'weekday_pm', now);
    expect(occ.find((o) => o.slotId === 'w1-12' && o.date === '2026-09-14')).toBeUndefined();
  });

  it('定員に1つ空きがあれば出る', async () => {
    const repo = makeRepo({ booked: { [occurrenceKey('w1-12', '2026-09-14')]: 1 } });
    const occ = await availableOccurrences(repo, 'weekday_pm', now);
    expect(occ.find((o) => o.slotId === 'w1-12' && o.date === '2026-09-14')).toMatchObject({
      booked: 1,
      capacity: 2,
    });
  });

  it('定員を超えて入っていても出ない', async () => {
    const repo = makeRepo({ booked: { [occurrenceKey('w1-12', '2026-09-14')]: 3 } });
    const occ = await availableOccurrences(repo, 'weekday_pm', now);
    expect(occ.find((o) => o.slotId === 'w1-12' && o.date === '2026-09-14')).toBeUndefined();
  });

  it('埋まっているのは該当の日付だけで、同じ枠の別日は出る', async () => {
    // 全枠だと12件上限で翌週まで届かないため、月曜12:00の枠だけに絞る
    const mondayOnly = realSlots().filter((s) => s.weekday === 1 && s.startTime === '12:00:00');
    const repo = makeRepo({
      slots: mondayOnly,
      booked: { [occurrenceKey('w1-12', '2026-09-14')]: 2 },
    });
    const occ = await availableOccurrences(repo, 'weekday_pm', now);
    expect(dates(occ)).toEqual(['2026-09-21']);
  });
});

describe('availableOccurrences / 例外日', () => {
  const now = jst('2026-09-11T10:00:00');

  it('slot_id が null の例外は、その日を丸ごと閉じる', async () => {
    const repo = makeRepo({ exceptions: [{ date: '2026-09-14', slotId: null }] });
    const occ = await availableOccurrences(repo, 'weekday_pm', now);
    expect(dates(occ)).not.toContain('2026-09-14');
    expect(dates(occ)).toContain('2026-09-15');
  });

  it('slot_id 指定の例外は、その枠だけを閉じる', async () => {
    const repo = makeRepo({ exceptions: [{ date: '2026-09-14', slotId: 'w1-12' }] });
    const occ = await availableOccurrences(repo, 'weekday_pm', now);
    const onThatDay = occ.filter((o) => o.date === '2026-09-14');
    expect(onThatDay.map((o) => o.slotId)).toEqual(['w1-14', 'w1-16']);
  });
});

describe('availableOccurrences / 提示範囲と並び', () => {
  const now = jst('2026-09-11T10:00:00');

  it('最大12件までしか返さない', async () => {
    const occ = await availableOccurrences(makeRepo(), 'weekday_pm', now);
    expect(occ).toHaveLength(MAX_OCCURRENCES);
  });

  it('開始時刻の昇順で返る', async () => {
    const occ = await availableOccurrences(makeRepo(), 'weekday_pm', now);
    const times = occ.map((o) => o.startAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('horizon を超えた日付は出ない', async () => {
    // 月曜だけの枠にして、14日先までに何が入るかを見る
    const mondayOnly = realSlots().filter((s) => s.weekday === 1 && s.startTime === '12:00:00');
    const occ = await availableOccurrences(
      makeRepo({ slots: mondayOnly }),
      'weekday_pm',
      now,
    );
    // 09-11(金) から14日先は 09-25。その間の月曜は 09-14 と 09-21 のみ。
    expect(dates(occ)).toEqual(['2026-09-14', '2026-09-21']);
  });

  it('timeband が一致する枠だけを見る', async () => {
    const weekend = await availableOccurrences(makeRepo(), 'weekend_pm', now);
    for (const o of weekend) {
      // date は施設TZのカレンダー日。UTC として素直に読んで曜日を取る
      const weekday = new Date(`${o.date}T00:00:00Z`).getUTCDay();
      expect([0, 6]).toContain(weekday);
    }
  });

  it('枠が無ければ空を返す', async () => {
    const occ = await availableOccurrences(makeRepo({ slots: [] }), 'weekday_pm', now);
    expect(occ).toEqual([]);
  });
});

describe('availableOccurrences / 時刻の変換', () => {
  it('startAt が施設TZの時刻を指す（12:00 JST = 03:00 UTC）', async () => {
    const occ = await availableOccurrences(
      makeRepo(),
      'weekday_pm',
      jst('2026-09-11T10:00:00'),
    );
    const first = occ[0]!;
    expect(first.date).toBe('2026-09-14');
    expect(first.startAt.toISOString()).toBe('2026-09-14T03:00:00.000Z');
  });
});
