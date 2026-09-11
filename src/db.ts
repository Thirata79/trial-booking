import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MarkEventSeen } from './webhook/event-store.js';

/** service_role キーで接続する。RLS はバイパスされる（migration の方針を参照）。 */
export function createDbClient(config: { url: string; serviceRoleKey: string }): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const UNIQUE_VIOLATION = '23505';

/**
 * event_id を webhook_events に記録する。初めてなら true、既出なら false。
 * 「先に SELECT してから INSERT」ではなく INSERT の一意制約違反で判定する
 * ——同一イベントが同時に2回届いても、通るのは片方だけになる。
 */
export function makeMarkEventSeen(db: SupabaseClient): MarkEventSeen {
  return async (eventId: string): Promise<boolean> => {
    const { error } = await db.from('webhook_events').insert({ event_id: eventId });
    if (!error) return true;
    if (error.code === UNIQUE_VIOLATION) return false;
    throw new Error(`webhook_events への記録に失敗: ${error.message}`, { cause: error });
  };
}
