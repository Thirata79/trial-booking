import { describe, expect, it, vi } from 'vitest';
import { createLineClient, type LineMessage } from '../src/line/client.js';
import {
  askSlot,
  askTimeband,
  confirmed,
  formatSlotLabel,
  postbackData,
  type Venue,
} from '../src/line/messages.js';
import type { Occurrence } from '../src/slots/availability.js';

const TZ = 'Asia/Tokyo';

const venue: Venue = {
  name: 'SUPREME LAB',
  address: '〒106-0041 東京都港区麻布台1-11-5',
  access: '日比谷線 神谷町駅から徒歩5分',
  bring: '着替え',
};

function occurrence(date: string, hour: number, slotId = 's1'): Occurrence {
  return {
    slotId,
    date,
    startAt: new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`),
    durationMin: 60,
    capacity: 2,
    booked: 0,
    remaining: 2,
  };
}

function okResponse() {
  return new Response('{}', { status: 200 });
}

describe('createLineClient', () => {
  it('reply は replyToken と messages を送る', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const client = createLineClient({ accessToken: 'token', fetchImpl: fetchImpl as never });

    await client.reply('rt', [{ type: 'text', text: 'hello' }]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(JSON.parse(String(init.body))).toEqual({
      replyToken: 'rt',
      messages: [{ type: 'text', text: 'hello' }],
    });
  });

  it('通信エラーなら1回だけ再送する', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(okResponse());
    const client = createLineClient({
      accessToken: 'token',
      fetchImpl: fetchImpl as never,
      onError: () => {},
    });

    await client.reply('rt', [{ type: 'text', text: 'hi' }]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('5xx なら1回だけ再送する', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(okResponse());
    const client = createLineClient({
      accessToken: 'token',
      fetchImpl: fetchImpl as never,
      onError: () => {},
    });

    await client.reply('rt', [{ type: 'text', text: 'hi' }]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('4xx では再送しない（成功していた場合の二重送信を避ける）', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad token', { status: 400 }));
    const client = createLineClient({
      accessToken: 'token',
      fetchImpl: fetchImpl as never,
      onError: () => {},
    });

    await client.reply('rt', [{ type: 'text', text: 'hi' }]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('2回失敗しても例外を投げず、ログに任せる', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const client = createLineClient({
      accessToken: 'token',
      fetchImpl: fetchImpl as never,
      onError,
    });

    await expect(client.reply('rt', [{ type: 'text', text: 'hi' }])).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('文面', () => {
  it('postback の data は action=... のクエリ形式', () => {
    expect(postbackData('slot', { id: 'abc', d: '2026-09-14' })).toBe(
      'action=slot&id=abc&d=2026-09-14',
    );
  });

  it('枠のラベルは施設のタイムゾーンで出る', () => {
    // 2026-09-14 は月曜
    expect(formatSlotLabel(new Date('2026-09-14T03:00:00Z'), TZ)).toBe('9月14日(月) 12:00');
  });

  it('時間帯の選択はボタン4つ以内（LINE の上限）', () => {
    const message = askTimeband();
    expect(message.type).toBe('template');
    if (message.type !== 'template') return;
    expect(message.template.actions.length).toBeLessThanOrEqual(4);
    for (const action of message.template.actions) {
      expect(action.label.length).toBeLessThanOrEqual(12);
    }
  });

  it('枠の選択はクイックリプライ13個以内で、末尾は相談', () => {
    const occurrences = Array.from({ length: 12 }, (_, i) => occurrence('2026-09-14', 12, `s${i}`));
    const message = askSlot(occurrences, TZ);

    expect(message.type).toBe('text');
    if (message.type !== 'text') return;
    const items = message.quickReply?.items ?? [];
    expect(items.length).toBe(13);
    expect(items.at(-1)?.action.data).toBe('action=consult');
  });

  it('2名のときは確定文面に人数が出る', () => {
    const message = confirmed('平田', '9月14日(月) 12:00', 2, venue) as Extract<
      LineMessage,
      { type: 'text' }
    >;
    expect(message.text).toContain('平田さま（2名）');
  });

  it('確定文面に施設情報が差し込まれる', () => {
    const message = confirmed('平田', '9月14日(月) 12:00', 1, venue) as Extract<
      LineMessage,
      { type: 'text' }
    >;
    expect(message.text).toContain('平田さま');
    expect(message.text).toContain('9月14日(月) 12:00');
    expect(message.text).toContain(venue.address);
    expect(message.text).toContain(venue.bring);
  });

  it('文面に施設名を直書きしていない（settings 由来のみ）', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/line/messages.ts', 'utf8'),
    );
    expect(source).not.toContain('SUPREME');
    expect(source).not.toContain('麻布台');
    expect(source).not.toContain('神谷町');
  });
});
