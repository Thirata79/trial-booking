import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebhookApp, type LineEvent } from '../src/webhook/app.js';
import { verifySignature } from '../src/webhook/verify.js';

const SECRET = 'test-channel-secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function body(...events: Partial<LineEvent>[]): string {
  return JSON.stringify({
    destination: 'U0000000000000000000000000000000',
    events: events.map((e) => ({ type: 'message', ...e })),
  });
}

function post(app: ReturnType<typeof createWebhookApp>, raw: string, signature?: string) {
  return app.request('/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'x-line-signature': signature }),
    },
    body: raw,
  });
}

describe('verifySignature', () => {
  it('正しい署名を受け入れる', () => {
    const raw = body({ webhookEventId: 'e1' });
    expect(verifySignature(raw, sign(raw), SECRET)).toBe(true);
  });

  it('別のシークレットで作られた署名を拒否する', () => {
    const raw = body({ webhookEventId: 'e1' });
    expect(verifySignature(raw, sign(raw, 'other-secret'), SECRET)).toBe(false);
  });

  it('ボディが1文字でも変われば拒否する', () => {
    const raw = body({ webhookEventId: 'e1' });
    expect(verifySignature(raw + ' ', sign(raw), SECRET)).toBe(false);
  });

  it('署名が無ければ拒否する', () => {
    expect(verifySignature(body(), undefined, SECRET)).toBe(false);
  });

  it('長さの違う値でも例外を投げずに拒否する', () => {
    expect(verifySignature(body(), 'c2hvcnQ=', SECRET)).toBe(false);
    expect(verifySignature(body(), 'not base64 at all!!', SECRET)).toBe(false);
  });
});

describe('POST /webhook', () => {
  let seen: Set<string>;
  let handleEvent: ReturnType<typeof vi.fn>;
  let markEventSeen: ReturnType<typeof vi.fn>;
  let app: ReturnType<typeof createWebhookApp>;

  beforeEach(() => {
    seen = new Set();
    handleEvent = vi.fn(async () => {});
    markEventSeen = vi.fn(async (eventId: string) => {
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      return true;
    });
    app = createWebhookApp({
      channelSecret: SECRET,
      markEventSeen: markEventSeen as never,
      handleEvent: handleEvent as never,
      onError: () => {},
    });
  });

  it('署名が不正なリクエストを401で拒否し、処理もしない', async () => {
    const raw = body({ webhookEventId: 'e1' });
    const res = await post(app, raw, sign(raw, 'wrong-secret'));

    expect(res.status).toBe(401);
    expect(markEventSeen).not.toHaveBeenCalled();
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('署名ヘッダが無ければ401', async () => {
    const raw = body({ webhookEventId: 'e1' });
    expect((await post(app, raw)).status).toBe(401);
  });

  it('正しい署名なら200を返し、イベントを処理する', async () => {
    const raw = body({ webhookEventId: 'e1' });
    const res = await post(app, raw, sign(raw));

    expect(res.status).toBe(200);
    expect(handleEvent).toHaveBeenCalledTimes(1);
  });

  it('同一 event_id を2回受けても処理は1回だけ', async () => {
    const raw = body({ webhookEventId: 'e1' });

    const first = await post(app, raw, sign(raw));
    const second = await post(app, raw, sign(raw));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(handleEvent).toHaveBeenCalledTimes(1);
  });

  it('1リクエストに複数イベントが入っていても、既出のものだけを落とす', async () => {
    const firstRaw = body({ webhookEventId: 'e1' });
    await post(app, firstRaw, sign(firstRaw));
    handleEvent.mockClear();

    const raw = body({ webhookEventId: 'e1' }, { webhookEventId: 'e2' });
    await post(app, raw, sign(raw));

    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent.mock.calls[0]?.[0]).toMatchObject({ webhookEventId: 'e2' });
  });

  it('DBが落ちていれば500を返す（LINEにリトライさせる）', async () => {
    markEventSeen.mockRejectedValueOnce(new Error('db down'));
    const raw = body({ webhookEventId: 'e1' });

    const res = await post(app, raw, sign(raw));

    expect(res.status).toBe(500);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('handleEvent が投げても200のまま（LINEに多重送信させない）', async () => {
    handleEvent.mockRejectedValueOnce(new Error('boom'));
    const raw = body({ webhookEventId: 'e1' });

    expect((await post(app, raw, sign(raw))).status).toBe(200);
  });

  it('署名は通るが壊れたJSONなら200で握る', async () => {
    const raw = '{ broken';
    const res = await post(app, raw, sign(raw));

    expect(res.status).toBe(200);
    expect(handleEvent).not.toHaveBeenCalled();
  });
});
