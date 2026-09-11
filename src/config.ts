/**
 * 環境変数の読み込みと検証（spec §3）。
 * 起動時に一度だけ呼び、欠けているものがあればその場で落とす。
 */

export type Config = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  timezone: string;
  port: number;
};

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`環境変数が設定されていません: ${missing.join(', ')}`);
  }

  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT が不正です: ${env.PORT}`);
  }

  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    lineChannelSecret: env.LINE_CHANNEL_SECRET!,
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN!,
    timezone: env.TIMEZONE?.trim() || 'Asia/Tokyo',
    port,
  };
}
