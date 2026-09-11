# trial-booking

LINE上で体験予約を完結させる、SUPREME LAB 専用アプリ。

仕様は [`docs/spec.md`](docs/spec.md)。**着手前に必ず読むこと。**

- 1施設専用。テナント／マルチ店舗の抽象化は入れない（spec §0-3）
- dojo-booking のコードは持ち込まない。資源も共有しない（spec §0-5, §3）

## スタック

| | |
|---|---|
| ランタイム | Node 22+ / TypeScript（ESM） |
| HTTP | Hono（`@hono/node-server`） |
| DB | Supabase（trial-booking 専用の新規プロジェクト） |
| デプロイ | Fly.io（webhook・管理API・cron を1アプリに同居） |
| テスト | Vitest |

## セットアップ

```bash
npm install
cp .env.example .env   # 値を埋める
```

### Supabase

このリポジトリには DB を作る権限がないため、以下は手動で行う。

1. Supabase で **新規プロジェクト**を作成する（既存の dojo-booking 用プロジェクトは使わない）
2. `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を `.env` に入れる
3. マイグレーションを適用する

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

ローカルで動かす場合は Docker が必要（`npx supabase start`）。

### 適用後にやること

`settings` は1行だけ存在する前提のテーブルで、マイグレーションが
`venue_name = 'TBD'` の行を作る。**spec §2-9（施設情報）が確定したら UPDATE する。**
`slots` の中身は spec §2-1 が確定してから投入する。

## ディレクトリ

```
src/webhook/   POST /webhook（署名検証 → 冪等 → 200即返し → 非同期処理）
src/flow/      状態遷移とハンドラ
src/line/      reply / push、文面テンプレート
src/slots/     空き枠算出
src/admin/     管理API・最小画面
jobs/          前日リマインド（毎時実行）
supabase/migrations/
```

## LINE と繋いで動かす

Supabase を用意する前でも、`STORAGE=memory` にすれば LINE 上の動作を確認できる。
**この状態では予約も重複判定もプロセス再起動で消える。** 本番前に `supabase` へ戻すこと。

### 1. LINE の開発用チャネルを作る

LINE Developers で Messaging API チャネルを作り、次の2つを控える。

- チャネルシークレット（Basic settings）
- チャネルアクセストークン（Messaging API settings。長期のものを発行）

同じ画面で「応答メッセージ」を off、「Webhook」を on にする。
**既存の本番チャネルは触らない。**

### 2. ローカルで動かす

```bash
cp .env.example .env   # LINE の2つと STORAGE=memory を入れる
npm run build
node dist/src/webhook/index.js
curl localhost:8080/health
```

### 3. Fly.io にデプロイ

```bash
fly auth login
fly launch --no-deploy --copy-config --name trial-booking
fly secrets set LINE_CHANNEL_SECRET=xxx LINE_CHANNEL_ACCESS_TOKEN=yyy
fly deploy
```

デプロイ後、`https://<アプリ名>.fly.dev/webhook` を LINE の Webhook URL に設定し、
「検証」を押す。200 が返れば繋がっている。

## タスクの進め方

spec §13 の順に、1タスク1PR。まとめない。
受け入れ条件（spec §11）を満たさないものはマージしない。
