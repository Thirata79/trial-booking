import { serve } from '@hono/node-server';
import { loadConfig } from '../config.js';
import { createDbClient, makeMarkEventSeen } from '../db.js';
import { createWebhookApp, type LineEvent } from './app.js';
import { createMemoryEventStore, type MarkEventSeen } from './event-store.js';

const config = loadConfig();

let markEventSeen: MarkEventSeen;
if (config.supabase) {
  markEventSeen = makeMarkEventSeen(createDbClient(config.supabase));
} else {
  markEventSeen = createMemoryEventStore();
  console.warn(
    '[warn] STORAGE=memory で起動しています。再起動すると重複判定が消えます。デモ用です。',
  );
}

const app = createWebhookApp({
  channelSecret: config.lineChannelSecret,
  markEventSeen,
  // T5 で状態機械に繋ぐ。それまでは受信を確認できるだけにしておく。
  handleEvent: async (event: LineEvent) => {
    console.log('[event]', event.type, event.webhookEventId ?? '(id なし)');
  },
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`listening on :${port} (storage=${config.storage})`);
});
