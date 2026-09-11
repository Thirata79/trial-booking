import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LINE の署名検証（spec §6 / §12）。
 *
 * 署名は「チャネルシークレットを鍵とした、リクエストボディの HMAC-SHA256」を
 * base64 にしたもの。ボディは **パース前の生文字列**でなければならない。
 * JSON.parse → JSON.stringify を挟むとキー順や空白が変わって一致しなくなる。
 */
export function verifySignature(
  rawBody: string,
  signature: string | undefined,
  channelSecret: string,
): boolean {
  if (!signature) return false;

  const expected = createHmac('sha256', channelSecret)
    .update(rawBody, 'utf8')
    .digest();

  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }

  // timingSafeEqual は長さが違うと例外を投げるため、先に弾く。
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
