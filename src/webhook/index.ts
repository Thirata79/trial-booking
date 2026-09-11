import { serve } from '@hono/node-server';
import { loadConfig } from '../config.js';
import { createDbClient, makeMarkEventSeen } from '../db.js';
import { createWebhookApp, type LineEvent } from './app.js';

const config = loadConfig();
const db = createDbClient(config);

const app = createWebhookApp({
  channelSecret: config.lineChannelSecret,
  markEventSeen: makeMarkEventSeen(db),
  // T5 で状態機械に繋ぐ。それまでは受信を確認できるだけにしておく。
  handleEvent: async (event: LineEvent) => {
    console.log('[event]', event.type, event.webhookEventId ?? '(id なし)');
  },
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`listening on :${port}`);
});
