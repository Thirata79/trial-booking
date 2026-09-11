/**
 * 受信済み event_id の記録（spec §12「event_id 重複 → 200、処理しない」）。
 *
 * 本番は webhook_events テーブル（src/db.ts）。
 * メモリ実装は、Supabase を用意する前に LINE 上の動作を見せるためのもの。
 * **プロセスが再起動すると重複判定が消える。** デモ限定。
 */
export type MarkEventSeen = (eventId: string) => Promise<boolean>;

/** 覚えておく件数の上限。超えたら古いものから捨てる。 */
const MAX_REMEMBERED = 10_000;

export function createMemoryEventStore(): MarkEventSeen {
  const seen = new Set<string>();
  return async (eventId: string) => {
    if (seen.has(eventId)) return false;
    seen.add(eventId);
    if (seen.size > MAX_REMEMBERED) {
      // Set は挿入順を保つので、先頭が最も古い。
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
    return true;
  };
}
