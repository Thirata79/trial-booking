import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineClient, LineMessage } from '../src/line/client.js';
import { createFlow } from '../src/flow/machine.js';
import { createMemoryStores, type MemoryStores } from '../src/flow/memory-store.js';
import type { IncomingEvent } from '../src/flow/types.js';

const USER = 'U-test-user';
// 2026-09-11 は金曜。締切は前日18:00なので、最初に選べる平日は 09-14(月)。
const NOW = new Date('2026-09-11T10:00:00+09:00');

function textOf(messages: LineMessage[]): string {
  return messages
    .map((m) => (m.type === 'text' ? m.text : m.template.text))
    .join('\n');
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

  function makeFlow() {
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
      reply: vi.fn(async (_token: string, messages: LineMessage[]) => {
        sent.push(messages);
      }),
      push: vi.fn(async () => {}),
    };
    flow = makeFlow();
  });

  const send = (event: Partial<IncomingEvent>) =>
    flow.handleEvent({
      type: 'message',
      replyToken: 'rt',
      source: { userId: USER },
      ...event,
    } as IncomingEvent);

  const text = (value: string) =>
    send({ type: 'message', message: { type: 'text', text: value } });

  const postback = (data: string) => send({ type: 'postback', postback: { data } });

  /** 時間帯 → 枠 → 氏名 → 確定 を最後まで通す。 */
  async function bookThrough(name = '平田'): Promise<string> {
    await text('予約したい');
    await postback('action=band&v=weekday_pm');
    const slot = quickReplyData(sent.at(-1)!)[0]!;
    await postback(slot);
    await text(name);
    return slot;
  }

  it('テキストを送ると時間帯の選択肢が出る', async () => {
    await text('体験したいです');
    expect(buttonData(sent[0]!)).toEqual([
      'action=band&v=weekday_pm',
      'action=band&v=weekend_pm',
      'action=consult',
    ]);
  });

  it('時間帯を選ぶと空き枠が最大12件＋相談で出る', async () => {
    await text('予約');
    await postback('action=band&v=weekday_pm');
    const items = quickReplyData(sent.at(-1)!);
    expect(items).toHaveLength(13);
    expect(items.at(-1)).toBe('action=consult');
  });

  it('枠 → 氏名 → 確定まで通り、予約が1件できる', async () => {
    await bookThrough('平田');

    const confirmation = textOf(sent.at(-1)!);
    expect(confirmation).toContain('平田さま');
    expect(confirmation).toContain('SUPREME LAB');
    expect(confirmation).toContain('着替え');

    const { bookings } = stores.snapshot();
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.name).toBe('平田');
  });

  it('確定後は IDLE に戻り、再度送ると既存予約を知らせる', async () => {
    await bookThrough();
    await text('予約したい');
    expect(textOf(sent.at(-1)!)).toContain('すでに');
    expect(stores.snapshot().bookings).toHaveLength(1);
  });

  it('定員2が埋まると、その枠は選択肢から消える', async () => {
    await text('予約');
    await postback('action=band&v=weekday_pm');
    const target = quickReplyData(sent.at(-1)!)[0]!;

    for (const user of ['U-a', 'U-b']) {
      const scoped = createFlow({
        now: () => now,
        settings: stores.settings,
        availability: stores.availability,
        bookings: stores.bookings,
        states: stores.states,
        events: stores.events,
        line,
        onError: () => {},
      });
      await scoped.handleEvent({ type: 'message', replyToken: 'rt', source: { userId: user }, message: { type: 'text', text: 'x' } } as IncomingEvent);
      await scoped.handleEvent({ type: 'postback', replyToken: 'rt', source: { userId: user }, postback: { data: 'action=band&v=weekday_pm' } } as IncomingEvent);
      await scoped.handleEvent({ type: 'postback', replyToken: 'rt', source: { userId: user }, postback: { data: target } } as IncomingEvent);
      await scoped.handleEvent({ type: 'message', replyToken: 'rt', source: { userId: user }, message: { type: 'text', text: '氏名' } } as IncomingEvent);
    }

    await text('予約');
    await postback('action=band&v=weekday_pm');
    expect(quickReplyData(sent.at(-1)!)).not.toContain(target);
  });

  it('想定外のテキストは1回だけ再提示し、2回目で HUMAN になる', async () => {
    await text('予約');
    expect(sent).toHaveLength(1);

    await text('ぜんぜん関係ない話');
    expect(buttonData(sent.at(-1)!).length).toBeGreaterThan(0); // 再提示

    await text('またずれた話');
    expect(textOf(sent.at(-1)!)).toContain('担当者よりご連絡します');

    // 以後は応答しない
    const before = sent.length;
    await text('もしもし');
    expect(sent).toHaveLength(before);
  });

  it('相談を選ぶと HUMAN になり、以後応答しない', async () => {
    await text('予約');
    await postback('action=consult');
    expect(textOf(sent.at(-1)!)).toContain('担当者よりご連絡します');

    const before = sent.length;
    await text('すみません');
    expect(sent).toHaveLength(before);
  });

  it('キャンセルすると枠が解放され、同じ枠が再び出る', async () => {
    const target = await bookThrough();
    expect(stores.snapshot().bookings).toHaveLength(1);

    await text('キャンセル');
    expect(textOf(sent.at(-1)!)).toContain('キャンセルしました');
    expect(stores.snapshot().bookings).toHaveLength(0);

    await text('予約');
    await postback('action=band&v=weekday_pm');
    expect(quickReplyData(sent.at(-1)!)).toContain(target);
  });

  it('予約が無いのにキャンセルすると、その旨を返す', async () => {
    await text('キャンセル');
    expect(textOf(sent.at(-1)!)).toContain('ご予約はありません');
  });

  it('変更すると予約を取り消して時間帯から再開する', async () => {
    await bookThrough();
    await text('変更');
    expect(stores.snapshot().bookings).toHaveLength(0);
    expect(buttonData(sent.at(-1)!).length).toBeGreaterThan(0);
  });

  it('24時間放置した会話は IDLE に戻る', async () => {
    await text('予約');
    await postback('action=band&v=weekday_pm');

    now = new Date(NOW.getTime() + 25 * 3600_000);
    await text('こんにちは');

    // AWAIT_SLOT の再提示ではなく、最初からやり直しになる
    expect(buttonData(sent.at(-1)!)).toContain('action=band&v=weekday_pm');
  });

  it('友だち追加でも時間帯の選択肢を出す', async () => {
    await send({ type: 'follow', message: undefined });
    expect(buttonData(sent.at(-1)!).length).toBeGreaterThan(0);
  });

  it('userId が無いイベントは無視する', async () => {
    await flow.handleEvent({ type: 'message', replyToken: 'rt', message: { type: 'text', text: 'hi' } } as IncomingEvent);
    expect(sent).toHaveLength(0);
  });
});
