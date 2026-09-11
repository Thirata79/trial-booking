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

## タスクの進め方

spec §13 の順に、1タスク1PR。まとめない。
受け入れ条件（spec §11）を満たさないものはマージしない。
