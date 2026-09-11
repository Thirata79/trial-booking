/**
 * LINE Messaging API の薄いラッパ（spec §13 T3）。
 *
 * reply token は1回限り・短時間有効なので、応答は原則 reply（spec §6）。
 * push は従量課金対象で、リマインドにだけ使う（spec §9）。
 */

export type QuickReplyItem = {
  type: 'action';
  action: { type: 'postback'; label: string; data: string; displayText?: string };
};

export type LineMessage =
  | { type: 'text'; text: string; quickReply?: { items: QuickReplyItem[] } }
  | {
      type: 'template';
      altText: string;
      template: {
        type: 'buttons';
        text: string;
        actions: { type: 'postback'; label: string; data: string; displayText?: string }[];
      };
    };

export type LineClient = {
  reply(replyToken: string, messages: LineMessage[]): Promise<void>;
  push(to: string, messages: LineMessage[]): Promise<void>;
};

const API = 'https://api.line.me/v2/bot/message';

export type LineClientOptions = {
  accessToken: string;
  fetchImpl?: typeof fetch;
  onError?: (error: unknown, context: string) => void;
};

export function createLineClient(options: LineClientOptions): LineClient {
  const doFetch = options.fetchImpl ?? fetch;
  const logError =
    options.onError ?? ((error: unknown, context: string) => console.error(`[${context}]`, error));

  /**
   * spec §12：LINE API エラーはリトライ1回、失敗したらログのみ。
   *
   * ただし 4xx では再送しない。こちらの要求が悪い（無効な reply token など）ので
   * 繰り返しても直らず、成功していた場合に利用者へ二重送信する危険だけが残る。
   * 再送するのは通信エラーと 5xx に限る。
   */
  async function send(path: string, body: unknown, context: string): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await doFetch(`${API}/${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.accessToken}`,
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return;

        const detail = await res.text().catch(() => '');
        const error = new Error(`LINE ${path} が ${res.status} を返した: ${detail}`);
        if (res.status < 500) {
          logError(error, context);
          return;
        }
        if (attempt === 2) {
          logError(error, context);
          return;
        }
      } catch (error) {
        if (attempt === 2) {
          logError(error, context);
          return;
        }
      }
    }
  }

  return {
    reply: (replyToken, messages) => send('reply', { replyToken, messages }, 'line.reply'),
    push: (to, messages) => send('push', { to, messages }, 'line.push'),
  };
}
