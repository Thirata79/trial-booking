/**
 * 会話の状態機械（spec §6）。
 *
 * 選択は postback で受け、テキスト一致に依存しない。
 * AWAIT_* で想定外のテキストが来たら選択肢を1回だけ再提示し、
 * 2回連続で外したら HUMAN に落とす。
 */

import { createLineClient } from '../line/client.js';
import * as M from '../line/messages.js';
import { availableOccurrences, type Occurrence, type Timeband } from '../slots/availability.js';
import type { ConvState, FlowDeps, IncomingEvent, State } from './types.js';

const TIMEBANDS: Timeband[] = ['weekday_pm', 'weekend_pm'];

function isTimeband(value: string): value is Timeband {
  return (TIMEBANDS as string[]).includes(value);
}

/**
 * IDLE でテキストを受けたときの扱い。
 *
 * spec §6 の表では IDLE の入口は postback `action=start` だけだが、
 * それを押させる導線（リッチメニュー）がまだ無い。導線ができるまでは
 * 任意のテキストを開始の合図として扱う。
 */
const TEXT_STARTS_FLOW = true;

export function createFlow(deps: FlowDeps) {
  const logError =
    deps.onError ?? ((error: unknown, context: string) => console.error(`[${context}]`, error));

  async function moveTo(
    lineUserId: string,
    from: State | null,
    to: State,
    trigger: string,
    payload: Record<string, string> = {},
    misses = 0,
  ): Promise<void> {
    const { conversationTtlHours } = await deps.settings();
    if (to === 'IDLE') {
      await deps.states.clear(lineUserId);
    } else {
      const expiresAt = new Date(deps.now().getTime() + conversationTtlHours * 3600_000);
      await deps.states.set(lineUserId, { state: to, payload, expiresAt, misses });
    }
    await deps.events.append({ lineUserId, fromState: from, toState: to, trigger });
  }

  /** 期限切れの状態は捨てて IDLE として扱う（spec §6）。 */
  async function currentState(lineUserId: string): Promise<ConvState> {
    const found = await deps.states.get(lineUserId);
    if (!found) return { state: 'IDLE', payload: {}, expiresAt: new Date(0), misses: 0 };
    if (found.expiresAt.getTime() <= deps.now().getTime()) {
      await deps.states.clear(lineUserId);
      await deps.events.append({
        lineUserId,
        fromState: found.state,
        toState: 'IDLE',
        trigger: 'timeout',
      });
      return { state: 'IDLE', payload: {}, expiresAt: new Date(0), misses: 0 };
    }
    return found;
  }

  async function showTimebands(replyToken: string, lineUserId: string, from: State | null, trigger: string) {
    await deps.line.reply(replyToken, [M.askTimeband()]);
    await moveTo(lineUserId, from, 'AWAIT_TIMEBAND', trigger);
  }

  async function showSlots(
    replyToken: string,
    lineUserId: string,
    from: State,
    band: Timeband,
  ): Promise<void> {
    const { timezone } = await deps.settings();
    const occurrences = await availableOccurrences(deps.availability, band, deps.now());

    if (occurrences.length === 0) {
      await deps.line.reply(replyToken, [M.noSlots(), M.toHuman()]);
      await moveTo(lineUserId, from, 'HUMAN', 'no_slots');
      return;
    }

    await deps.line.reply(replyToken, [M.askSlot(occurrences, timezone)]);
    await moveTo(lineUserId, from, 'AWAIT_SLOT', `band:${band}`, { band });
  }

  /** 選択肢を外したとき。1回目は再提示、2回目で HUMAN（spec §6）。 */
  async function handleMiss(
    replyToken: string,
    lineUserId: string,
    current: ConvState,
  ): Promise<void> {
    if (current.misses >= 1) {
      await deps.line.reply(replyToken, [M.toHuman()]);
      await moveTo(lineUserId, current.state, 'HUMAN', 'missed_twice');
      return;
    }

    const { timezone } = await deps.settings();
    if (current.state === 'AWAIT_SLOT' && isTimeband(current.payload.band ?? '')) {
      const band = current.payload.band as Timeband;
      const occurrences = await availableOccurrences(deps.availability, band, deps.now());
      await deps.line.reply(replyToken, [M.askSlot(occurrences, timezone)]);
    } else {
      await deps.line.reply(replyToken, [M.askTimeband()]);
    }
    await deps.states.set(lineUserId, { ...current, misses: current.misses + 1 });
  }

  async function cancelBooking(
    replyToken: string,
    lineUserId: string,
    from: State,
  ): Promise<void> {
    const booking = await deps.bookings.findConfirmed(lineUserId);
    if (!booking) {
      await deps.line.reply(replyToken, [M.noBooking()]);
      await moveTo(lineUserId, from, 'IDLE', 'cancel_nothing');
      return;
    }
    await deps.bookings.cancel(booking.id);
    await deps.line.reply(replyToken, [M.cancelled()]);
    await moveTo(lineUserId, from, 'IDLE', 'cancelled');
  }

  async function handle(event: IncomingEvent): Promise<void> {
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;
    if (!lineUserId || !replyToken) return;

    const current = await currentState(lineUserId);

    // HUMAN の間は応答しない（spec §6）。解除は管理画面から。
    if (current.state === 'HUMAN') return;

    const postback = event.type === 'postback' ? new URLSearchParams(event.postback?.data ?? '') : null;
    const action = postback?.get('action') ?? null;
    const text = event.type === 'message' && event.message?.type === 'text'
      ? (event.message.text ?? '').trim()
      : null;

    // どの状態からでも受ける操作（spec §6）
    if (action === 'consult') {
      await deps.line.reply(replyToken, [M.toHuman()]);
      await moveTo(lineUserId, current.state, 'HUMAN', 'consult');
      return;
    }
    if (action === 'cancel' || text === 'キャンセル') {
      await cancelBooking(replyToken, lineUserId, current.state);
      return;
    }
    if (action === 'change' || text === '変更') {
      const booking = await deps.bookings.findConfirmed(lineUserId);
      if (booking) await deps.bookings.cancel(booking.id);
      await showTimebands(replyToken, lineUserId, current.state, 'change');
      return;
    }

    switch (current.state) {
      case 'IDLE': {
        if (action === 'start' || event.type === 'follow' || (TEXT_STARTS_FLOW && text)) {
          // 確定予約は1人1件（spec §5 の一意制約）。先に知らせて二重予約を防ぐ。
          const existing = await deps.bookings.findConfirmed(lineUserId);
          if (existing) {
            const { timezone } = await deps.settings();
            await deps.line.reply(replyToken, [
              M.alreadyBooked(M.formatSlotLabel(existing.startAt, timezone)),
            ]);
            return;
          }
          await showTimebands(replyToken, lineUserId, 'IDLE', action === 'start' ? 'start' : 'text_start');
        }
        return;
      }

      case 'AWAIT_TIMEBAND': {
        const band = postback?.get('v') ?? '';
        if (action === 'band' && isTimeband(band)) {
          await showSlots(replyToken, lineUserId, 'AWAIT_TIMEBAND', band);
          return;
        }
        await handleMiss(replyToken, lineUserId, current);
        return;
      }

      case 'AWAIT_SLOT': {
        const slotId = postback?.get('id') ?? '';
        const date = postback?.get('d') ?? '';
        if (action === 'slot' && slotId && date) {
          const band = current.payload.band ?? '';
          const occurrence = isTimeband(band)
            ? (await availableOccurrences(deps.availability, band, deps.now())).find(
                (o) => o.slotId === slotId && o.date === date,
              )
            : undefined;

          if (!occurrence) {
            // 選んでいる間に埋まった、あるいは締切を過ぎた
            await deps.line.reply(replyToken, [M.slotTaken()]);
            if (isTimeband(band)) await showSlots(replyToken, lineUserId, 'AWAIT_SLOT', band);
            return;
          }

          const { timezone } = await deps.settings();
          await deps.line.reply(replyToken, [
            M.askName(M.formatSlotLabel(occurrence.startAt, timezone)),
          ]);
          await moveTo(lineUserId, 'AWAIT_SLOT', 'AWAIT_NAME', 'slot_picked', {
            band,
            slotId,
            date,
            startAt: occurrence.startAt.toISOString(),
          });
          return;
        }
        await handleMiss(replyToken, lineUserId, current);
        return;
      }

      case 'AWAIT_NAME': {
        if (!text) {
          await handleMiss(replyToken, lineUserId, current);
          return;
        }
        await createBooking(replyToken, lineUserId, current, text);
        return;
      }

      default:
        return;
    }
  }

  async function createBooking(
    replyToken: string,
    lineUserId: string,
    current: import('./types.js').ConvState,
    name: string,
  ): Promise<void> {
    const { timezone, venue } = await deps.settings();
    const { slotId, date, startAt, band } = current.payload;
    if (!slotId || !date || !startAt) {
      await handleMiss(replyToken, lineUserId, current);
      return;
    }

    const booking = await deps.bookings.createIfRoom({
      lineUserId,
      slotId,
      date,
      startAt: new Date(startAt),
      name,
    });

    if (!booking) {
      // 定員に達していた（spec §6「同時予約」）。AWAIT_SLOT から再提示する。
      await deps.line.reply(replyToken, [M.slotTaken()]);
      if (isTimeband(band ?? '')) {
        await showSlots(replyToken, lineUserId, 'AWAIT_NAME', band as Timeband);
      } else {
        await showTimebands(replyToken, lineUserId, 'AWAIT_NAME', 'slot_taken');
      }
      return;
    }

    const label = M.formatSlotLabel(booking.startAt, timezone);
    await deps.line.reply(replyToken, [M.confirmed(name, label, venue)]);
    await moveTo(lineUserId, 'AWAIT_NAME', 'IDLE', 'booked');
  }

  return {
    /** 1イベントを処理する。例外は握ってログに任せる（webhook を落とさない）。 */
    async handleEvent(event: IncomingEvent): Promise<void> {
      try {
        await handle(event);
      } catch (error) {
        logError(error, 'flow');
        const replyToken = event.replyToken;
        const lineUserId = event.source?.userId;
        if (replyToken && lineUserId) {
          // spec §12：DBエラー → 文面を返して HUMAN へ
          try {
            await deps.line.reply(replyToken, [M.dbError()]);
            await moveTo(lineUserId, null, 'HUMAN', 'error');
          } catch (nested) {
            logError(nested, 'flow.recover');
          }
        }
      }
    },
  };
}

export type Flow = ReturnType<typeof createFlow>;
export type { Occurrence };
export { createLineClient };
