/**
 * 記憶域のメモリ実装。**プロセスが落ちると全部消える。**
 * Supabase を繋ぐまでの代用で、本番では DB 実装に差し替える。
 */

import { randomUUID } from 'node:crypto';
import { occurrenceKey, type AvailabilityRepo, type Slot, type SlotException, type Timeband } from '../slots/availability.js';
import { CONVERSATION_TTL_HOURS, DEMO_SETTINGS, DEMO_VENUE, demoSlots } from './demo-data.js';
import type { Booking, BookingStore, ConvState, ConvStateStore, FlowEventLog, State } from './types.js';

export type MemoryStores = {
  states: ConvStateStore;
  bookings: BookingStore;
  events: FlowEventLog;
  availability: AvailabilityRepo;
  settings: () => Promise<{ timezone: string; venue: typeof DEMO_VENUE; conversationTtlHours: number }>;
  /** 管理操作の代用：HUMAN を IDLE に戻す（spec §10）。 */
  releaseHuman(lineUserId: string): Promise<void>;
  snapshot(): { bookings: Booking[]; events: number };
};

export function createMemoryStores(options: { slots?: Slot[]; exceptions?: SlotException[] } = {}): MemoryStores {
  const slots = options.slots ?? demoSlots();
  const exceptions = options.exceptions ?? [];
  const byId = new Map(slots.map((s) => [s.id, s]));

  const states = new Map<string, ConvState>();
  const confirmed = new Map<string, Booking>();
  const log: { lineUserId: string; fromState: State | null; toState: State; trigger: string }[] = [];

  /** 件数ではなく人数を数える。 */
  function countFor(slotId: string, date: string): number {
    let n = 0;
    for (const b of confirmed.values()) {
      if (b.slotId === slotId && b.date === date) n += b.partySize;
    }
    return n;
  }

  return {
    states: {
      async get(id) {
        return states.get(id) ?? null;
      },
      async set(id, state) {
        states.set(id, state);
      },
      async clear(id) {
        states.delete(id);
      },
      async listByState(state) {
        const out: { lineUserId: string; since: Date }[] = [];
        for (const [lineUserId, conv] of states) {
          if (conv.state !== state) continue;
          // 期限から逆算して、その状態になった時刻の目安を出す
          const since = new Date(conv.expiresAt.getTime() - CONVERSATION_TTL_HOURS * 3600_000);
          out.push({ lineUserId, since });
        }
        return out;
      },
    },

    bookings: {
      async findConfirmed(lineUserId) {
        for (const b of confirmed.values()) if (b.lineUserId === lineUserId) return b;
        return null;
      },
      async listConfirmed() {
        return [...confirmed.values()];
      },
      async createIfRoom(input) {
        const slot = byId.get(input.slotId);
        if (!slot) return null;
        // 単一プロセス・単一スレッドなので、この確認と作成の間に割り込みは入らない。
        // DB 実装ではトランザクションで同じことをする（spec §6「同時予約」）。
        if (countFor(input.slotId, input.date) + input.partySize > slot.capacity) return null;
        const booking: Booking = { id: randomUUID(), ...input };
        confirmed.set(booking.id, booking);
        return booking;
      },
      async cancel(bookingId) {
        confirmed.delete(bookingId);
      },
    },

    events: {
      async append(entry) {
        log.push(entry);
      },
    },

    availability: {
      async getSettings() {
        return DEMO_SETTINGS;
      },
      async listActiveSlots(timeband: Timeband) {
        return slots.filter((s) => s.timeband === timeband);
      },
      async listExceptions() {
        return exceptions;
      },
      async countConfirmed() {
        const counts = new Map<string, number>();
        for (const b of confirmed.values()) {
          const key = occurrenceKey(b.slotId, b.date);
          counts.set(key, (counts.get(key) ?? 0) + b.partySize);
        }
        return counts;
      },
    },

    async settings() {
      return {
        timezone: DEMO_SETTINGS.timezone,
        venue: DEMO_VENUE,
        conversationTtlHours: CONVERSATION_TTL_HOURS,
      };
    },

    async releaseHuman(lineUserId) {
      states.delete(lineUserId);
    },

    snapshot() {
      return { bookings: [...confirmed.values()], events: log.length };
    },
  };
}
