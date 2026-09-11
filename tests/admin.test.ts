import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminApp } from '../src/admin/api.js';
import { createMemoryStores, type MemoryStores } from '../src/flow/memory-store.js';

const TOKEN = 'test-admin-token';
const USER = 'U-human-user';

describe('管理画面', () => {
  let stores: MemoryStores;
  let app: ReturnType<typeof createAdminApp>;

  beforeEach(async () => {
    stores = createMemoryStores();
    app = createAdminApp({
      token: TOKEN,
      states: stores.states,
      bookings: stores.bookings,
      events: stores.events,
      timezone: 'Asia/Tokyo',
    });
    await stores.states.set(USER, {
      state: 'HUMAN',
      payload: {},
      expiresAt: new Date(Date.now() + 3600_000),
      misses: 0,
    });
  });

  const get = (path: string, token = TOKEN) =>
    app.request(path, { headers: { 'x-admin-token': token } });

  const post = (path: string, body: unknown, token = TOKEN) =>
    app.request(path, {
      method: 'POST',
      headers: { 'x-admin-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('トークンが無ければ 401', async () => {
    expect((await app.request('/api/human')).status).toBe(401);
  });

  it('トークンが違えば 401', async () => {
    expect((await get('/api/human', 'wrong')).status).toBe(401);
  });

  it('長さの違うトークンでも 401（例外を投げない）', async () => {
    expect((await get('/api/human', 'x')).status).toBe(401);
  });

  it('画面自体はトークン無しで開ける（中身は fetch で取る）', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('管理トークン');
  });

  it('HUMAN のユーザーを一覧できる', async () => {
    const res = await get('/api/human');
    const body = (await res.json()) as { users: { lineUserId: string }[] };
    expect(body.users.map((u) => u.lineUserId)).toEqual([USER]);
  });

  it('解除すると HUMAN から外れ、flow_events に残る', async () => {
    const before = stores.snapshot().events;

    const res = await post('/api/human/release', { lineUserId: USER });
    expect(res.status).toBe(200);

    expect(await stores.states.get(USER)).toBeNull();
    expect(stores.snapshot().events).toBe(before + 1);

    const list = (await (await get('/api/human')).json()) as { users: unknown[] };
    expect(list.users).toHaveLength(0);
  });

  it('HUMAN でないユーザーの解除は 409', async () => {
    expect((await post('/api/human/release', { lineUserId: 'U-other' })).status).toBe(409);
  });

  it('lineUserId が無ければ 400', async () => {
    expect((await post('/api/human/release', {})).status).toBe(400);
  });

  it('予約一覧は氏名と日時を返す', async () => {
    await stores.bookings.createIfRoom({
      lineUserId: USER,
      slotId: 'w1-12',
      date: '2026-09-14',
      startAt: new Date('2026-09-14T03:00:00Z'),
      name: '平田',
    });

    const body = (await (await get('/api/bookings')).json()) as {
      bookings: { name: string; slot: string }[];
    };
    expect(body.bookings).toEqual([{ ...body.bookings[0], name: '平田', slot: '9月14日(月) 12:00' }]);
  });
});
