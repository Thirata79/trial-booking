/**
 * 文面テンプレート（spec §8）と、選択肢の組み立て（spec §7）。
 *
 * 施設情報は settings から渡す。**ジム名・住所をここに直書きしない。**
 */

import type { Occurrence, Timeband } from '../slots/availability.js';
import { partsInZone } from '../slots/time.js';
import type { LineMessage, QuickReplyItem } from './client.js';

/** settings.venue_name と settings.venue から組み立てる。 */
export type Venue = {
  name: string;
  address: string;
  access: string;
  bring: string;
};

/** ボタンのラベルは12文字以内（spec §7）。 */
export const TIMEBAND_LABELS: Record<Timeband, string> = {
  weekday_pm: '平日の午後',
  weekend_pm: '土日の午後',
};

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 「9月14日(月) 12:00」。施設のタイムゾーンで表示する（spec §6）。 */
export function formatSlotLabel(startAt: Date, timezone: string): string {
  const p = partsInZone(startAt, timezone);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${p.month}月${p.day}日(${WEEKDAY_JA[p.weekday]}) ${hh}:${mm}`;
}

/** クイックリプライ用の短い形。「9/14(月) 12:00」 */
function shortSlotLabel(startAt: Date, timezone: string): string {
  const p = partsInZone(startAt, timezone);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${p.month}/${p.day}(${WEEKDAY_JA[p.weekday]}) ${hh}:${mm}`;
}

/** postback の data は action=... のクエリ形式で統一する（spec §7）。 */
export function postbackData(action: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ action, ...params });
  return query.toString();
}

function venueFooter(venue: Venue): string {
  return [
    `場所：${venue.name}`,
    `　　　${venue.address}`,
    `　　　${venue.access}`,
    `持ち物：${venue.bring}`,
    '',
    '変更・キャンセルは「変更」「キャンセル」と送ってください。',
  ].join('\n');
}

/** 時間帯の選択。3〜4件の固定なのでボタンテンプレート（spec §7）。 */
export function askTimeband(): LineMessage {
  const text = '無料体験のご予約ですね。ご希望の時間帯を選んでください。';
  return {
    type: 'template',
    altText: text,
    template: {
      type: 'buttons',
      text,
      actions: [
        ...(Object.keys(TIMEBAND_LABELS) as Timeband[]).map((band) => ({
          type: 'postback' as const,
          label: TIMEBAND_LABELS[band],
          data: postbackData('band', { v: band }),
          displayText: TIMEBAND_LABELS[band],
        })),
        {
          type: 'postback' as const,
          label: '担当者に相談',
          data: postbackData('consult'),
          displayText: '担当者に相談したいです',
        },
      ],
    },
  };
}

/**
 * 最短の候補を直に見せる（CV優先の導線）。
 * 時間帯の選択を挟まず、ここが会話の入口になる。
 */
export function askSoonestSlots(occurrences: Occurrence[], timezone: string): LineMessage {
  const items: QuickReplyItem[] = occurrences.map((o) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: shortSlotLabel(o.startAt, timezone),
      data: postbackData('slot', { id: o.slotId, d: o.date }),
      displayText: formatSlotLabel(o.startAt, timezone),
    },
  }));

  items.push(
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '他の日時を見る',
        data: postbackData('more'),
        displayText: '他の日時を見たいです',
      },
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '担当者に相談',
        data: postbackData('consult'),
        displayText: '担当者に相談したいです',
      },
    },
  );

  return {
    type: 'text',
    text: '無料体験のご予約ですね。ご希望の日時を選んでください。',
    quickReply: { items },
  };
}

/** 人数。枠に2名分の空きがあるときだけ聞く（1名分しか無ければ聞く意味がない）。 */
export function askPartySize(slotLabel: string): LineMessage {
  const text = `${slotLabel} ですね。何名でお越しになりますか。`;
  return {
    type: 'template',
    altText: text,
    template: {
      type: 'buttons',
      text,
      actions: [
        { type: 'postback', label: '1名', data: postbackData('party', { n: '1' }), displayText: '1名' },
        { type: 'postback', label: '2名', data: postbackData('party', { n: '2' }), displayText: '2名' },
      ],
    },
  };
}

/** 枠の選択。件数が動くのでクイックリプライ（最大13個、spec §7）。 */
export function askSlot(occurrences: Occurrence[], timezone: string): LineMessage {
  const items: QuickReplyItem[] = occurrences.map((o) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: shortSlotLabel(o.startAt, timezone),
      data: postbackData('slot', { id: o.slotId, d: o.date }),
      displayText: formatSlotLabel(o.startAt, timezone),
    },
  }));

  // 13個目は「別の日を相談」に充てる（spec §6 step 6）。
  items.push({
    type: 'action',
    action: {
      type: 'postback',
      label: '別の日を相談',
      data: postbackData('consult'),
      displayText: '別の日を相談したいです',
    },
  });

  return {
    type: 'text',
    text: 'ありがとうございます。体験枠から選んでください。',
    quickReply: { items },
  };
}

export function noSlots(): LineMessage {
  return {
    type: 'text',
    text: '申し訳ありません、その時間帯に空きがありませんでした。担当者よりご連絡します。',
  };
}

export function askName(slotLabel: string, partySize: number): LineMessage {
  const who = partySize > 1 ? `${slotLabel} に${partySize}名` : slotLabel;
  return {
    type: 'text',
    text: `${who} でお取りします。最後に、お名前だけ教えてください。`,
  };
}

export function confirmed(
  name: string,
  slotLabel: string,
  partySize: number,
  venue: Venue,
): LineMessage {
  const who = partySize > 1 ? `${name}さま（${partySize}名）` : `${name}さま`;
  return {
    type: 'text',
    text: [`${who}、${slotLabel} にお待ちしています。`, '', venueFooter(venue)].join('\n'),
  };
}

export function reminder(slotLabel: string, venue: Venue): LineMessage {
  return {
    type: 'text',
    text: [`明日 ${slotLabel} の体験です。`, '', venueFooter(venue)].join('\n'),
  };
}

/**
 * spec §8 に無い追加。bookings の一意制約（確定予約はユーザーにつき1件、§5）に
 * ぶつかる前に知らせる必要があるため。
 */
export function alreadyBooked(slotLabel: string): LineMessage {
  return {
    type: 'text',
    text: [
      `すでに ${slotLabel} でご予約をお取りしています。`,
      '',
      '日時を変えるときは「変更」、取り消すときは「キャンセル」と送ってください。',
    ].join('\n'),
  };
}

export function slotTaken(): LineMessage {
  return {
    type: 'text',
    text: '申し訳ありません、その枠が埋まりました。別の枠からお選びください。',
  };
}

export function toHuman(): LineMessage {
  return {
    type: 'text',
    text: [
      '担当者よりご連絡します。少々お待ちください。',
      '',
      'お急ぎの場合、ご予約の取り消しは「キャンセル」、日時の変更は「変更」と送っていただけます。',
    ].join('\n'),
  };
}

export function noBooking(): LineMessage {
  return { type: 'text', text: '現在お取りしているご予約はありません。' };
}

export function cancelled(): LineMessage {
  return {
    type: 'text',
    text: 'ご予約をキャンセルしました。またのご利用をお待ちしています。',
  };
}

export function dbError(): LineMessage {
  return {
    type: 'text',
    text: 'うまく処理できませんでした。担当者よりご連絡します。',
  };
}
