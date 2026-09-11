/**
 * 環境変数の読み込みと検証（spec §3）。
 * 起動時に一度だけ呼び、欠けているものがあればその場で落とす。
 */

/**
 * 状態の持ち方。
 * - supabase: 本番。DB に永続化する
 * - memory : LINE 上の動作を先に見せるためのデモ用。プロセスが落ちると消える
 */
export type Storage = 'supabase' | 'memory';

export type Config = {
  storage: Storage;
  /** storage が memory のときは null。 */
  supabase: { url: string; serviceRoleKey: string } | null;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  timezone: string;
  port: number;
};

function requireAll(env: NodeJS.ProcessEnv, keys: readonly string[]): void {
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`環境変数が設定されていません: ${missing.join(', ')}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const storage = (env.STORAGE?.trim() || 'supabase') as Storage;
  if (storage !== 'supabase' && storage !== 'memory') {
    throw new Error(`STORAGE が不正です: ${env.STORAGE}（supabase か memory）`);
  }

  requireAll(env, ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN']);
  if (storage === 'supabase') {
    requireAll(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  }

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT が不正です: ${env.PORT}`);
  }

  return {
    storage,
    supabase:
      storage === 'supabase'
        ? { url: env.SUPABASE_URL!, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY! }
        : null,
    lineChannelSecret: env.LINE_CHANNEL_SECRET!,
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN!,
    timezone: env.TIMEZONE?.trim() || 'Asia/Tokyo',
    port,
  };
}
