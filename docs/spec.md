# trial-booking 実装仕様

体験予約をLINE上で完結させる単独アプリの仕様。
リポジトリ直下に `docs/spec.md` として置き、Claude Code には着手前に必ず読ませる。

- **Status**: v1.0（単独リポ版。マルチテナント版 v0.2 は破棄）
- **Owner**: 平田
- **導入先**: SUPREME LAB（1施設のみ）
- **dojo-booking との関係**: **なし。** コードを共有しない、参照しない、コピーしない

---

## 0. 実装者への指示

1. このファイルと `§2 決定事項` を読む。`TBD` があれば **実装を止めて確認する**。勝手に決めない。
2. `§13 タスク分割` の順に、1タスク1PR。まとめない。
3. **1施設専用として作る。** テナント・組織・マルチ店舗の抽象化を入れない。将来必要になったら、その時に作り直す。
4. 受け入れ条件（`§11`）を満たさないものはマージしない。
5. dojo-booking リポジトリのコードを持ち込まない。似て非なる2本を作らない。

---

## 1. スコープ

### やること
- LINEでの体験予約（時間帯 → 枠 → 氏名 → 確定）
- 枠・定員・締切の管理
- 変更・キャンセル
- 前日リマインドの自動送信
- 来場／未来場の記録と、ファネル指標の集計

### やらないこと
- 決済、入会手続き
- 会員のクラス予約、入会後のチェックイン
- 複数施設対応
- 多言語
- 管理画面のデザイン（機能すれば可）

---

## 2. 決定事項

| # | 項目 | 値 | 状態 |
|---|---|---|---|
| 1 | 体験枠（曜日×時刻×定員） | 月〜日 × 12:00 / 14:00 / 16:00、各60分・定員2名 | 確定 |
| 2 | 予約締切 | 前日の18:00まで | 確定 |
| 3 | 提示する期間 | 直近14日 | 仮 |
| 4 | リマインド送信時刻 | 前日 19:00 JST（締切の1時間後） | 確定 |
| 5 | 会話状態のタイムアウト | 24時間 | 仮 |
| 6 | 選択肢を外した時の再提示 | 1回、2回目で有人へ | 仮 |
| 7 | 営業時間外のBot稼働 | 常時稼働 | 仮 |
| 8 | 有人引き継ぎの担当・応答目標 | 現場スタッフ。体験希望日の前日までに応答。気づき方はLINE公式の管理画面 | 確定 |
| 9 | 施設情報（住所・アクセス・持ち物） | スプリームラボ／港区麻布台1-11-5／神谷町駅徒歩5分／着替え | 確定 |
| 10 | 既存の応答メッセージ／有人チャットとの併用可否 | TBD | **要実機検証** |

> 10 は本番チャネルに適用する前に、開発用チャネルで確認する。
> 現在の運用が「自動で返信しています」の状態なので、切り替えで既存の問い合わせ対応を止めない。

---

## 3. 環境

**本番の dojo-booking / 徳源道場とは、一切の資源を共有しない。**

| 資源 | 新規に用意する |
|---|---|
| リポジトリ | trial-booking |
| DB | Supabase 新規プロジェクト |
| Webhook | Fly.io 新規アプリ |
| LINEチャネル | 開発用を新規作成（本番切替は最後） |

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
TIMEZONE=Asia/Tokyo
```

---

## 4. 構成

```
src/
  webhook/
    index.ts            POST /webhook（署名検証 → 冪等 → 200即返し → 非同期処理）
    verify.ts
  flow/
    machine.ts          状態遷移定義
    handlers/           各状態のハンドラ
  line/
    client.ts           reply / push
    messages.ts         文面テンプレート
  slots/
    availability.ts     空き枠算出
  admin/                管理API・最小画面
jobs/
  reminder.ts           前日リマインド（毎時実行）
supabase/migrations/
docs/spec.md            このファイル
```

---

## 5. DBスキーマ

```sql
-- 施設設定は1行だけ。テナント概念は持たない。
create table settings (
  id int primary key default 1 check (id = 1),
  venue_name text not null,
  venue jsonb not null default '{}'::jsonb,   -- 住所・アクセス・持ち物
  timezone text not null default 'Asia/Tokyo',
  remind_hour int not null default 19,
  booking_cutoff_hour int not null default 18,   -- 前日のこの時刻で締切
  slot_horizon_days int not null default 14,
  bot_enabled boolean not null default true
);

create table line_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table slots (
  id uuid primary key default gen_random_uuid(),
  weekday int not null check (weekday between 0 and 6),  -- 0=Sun
  start_time time not null,
  duration_min int not null default 60,
  capacity int not null default 1,
  timeband text not null check (timeband in ('weekday_pm','weekend_pm')),
  active boolean not null default true
);

