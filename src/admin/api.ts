/**
 * 管理機能の最小実装（spec §10）。デザインは問わない。
 *
 * 公開URLに生えるので、**トークンが無ければルート自体を作らない**。
 * 認証なしで予約者の氏名を晒さないため。
 */

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { BookingStore, ConvStateStore, FlowEventLog } from '../flow/types.js';
import { formatSlotLabel } from '../line/messages.js';

export type AdminDeps = {
  token: string;
  states: ConvStateStore;
  bookings: BookingStore;
  events: FlowEventLog;
  timezone: string;
};

function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createAdminApp(deps: AdminDeps) {
  const app = new Hono();

  // 画面そのものはトークンを持たない。読み書きは fetch で行い、
  // トークンはヘッダに載せる（URL に載せるとログに残るため）。
  app.get('/', (c) => c.html(PAGE));

  app.use('/api/*', async (c, next) => {
    const given = c.req.header('x-admin-token') ?? '';
    if (!tokenMatches(given, deps.token)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/api/human', async (c) => {
    const users = await deps.states.listByState('HUMAN');
    const withBooking = await Promise.all(
      users.map(async (u) => {
        const booking = await deps.bookings.findConfirmed(u.lineUserId);
        return {
          lineUserId: u.lineUserId,
          since: u.since.toISOString(),
          booking: booking
            ? { name: booking.name, slot: formatSlotLabel(booking.startAt, deps.timezone) }
            : null,
        };
      }),
    );
    return c.json({ users: withBooking });
  });

  /** HUMAN のユーザーを IDLE に戻す（spec §6「管理画面の操作で IDLE」）。 */
  app.post('/api/human/release', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { lineUserId?: string };
    const lineUserId = body.lineUserId?.trim();
    if (!lineUserId) return c.json({ error: 'lineUserId が要ります' }, 400);

    const current = await deps.states.get(lineUserId);
    if (current?.state !== 'HUMAN') return c.json({ error: 'HUMAN ではありません' }, 409);

    await deps.states.clear(lineUserId);
    await deps.events.append({
      lineUserId,
      fromState: 'HUMAN',
      toState: 'IDLE',
      trigger: 'admin_release',
    });
    return c.json({ ok: true });
  });

  app.get('/api/bookings', async (c) => {
    const all = await deps.bookings.listConfirmed();
    return c.json({
      bookings: all
        .slice()
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
        .map((b) => ({
          id: b.id,
          name: b.name,
          slot: formatSlotLabel(b.startAt, deps.timezone),
          date: b.date,
          lineUserId: b.lineUserId,
        })),
    });
  });

  return app;
}

const PAGE = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>trial-booking 管理</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:1rem;line-height:1.6;max-width:52rem}
 h2{font-size:1.05rem;margin:1.5rem 0 .5rem}
 table{border-collapse:collapse;width:100%;font-size:.9rem}
 th,td{border:1px solid #ddd;padding:.4rem .5rem;text-align:left}
 th{background:#f5f5f5;font-weight:600}
 button{padding:.3rem .7rem;cursor:pointer}
 input{padding:.4rem;width:min(100%,22rem)}
 .muted{color:#666;font-size:.85rem}
 .empty{color:#666;padding:.5rem 0}
</style></head><body>
<h1 style="font-size:1.2rem">trial-booking 管理</h1>
<p class="muted">最小実装です。枠設定・来場記録・CSV出力はまだありません。</p>

<div id="login">
  <p>管理トークンを入力してください。</p>
  <input id="token" type="password" placeholder="ADMIN_TOKEN" autocomplete="off">
  <button onclick="saveToken()">開く</button>
  <p id="err" style="color:#c00"></p>
</div>

<div id="main" hidden>
  <h2>有人対応中（HUMAN）</h2>
  <div id="human"></div>
  <h2>確定している予約</h2>
  <div id="bookings"></div>
  <p><button onclick="load()">再読み込み</button>
     <button onclick="logout()">トークンを消す</button></p>
</div>

<script>
const tokenKey = 'trial-booking-admin-token';
function token(){ try { return sessionStorage.getItem(tokenKey) || ''; } catch { return ''; } }
function saveToken(){
  try { sessionStorage.setItem(tokenKey, document.getElementById('token').value); } catch {}
  load();
}
function logout(){
  try { sessionStorage.removeItem(tokenKey); } catch {}
  document.getElementById('main').hidden = true;
  document.getElementById('login').hidden = false;
}
async function api(path, options){
  return fetch('api/' + path, {
    ...options,
    headers: { 'x-admin-token': token(), 'content-type':'application/json', ...(options||{}).headers },
  });
}
async function release(id){
  const res = await api('human/release', { method:'POST', body: JSON.stringify({ lineUserId: id }) });
  if(!res.ok){ alert('解除できませんでした: ' + res.status); return; }
  load();
}
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
async function load(){
  const res = await api('human');
  if(res.status === 401){ document.getElementById('err').textContent = 'トークンが違います'; return; }
  document.getElementById('err').textContent = '';
  document.getElementById('login').hidden = true;
  document.getElementById('main').hidden = false;

  const { users } = await res.json();
  document.getElementById('human').innerHTML = users.length === 0
    ? '<p class="empty">なし</p>'
    : '<table><tr><th>LINEユーザー</th><th>予約</th><th>開始</th><th></th></tr>' +
      users.map(u => '<tr><td><code>' + esc(u.lineUserId.slice(0,12)) + '…</code></td><td>' +
        (u.booking ? esc(u.booking.name) + ' / ' + esc(u.booking.slot) : '—') + '</td><td class="muted">' +
        new Date(u.since).toLocaleString('ja-JP') + '</td><td><button onclick="release(\\'' +
        esc(u.lineUserId) + '\\')">解除</button></td></tr>').join('') + '</table>';

  const { bookings } = await (await api('bookings')).json();
  document.getElementById('bookings').innerHTML = bookings.length === 0
    ? '<p class="empty">なし</p>'
    : '<table><tr><th>日時</th><th>氏名</th></tr>' +
      bookings.map(b => '<tr><td>' + esc(b.slot) + '</td><td>' + esc(b.name) + '</td></tr>').join('') + '</table>';
}
if(token()) load();
</script>
</body></html>`;
