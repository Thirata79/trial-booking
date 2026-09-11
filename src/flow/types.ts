/** 状態機械が触る記憶域の定義（spec §6）。DB とメモリで同じ形を使う。 */

import type { LineClient } from '../line/client.js';
import type { Venue } from '../line/messages.js';
import type { AvailabilityRepo } from '../slots/availability.js';

export type State =
  | 'IDLE'
  | 'AWAIT_TIMEBAND'
  | 'AWAIT_SLOT'
  | 'AWAIT_NAME'
  | 'AWAIT_CANCEL_CONFIRM'
  | 'HUMAN';

export type ConvState = {
  state: State;
  payload: Record<string, string>;
  expiresAt: Date;
  /** AWAIT_* で選択肢を外した回数。2回連続で HUMAN（spec §6）。 */
  misses: number;
};

export type ConvStateStore = {
  get(lineUserId: string): Promise<ConvState | null>;
  set(lineUserId: string, state: ConvState): Promise<void>;
  clear(lineUserId: string): Promise<void>;
  /** 指定した状態のユーザーを挙げる。管理画面の有人解除に使う（spec §10）。 */
  listByState(state: State): Promise<{ lineUserId: string; since: Date }[]>;
};

export type Booking = {
  id: string;
  lineUserId: string;
  slotId: string;
  date: string;
  startAt: Date;
  name: string;
};

export type BookingStore = {
  findConfirmed(lineUserId: string): Promise<Booking | null>;
  /** 確定している予約を全部返す。管理画面の予約一覧に使う（spec §10）。 */
  listConfirmed(): Promise<Booking[]>;
  /**
   * 定員を確認してから作る。埋まっていれば null（spec §6「同時予約」）。
   * 確認と作成は不可分でなければならない。
   */
  createIfRoom(input: Omit<Booking, 'id'>): Promise<Booking | null>;
  cancel(bookingId: string): Promise<void>;
};

/** ファネル計測用の追記ログ（spec §5 flow_events, §10「計測」）。 */
export type FlowEventLog = {
  append(entry: {
    lineUserId: string;
    fromState: State | null;
    toState: State;
    trigger: string;
  }): Promise<void>;
};

export type FlowDeps = {
  now: () => Date;
  settings: () => Promise<{ timezone: string; venue: Venue; conversationTtlHours: number }>;
  availability: AvailabilityRepo;
  bookings: BookingStore;
  states: ConvStateStore;
  events: FlowEventLog;
  line: LineClient;
  onError?: (error: unknown, context: string) => void;
};

/** LINE から届くイベントのうち、このフローが解釈する形だけを取り出したもの。 */
export type IncomingEvent = {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
  postback?: { data: string };
};
