import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const full = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  LINE_CHANNEL_SECRET: 'channel-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'channel-access-token',
};

describe('loadConfig', () => {
  it('必須の環境変数が揃っていれば読み込める', () => {
    const config = loadConfig({ ...full, TIMEZONE: 'Asia/Tokyo', PORT: '3000' });
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.timezone).toBe('Asia/Tokyo');
    expect(config.port).toBe(3000);
  });

  it('TIMEZONE と PORT は既定値にフォールバックする', () => {
    const config = loadConfig({ ...full });
    expect(config.timezone).toBe('Asia/Tokyo');
    expect(config.port).toBe(8080);
  });

  it('欠けている環境変数をすべて挙げて落ちる', () => {
    const { LINE_CHANNEL_SECRET, SUPABASE_URL, ...rest } = full;
    expect(() => loadConfig(rest)).toThrowError(
      /SUPABASE_URL, LINE_CHANNEL_SECRET/,
    );
  });

  it('空白だけの値は未設定として扱う', () => {
    expect(() => loadConfig({ ...full, SUPABASE_URL: '   ' })).toThrowError(
      /SUPABASE_URL/,
    );
  });

  it('PORT が数値でなければ落ちる', () => {
    expect(() => loadConfig({ ...full, PORT: 'abc' })).toThrowError(/PORT/);
  });
});
