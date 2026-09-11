import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineClient, LineMessage } from '../src/line/client.js';
import { createFlow } from '../src/flow/machine.js';
import { createMemoryStores, type MemoryStores } from '../src/flow/memory-store.js';
import type { IncomingEvent } from '../src/flow/types.js';

const USER = 'U-test-user';
// 2026-09-11 は金曜。締切は前日18:00なので、最短の候補は 09-13(日) から。
const NOW = new Date('2026-09-11T10:00:00+09:00');

function textOf(messages: LineMessage[]): string {
  return messages.map((m) => (m.type === 'text' ? m.text : m.template.text)).join('\n');
}

function quickReplyData(messages: LineMessage[]): string[] {
  const first = messages[0];
  if (!first || first.type !== 'text') return [];
  return (first.quickReply?.items ?? []).map((i) => i.action.data);
}

function buttonData(messages: LineMessage[]): string[] {
  const first = messages[0];
  if (!first || first.type !== 'template') return [];
  return first.template.actions.map((a) => a.data);
}

describe('会話フロー', () => {
  let stores: MemoryStores;
  let sent: LineMessage[][];
  let line: LineClient;
  let flow: ReturnType<typeof createFlow>;
  let now: Date;

  function flowFor() {
    return createFlow({
      now: () => now,
      settings: stores.settings,
      availability: stores.availability,
      bookings: stores.bookings,
      states: stores.states,
      events: stores.events,
      line,
      onError: () => {},
    });
  }

  beforeEach(() => {
    now = NOW;
    stores = createMemoryStores();
    sent = [];
    line = {
      reply: vi.fn(async (_t: string, messages: LineMessage[]) => {
        sent.push(messages);
      }),
      push: vi.fn(async () => {}),
    };
    flow = flowFor();
  });

  const as = (userId: string, event: Partial<IncomingEvent>) =>
    flow.handleEvent({ replyToken: 'rt', source: { userId }, ...event } as IncomingEvent);

  const text = (value: string, userId = USER) =>
    as(userId, { type: 'message', message: { type: 'text', text: value } });
  const postback = (data: string, userId = USER) =>
    as(userId, { type: 'postback', postback: { data } });

  /** 最短候補 → 人数 → 氏名 の順に通す。 */
  async function bookThrough(name = '平田', userId = USER, party = '1'): Promise<string> {
    await text('無料体験', userId);
    const slot = quickReplyData(sent.at(-1)!)[0]!;
    await postback(slot, userId);
    await postback(`action=party&n=${party}`, userId);
    await text(name, userId);
    return slot;
  }

  it('入口でいきなり最短5件＋他の日時＋相談が出る', async () => {
    await text('無料体験');
    const items = quickReplyData(sent[0]!);

    expect(items).toHaveLength(7);
    expect(items.slice(0, 5).every((d) => d.startsWith('action=slot&'))).toBe(true);
    expect(items[5]).toBe('action=more');
    expect(items[6]).toBe('action=consult');
    expect(textOf(sent[0]!)).toContain('ご希望の日時');
  });

  it('候補は開始が早い順に並び、時間帯の区別なく混ざる', async () => {
    await text('無料体験');
    const items = (sent[0]![0] as Extract<LineMessage, { type: 'text' }>).quickReply!.items.slice(0, 5);

    // 金曜10時なら、締切（前日18時）を過ぎていない最短は翌日の土曜
    expect(items[0]!.action.label).toBe('9/12(土) 12:00');
    expect(items.map((i) => i.action.label)).toEqual([
      '9/12(土) 12:00',
      '9/12(土) 14:00',
      '9/12(土) 16:00',
      '9/13(日) 12:00',
      '9/13(日) 14:00',
    ]);
  });

  it('平日しか空いていなければ平日が最短候補に出る', async () => {
    // 週末を全部閉じると、最短は 09-14(月) になる
    const noWeekend = createMemoryStores({
      exceptions: [
        { date: '2026-09-12', slotId: null },
        { date: '2026-09-13', slotId: null },
      ],
    });
    const scoped = createFlow({
      now: () => now,
      settings: noWeekend.settings,
      availability: noWeekend.availability,
      bookings: noWeekend.bookings,
      states: noWeekend.states,
      events: noWeekend.events,
      line,
      onError: () => {},
    });
    await scoped.handleEvent({
      type: 'message',
      replyToken: 'rt',
      source: { userId: USER },
      message: { type: 'text', text: '無料体験' },
    } as IncomingEvent);

    const label = (sent.at(-1)![0] as Extract<LineMessage, { type: 'text' }>).quickReply!.items[0]!
      .action.label;
    expect(label).toBe('9/14(月) 12:00');
  });

  it('枠を選ぶと人数を聞き、名前を経て確定する', async () => {
    await text('無料体験');
    await postback(quickReplyData(sent.at(-1)!)[0]!);
    expect(buttonData(sent.at(-1)!)).toEqual(['action=party&n=1', 'action=party&n=2']);

    await postback('action=party&n=2');
    expect(textOf(sent.at(-1)!)).toContain('2名');

    await text('平田');
    const confirmation = textOf(sent.at(-1)!);
    expect(confirmation).toContain('平田さま（2名）');
    expect(confirmation).toContain('SUPREME LAB');

    const { bookings } = stores.snapshot();
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.partySize).toBe(2);
  });

  it('2名で埋まった枠は候補から消える', async () => {
    await text('無料体験');
    const target = quickReplyData(sent.at(-1)!)[0]!;
    await postback(target);
    await postback('action=party&n=2');
    await text('平田');

    await text('無料体験', 'U-other');
    expect(quickReplyData(sent.at(-1)!)).not.toContain(target);
  });

  it('残り1名の枠では人数を聞かず、そのまま名前に進む', async () => {
    // 先に1名で埋めて、残りを1名分にする
    await text('無料体験', 'U-first');
    const target = quickReplyData(sent.at(-1)!)[0]!;
    await postback(target, 'U-first');
    await postback('action=party&n=1', 'U-first');
    await text('先客', 'U-first');

    await text('無料体験');
    expect(quickReplyData(sent.at(-1)!)).toContain(target);
    await postback(target);

    // 人数を飛ばして名前を聞いている
    expect(textOf(sent.at(-1)!)).toContain('お名前');

    await text('平田');
    const { bookings } = stores.snapshot();
    expect(bookings).toHaveLength(2);
    expect(bookings.every((b) => b.partySize === 1)).toBe(true);
  });

  it('「他の日時を見る」で時間帯の絞り込みに回る', async () => {
    await text('無料体験');
    await postback('action=more');
    expect(buttonData(sent.at(-1)!)).toEqual([
      'action=band&v=weekday_pm',
      'action=band&v=weekend_pm',
      'action=consult',
    ]);

    await postback('action=band&v=weekday_pm');
    const items = quickReplyData(sent.at(-1)!);
    expect(items).toHaveLength(13);
    expect(items.at(-1)).toBe('action=consult');
  });

  it('絞り込み経由でも予約が成立する', async () => {
    await text('無料体験');
    await postback('action=more');
    await postback('action=band&v=weekday_pm');
    await postback(quickReplyData(sent.at(-1)!)[0]!);
    await postback('action=party&n=1');
    await text('平田');

    expect(textOf(sent.at(-1)!)).toContain('平田さま');
    expect(stores.snapshot().bookings).toHaveLength(1);
  });

  it('確定後は再度送ると既存予約を知らせる', async () => {
    await bookThrough();
    await text('無料体験');
    expect(textOf(sent.at(-1)!)).toContain('すでに');
    expect(stores.snapshot().bookings).toHaveLength(1);
  });

  it('想定外のテキストは1回だけ再提示し、2回目で HUMAN になる', async () => {
    await text('無料体験');
    await text('ぜんぜん関係ない話');
    expect(quickReplyData(sent.at(-1)!).length).toBeGreaterThan(0);

    await text('またずれた話');
    expect(textOf(sent.at(-1)!)).toContain('担当者よりご連絡します');

    const before = sent.length;
    await text('もしもし');
    expect(sent).toHaveLength(before);
  });

  it('相談を選ぶと HUMAN になり、通常の入力には応答しない', async () => {
    await text('無料体験');
    await postback('action=consult');
    expect(textOf(sent.at(-1)!)).toContain('担当者よりご連絡します');

    const before = sent.length;
    await text('すみません');
    expect(sent).toHaveLength(before);
  });

  it('HUMAN 中でも「キャンセル」は受ける', async () => {
    await bookThrough();
    await text('相談');
    await postback('action=consult');

    await text('キャンセル');
    expect(textOf(sent.at(-1)!)).toContain('キャンセルしました');
    expect(stores.snapshot().bookings).toHaveLength(0);
  });

  it('キャンセルすると枠が解放され、同じ枠が再び出る', async () => {
    const target = await bookThrough('平田', USER, '2');
    await text('キャンセル');
    expect(stores.snapshot().bookings).toHaveLength(0);

    await text('無料体験');
    expect(quickReplyData(sent.at(-1)!)).toContain(target);
  });

  it('予約が無いのにキャンセルすると、その旨を返す', async () => {
    await text('キャンセル');
    expect(textOf(sent.at(-1)!)).toContain('ご予約はありません');
  });

  it('変更すると予約を取り消して最短候補から再開する', async () => {
    await bookThrough();
    await text('変更');
    expect(stores.snapshot().bookings).toHaveLength(0);
    expect(quickReplyData(sent.at(-1)!).length).toBeGreaterThan(0);
  });

  it('24時間放置した会話は IDLE に戻る', async () => {
    await text('無料体験');
    await postback(quickReplyData(sent.at(-1)!)[0]!);

    now = new Date(NOW.getTime() + 25 * 3600_000);
    await text('こんにちは');

    // 人数の再提示ではなく、入口からやり直しになる
    expect(quickReplyData(sent.at(-1)!)).toContain('action=more');
  });

  it('友だち追加でも候補を出す', async () => {
    await as(USER, { type: 'follow' });
    expect(quickReplyData(sent.at(-1)!).length).toBeGreaterThan(0);
  });

  it('userId が無いイベントは無視する', async () => {
    await flow.handleEvent({ type: 'message', replyToken: 'rt', message: { type: 'text', text: 'hi' } } as IncomingEvent);
    expect(sent).toHaveLength(0);
  });
});
