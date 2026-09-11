import { serve } from '@hono/node-server';
import { loadConfig } from '../config.js';
import { createDbClient, makeMarkEventSeen } from '../db.js';
import { createFlow } from '../flow/machine.js';
import { createMemoryStores } from '../flow/memory-store.js';
import type { IncomingEvent } from '../flow/types.js';
import { createLineClient } from '../line/client.js';
import { createAdminApp } from '../admin/api.js';
import { createWebhookApp } from './app.js';
import { createMemoryEventStore, type MarkEventSeen } from './event-store.js';

const config = loadConfig();

let markEventSeen: MarkEventSeen;
if (config.supabase) {
  markEventSeen = makeMarkEventSeen(createDbClient(config.supabase));
} else {
  markEventSeen = createMemoryEventStore();
  console.warn(
    '[warn] STORAGE=memory で起動しています。予約も会話状態も再起動で消えます。デモ用です。',
  );
}

// Supabase 実装ができたら、このブロックを差し替えるだけでよい。
const stores = createMemoryStores();
const line = createLineClient({ accessToken: config.lineChannelAccessToken });

const flow = createFlow({
  now: () => new Date(),
  settings: stores.settings,
  availability: stores.availability,
  bookings: stores.bookings,
  states: stores.states,
  events: stores.events,
  line,
});

// トークンが無ければ管理画面は生やさない（公開URLに予約者の氏名を晒さない）。
const admin = config.adminToken
  ? createAdminApp({
      token: config.adminToken,
      states: stores.states,
      bookings: stores.bookings,
      events: stores.events,
      timezone: (await stores.settings()).timezone,
    })
  : undefined;
if (!admin) console.warn('[warn] ADMIN_TOKEN が未設定のため、管理画面は無効です。');

const app = createWebhookApp({
  channelSecret: config.lineChannelSecret,
  markEventSeen,
  admin,
  handleEvent: async (event) => {
    console.log('[event]', event.type, event.webhookEventId ?? '(id なし)');
    await flow.handleEvent(event as unknown as IncomingEvent);
  },
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`listening on :${port} (storage=${config.storage})`);
});
