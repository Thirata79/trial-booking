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
    expect(config.storage).toBe('supabase');
    expect(config.supabase?.url).toBe('https://example.supabase.co');
    expect(config.timezone).toBe('Asia/Tokyo');
    expect(config.port).toBe(3000);
  });

  it('STORAGE=memory なら Supabase の設定を要求しない', () => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...line } = full;
    const config = loadConfig({ ...line, STORAGE: 'memory' });
    expect(config.storage).toBe('memory');
    expect(config.supabase).toBeNull();
  });

  it('STORAGE=memory でも LINE の資格情報は必須', () => {
    expect(() => loadConfig({ STORAGE: 'memory' })).toThrowError(/LINE_CHANNEL_SECRET/);
  });

  it('STORAGE が不正なら落ちる', () => {
    expect(() => loadConfig({ ...full, STORAGE: 'redis' })).toThrowError(/STORAGE/);
  });

  it('TIMEZONE と PORT は既定値にフォールバックする', () => {
    const config = loadConfig({ ...full });
    expect(config.timezone).toBe('Asia/Tokyo');
    expect(config.port).toBe(8080);
  });

  it('欠けている LINE の環境変数をまとめて挙げて落ちる', () => {
    const { LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, ...rest } = full;
    expect(() => loadConfig(rest)).toThrowError(
      /LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN/,
    );
  });

  it('supabase モードで Supabase の設定が欠けていれば落ちる', () => {
    const { SUPABASE_URL, ...rest } = full;
    expect(() => loadConfig(rest)).toThrowError(/SUPABASE_URL/);
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
