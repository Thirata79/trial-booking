import { Hono } from 'hono';
import { verifySignature } from './verify.js';

/** LINE の Webhook イベント。T2 では中身を解釈せず、識別と受け渡しだけ行う。 */
export type LineEvent = {
  type: string;
  webhookEventId?: string;
  [key: string]: unknown;
};

export type WebhookDeps = {
  channelSecret: string;
  /**
   * event_id を記録し、「初めて見たか」を返す（spec §12「event_id 重複 → 200、処理しない」）。
   * 既出なら false。webhook_events の主キー制約で判定する。
   */
  markEventSeen: (eventId: string) => Promise<boolean>;
  /** 実処理。T5 で状態機械に繋ぐ。ここでは注入されたものを呼ぶだけ。 */
  handleEvent: (event: LineEvent) => Promise<void>;
  onError?: (error: unknown, context: string) => void;
};

export function createWebhookApp(deps: WebhookDeps) {
  const app = new Hono();
  const logError =
    deps.onError ??
    ((error: unknown, context: string) => console.error(`[${context}]`, error));

  // 届いたリクエストは全部記録する。設定ミスで別のパスに飛んでいる場合、
  // ログに何も出ないと「届いていない」のか「弾いている」のか切り分けられない。
  app.use('*', async (c, next) => {
    console.log(`[req] ${c.req.method} ${new URL(c.req.url).pathname}`);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.notFound((c) => {
    const path = new URL(c.req.url).pathname;
    console.warn(`[404] ${c.req.method} ${path} — Webhook URL は /webhook です`);
    return c.text('not found', 404);
  });

  app.post('/webhook', async (c) => {
    // 署名検証には生ボディが要る（verify.ts 参照）。
    const rawBody = await c.req.text();

    if (!verifySignature(rawBody, c.req.header('x-line-signature'), deps.channelSecret)) {
      // spec §12：401、ログのみ。本文は返さない。
      logError(new Error('signature mismatch'), 'verify');
      return c.text('unauthorized', 401);
    }

    let events: LineEvent[] = [];
    try {
      const parsed = JSON.parse(rawBody) as { events?: LineEvent[] };
      events = parsed.events ?? [];
    } catch (error) {
      // 署名は通っているのに壊れている＝こちらの想定漏れ。200 を返して握る
      // （LINE にリトライさせても直らないため）。
      logError(error, 'parse');
      return c.text('ok', 200);
    }

    // 1リクエストに複数イベントが入りうるので、冪等判定はイベント単位で行う。
    const fresh: LineEvent[] = [];
    for (const event of events) {
      const eventId = event.webhookEventId;
      if (!eventId) {
        // 識別子が無いものは重複判定できない。捨てずに通すが、記録は残す。
        logError(new Error(`webhookEventId なし: type=${event.type}`), 'dedupe');
        fresh.push(event);
        continue;
      }
      try {
        if (await deps.markEventSeen(eventId)) fresh.push(event);
      } catch (error) {
        // DB が落ちている場合。LINE にリトライさせたいので 500 を返す。
        logError(error, 'dedupe');
        return c.text('internal error', 500);
      }
    }

    // spec §4：200 を即返し、実処理は非同期。reply token の寿命が短いため、
    // LINE を待たせない。プロセスが落ちればこのイベントは失われる。
    for (const event of fresh) {
      void deps.handleEvent(event).catch((error) => logError(error, 'handle'));
    }

    return c.text('ok', 200);
  });

  return app;
}