create table slot_exceptions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  slot_id uuid references slots(id),   -- null なら当日全枠クローズ
  reason text
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid not null references line_users(id),
  slot_id uuid not null references slots(id),
  booked_date date not null,
  start_at timestamptz not null,
  name text not null,
  status text not null default 'confirmed'
    check (status in ('confirmed','cancelled','attended','no_show')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

-- 同一ユーザーが同時に持てる確定予約は1件
create unique index bookings_active_uniq
  on bookings (line_user_id) where status = 'confirmed';

create index bookings_occurrence
  on bookings (slot_id, booked_date) where status = 'confirmed';

create table conv_states (
  line_user_id uuid primary key references line_users(id),
  state text not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null
);

-- ファネル計測用の追記ログ
create table flow_events (
  id bigserial primary key,
  line_user_id uuid references line_users(id),
  from_state text,
  to_state text,
  trigger text,
  created_at timestamptz not null default now()
);

create table webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);

create table reminder_logs (
  booking_id uuid primary key references bookings(id),
  sent_at timestamptz not null default now(),
  result text not null
);
```

---

## 6. 状態機械

| 現状態 | 入力 | 処理 | 次状態 |
|---|---|---|---|
| IDLE | postback `action=start` | 時間帯の選択肢を返す | AWAIT_TIMEBAND |
| AWAIT_TIMEBAND | postback `action=band&v=<id>` | 空き枠を算出し選択肢を返す | AWAIT_SLOT |
| AWAIT_SLOT | postback `action=slot&id=<uuid>&d=<date>` | payload に保持し氏名を尋ねる | AWAIT_NAME |
| AWAIT_NAME | text | 予約を作成し確定文面を返す | IDLE |
| AWAIT_* | postback `action=consult` | 有人案内 | HUMAN |
| any（HUMAN 含む） | `キャンセル` / `action=cancel` | 確認 → 取消 | IDLE |
| any（HUMAN 含む） | `変更` / `action=change` | 取消 → 時間帯から再開 | AWAIT_TIMEBAND |
| HUMAN | 上記2つ以外 | 応答しない | 管理画面の操作で IDLE |

- 選択は **postback** で受ける。テキスト一致に依存しない
- HUMAN でも「キャンセル」「変更」だけは受ける。予約を持ったまま連絡待ちに
  なった人が、自分で取り消せなくなるため（当初の表は「any」と「HUMAN は
  応答しない」が矛盾していた）
- AWAIT_* で想定外の text が来たら選択肢を1回だけ再提示。2回連続で外れたら HUMAN
- `expires_at` 超過の state は破棄し、IDLE として扱う
- 状態が変わるたびに `flow_events` に追記する

### 空き枠の算出

```ts
availableOccurrences(timeband: Timeband, now: Date): Occurrence[]
```

1. `slots` から active かつ timeband 一致を取得
2. `now` から `slot_horizon_days` 先までの日付に展開
3. `slot_exceptions` に該当するものを除外
4. 前日の `booking_cutoff_hour` 時（施設TZ）を過ぎている日付を除外
5. 各 occurrence の confirmed 件数が `capacity` 未満のもののみ残す
6. 先頭最大12件を返す（13枠目は「別の日を相談」に充てる）

reply token の有効時間内に返せる軽さを保つこと。

### 同時予約

```sql
begin;
select count(*) from bookings
  where slot_id=$1 and booked_date=$2 and status='confirmed' for update;
