#!/usr/bin/env bash
#
# .env を対話的に作る。入力した値は画面に表示されず、シェル履歴にも残らない。
#
# トークンが正しいかは長さで推測せず、LINE の API に照会して確かめる。
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  read -rp ".env はすでにあります。上書きしますか？ [y/N] " answer
  [ "$answer" = "y" ] || { echo "中止しました"; exit 1; }
fi

while :; do
  read -rsp 'LINE チャネルアクセストークン: ' LINE_TOKEN; echo

  if [ -z "$LINE_TOKEN" ]; then
    echo "  ⚠ 空の値は設定できません。"
    continue
  fi

  echo -n "  LINE に照会中... "
  code=$(curl -s -o /tmp/line-bot-info.$$ -w '%{http_code}' \
    -H "Authorization: Bearer ${LINE_TOKEN}" https://api.line.me/v2/bot/info || echo 000)

  if [ "$code" = "200" ]; then
    name=$(sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p' "/tmp/line-bot-info.$$")
    rm -f "/tmp/line-bot-info.$$"
    echo "OK"
    echo "  → チャネル名: ${name:-（取得できず）}"
    read -rp "  このチャネルで合っていますか？ [Y/n] " ok
    [ "$ok" = "n" ] || break
  else
    rm -f "/tmp/line-bot-info.$$"
    echo "NG (HTTP $code)"
    echo "  LINE に拒否されました。「Messaging API設定」タブの最下部、"
    echo "  チャネルアクセストークンの「発行」で出る文字列を丸ごと貼り付けてください。"
  fi
done

# シークレットは API で検証できない（Webhook の署名計算にしか使わない）。
# 形式が通常と違う場合だけ知らせて、判断は本人に委ねる。
while :; do
  read -rsp 'LINE チャネルシークレット: ' LINE_SECRET; echo
  [ -n "$LINE_SECRET" ] || { echo "  ⚠ 空の値は設定できません。"; continue; }

  if printf '%s' "$LINE_SECRET" | grep -qE '^[0-9a-f]{32}$'; then
    break
  fi
  echo "  ⚠ ${#LINE_SECRET}文字で、16進32文字という通常の形式と違います。"
  echo "  「チャネル基本設定」タブのチャネルシークレットです（Messaging API設定ではありません）。"
  read -rp "  入力し直しますか？ [Y/n] " retry
  [ "$retry" = "n" ] && break
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
echo "次: fly auth login"
