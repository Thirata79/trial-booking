#!/usr/bin/env bash
#
# .env を対話的に作る。入力した値は画面に表示されず、シェル履歴にも残らない。
#
# トークンは、手元にあるものを貼るか、チャネルID とシークレットから発行する。
# 正しいかは長さで推測せず、LINE の API に照会して確かめる。
#
set -euo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -t line-setup)"
trap 'rm -f "$TMP"' EXIT

if [ -f .env ]; then
  read -rp ".env はすでにあります。上書きしますか？ [y/N] " answer
  [ "$answer" = "y" ] || { echo "中止しました"; exit 1; }
fi

# トークンが使えるかを LINE 本体に確認する。使えればチャネル名を返す。
verify_token() {
  local token="$1"
  local code
  code=$(curl -s -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer ${token}" https://api.line.me/v2/bot/info || echo 000)
  [ "$code" = "200" ] || { echo "  → LINE に拒否されました (HTTP $code)"; return 1; }
  echo "  → チャネル名: $(sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p' "$TMP")"
  return 0
}

echo
echo "チャネルアクセストークンを用意します。"
echo "  1) すでに持っている（Messaging API設定タブで発行済み）"
echo "  2) チャネルID とチャネルシークレットから発行する（チャネル基本設定タブの値）"
read -rp "どちらにしますか？ [1/2] " how

LINE_TOKEN=""
while [ -z "$LINE_TOKEN" ]; do
  if [ "$how" = "2" ]; then
    read -rp  'チャネルID（数字）        : ' CHANNEL_ID
    echo "  ※ 次の入力は画面に表示されません。貼り付けて Enter を押してください。"
    read -rsp 'チャネルシークレット      : ' CHANNEL_SECRET; echo
    echo "  → ${#CHANNEL_SECRET} 文字を受け取りました"
    echo -n "  発行中... "
    code=$(curl -s -o "$TMP" -w '%{http_code}' -X POST https://api.line.me/v2/oauth/accessToken \
      -H 'Content-Type: application/x-www-form-urlencoded' \
      --data-urlencode 'grant_type=client_credentials' \
      --data-urlencode "client_id=${CHANNEL_ID}" \
      --data-urlencode "client_secret=${CHANNEL_SECRET}" || echo 000)
    if [ "$code" != "200" ]; then
      echo "失敗 (HTTP $code)"
      sed -n 's/.*"error_description":"\([^"]*\)".*/  → \1/p' "$TMP"
      read -rp "  もう一度試しますか？ [Y/n] " again
      [ "$again" = "n" ] && exit 1
      continue
    fi
    echo "OK"
    candidate=$(sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' "$TMP")
    # 発行に使ったシークレットは、そのまま署名検証にも使う
    LINE_SECRET="$CHANNEL_SECRET"
  else
    echo "  ※ 次の入力は画面に表示されません。貼り付けて Enter を押してください。"
    read -rsp 'チャネルアクセストークン  : ' candidate; echo
    echo "  → ${#candidate} 文字を受け取りました"
    [ -n "$candidate" ] || { echo "  ⚠ 空です"; continue; }
    LINE_SECRET=""
  fi

  echo -n "  確認中... "; echo
  if verify_token "$candidate"; then
    read -rp "  このチャネルで合っていますか？ [Y/n] " ok
    [ "$ok" = "n" ] || LINE_TOKEN="$candidate"
  else
    read -rp "  やり直しますか？ [Y/n] " again
    [ "$again" = "n" ] && exit 1
  fi
done

# 1) を選んだ場合はシークレットを別途もらう。Webhook の署名検証に要る。
while [ -z "${LINE_SECRET:-}" ]; do
  echo "  ※ 次の入力は画面に表示されません。貼り付けて Enter を押してください。"
  read -rsp 'チャネルシークレット      : ' LINE_SECRET; echo
  echo "  → ${#LINE_SECRET} 文字を受け取りました"
  [ -n "$LINE_SECRET" ] || echo "  ⚠ 空です"
done

umask 077
cat > .env <<ENVFILE
# Supabase を用意するまではメモリ上で動かす（デモ用）
STORAGE=memory

LINE_CHANNEL_SECRET=$LINE_SECRET
LINE_CHANNEL_ACCESS_TOKEN=$LINE_TOKEN

TIMEZONE=Asia/Tokyo
PORT=8080
ENVFILE

echo
echo ".env を作成しました（このユーザーのみ読み取り可）。"
echo "2) で発行したトークンの有効期限は30日です。本番では長期トークンに差し替えてください。"