-- count < capacity なら insert、そうでなければ rollback
commit;
```

失敗時は「その枠が埋まりました」と返し、AWAIT_SLOT から再提示する。

### 時刻
- DBは timestamptz（UTC）で保持。判定・表示時に `TIMEZONE` へ変換
- 「直近の◯曜」は締切を考慮して算出する（締切を過ぎた直近日はスキップ）

---

## 7. UIの表現

**画像は使わない。** 生成と差し替えの運用を発生させないため。

| 場面 | 使うもの |
|---|---|
| 時間帯の選択（平日午後／週末午後の2件） | ボタンテンプレート（最大4アクション） |
| 枠の選択（可変・最大12件） | クイックリプライ（最大13個） |
| 確定・リマインド | テキスト |
| Flexメッセージ | 必要になるまで使わない |

- ボタンのラベルは12文字以内
- postback の data は `action=...&...` のクエリ形式で統一

---

## 8. 文面

`src/line/messages.ts` に集約。施設情報は `settings.venue` から差し込み、
**文面にジム名・住所を直書きしない。**

| キー | 内容 |
|---|---|
| `ask_timeband` | 無料体験のご予約ですね。ご希望の時間帯を選んでください。 |
| `ask_slot` | ありがとうございます。体験枠から選んでください。 |
| `ask_name` | {slotLabel} でお取りします。最後に、お名前だけ教えてください。 |
| `confirmed` | {name}さま、{slotLabel} にお待ちしています。／持ち物・場所・変更方法 |
| `reminder` | 明日 {slotLabel} の体験です。／持ち物・場所・変更方法 |
| `slot_taken` | 申し訳ありません、その枠が埋まりました。別の枠からお選びください。 |
| `to_human` | 担当者よりご連絡します。少々お待ちください。 |
| `no_booking` | 現在お取りしているご予約はありません。 |

---

## 9. リマインドジョブ

- 毎時実行。`settings.remind_hour` と一致する時刻のみ処理
- 対象：翌日開始の `status='confirmed'`
- `reminder_logs` の主キー制約で二重送信を防ぐ
- 送信失敗は result に記録し、リトライしない（多重送信を避ける）
- push は従量課金対象

---

## 10. 管理機能（最小）

| 画面 | 内容 |
|---|---|
| 枠設定 | slots の CRUD、slot_exceptions の追加 |
| 予約一覧 | 日付・氏名・枠・ステータス・LINE表示名 |
| 来場記録 | confirmed → attended / no_show |
| 有人解除 | HUMAN のユーザーを IDLE に戻す |
| CSV出力 | 予約一覧 |

### 計測

| 指標 | 定義 |
|---|---|
| 申込開始数 | AWAIT_TIMEBAND に入った数（flow_events） |
| 申込完了率 | 予約作成 ÷ 申込開始数 |
| 離脱ステップ | 状態別のタイムアウト件数 |
| 来場率 | attended ÷ confirmed |
| 無断キャンセル率 | no_show ÷ confirmed |

---

## 11. 受け入れ条件

- [ ] 署名が不正なリクエストを401で拒否する
- [ ] 同一 event_id を2回受けても予約が二重に作られない
- [ ] 定員1の枠に同時2件が来た場合、1件のみ成立し、もう1件は再提示される
- [ ] 締切を過ぎた枠が選択肢に出ない
- [ ] slot_exceptions で閉じた日が選択肢に出ない
- [ ] 会話の途中で無関係なテキストを送っても、1回は選択肢が再提示される
- [ ] 2回連続で外すと HUMAN になり、以後Botが応答しない（「キャンセル」「変更」を除く）
- [ ] 24時間放置した会話が IDLE に戻る
- [ ] 前日リマインドが1予約につき1回だけ送られる
- [ ] キャンセルすると枠が解放され、同じ枠が再び選択肢に出る
- [ ] 管理画面から来場／未来場を記録でき、来場率が算出できる
- [ ] flow_events から申込完了率と離脱ステップが出せる

---

## 12. エラー処理

| 事象 | 挙動 |
|---|---|
| 署名検証失敗 | 401、ログのみ |
| event_id 重複 | 200、処理しない |
| DBエラー | 「うまく処理できませんでした。担当者よりご連絡します」→ HUMAN |
| LINE API エラー | リトライ1回、失敗したらログのみ |
| 未知の postback | 選択肢を再提示 |

---

## 13. タスク分割（1タスク1PR）

| # | 内容 | 依存 |
|---|---|---|
| T1 | リポジトリ初期化、Supabase新規プロジェクト、マイグレーション（§5） | — |
| T2 | Webhook受け口：署名検証・冪等・200即返し | T1 |
| T3 | LINEクライアントのラッパ（reply / push） | T2 |
| T4 | 空き枠算出 `availableOccurrences` ＋単体テスト | T1 |
| T5 | 状態機械と各ハンドラ（予約成立まで）＋ flow_events | T3, T4 |
| T6 | 変更・キャンセル・有人フォールバック | T5 |
| T7 | リマインドジョブ | T5 |
| T8 | 管理画面（枠設定・予約一覧・来場記録・有人解除・CSV） | T1 |
| T9 | 指標クエリ | T5 |
| T10 | 開発チャネルでの実機テスト、本番切替手順書 | 全部 |

**T1〜T4 は §2 の TBD が未確定でも着手できる。** 枠の中身に依存しない。

---

## 14. テスト

- 単体：空き枠算出（締切ちょうど、定員ちょうど、例外日）
- 単体：状態遷移（全遷移＋不正入力）
- 結合：Webhook受信 → 予約作成 → リマインド送信
- 手動：開発用LINEチャネルで一連の会話を実機確認
- **本番切替前**：既存の応答メッセージ・有人チャットとの併用挙動を確認（§2-10）

---

## 15. 将来（この仕様には含まない）

- 入会後のチェックイン（LIFF）
- 継続率・離脱予兆の検知
- 決済・在籍管理
- 複数施設対応、dojo-booking との統合

**いずれも、この仕様の範囲が実運用で回ってから検討する。先回りして抽象化しない。**
