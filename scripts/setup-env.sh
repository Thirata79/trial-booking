#!/usr/bin/env bash
#
# .env を対話的に作る。入力した値は画面に表示されず、シェル履歴にも残らない。
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  read -rp ".env はすでにあります。上書きしますか？ [y/N] " answer
  [ "$answer" = "y" ] || { echo "中止しました"; exit 1; }
fi

read -rsp 'LINE チャネルシークレット: ' LINE_SECRET; echo
read -rsp 'LINE チャネルアクセストークン: ' LINE_TOKEN; echo

[ -n "$LINE_SECRET" ] && [ -n "$LINE_TOKEN" ] || { echo "空の値は設定できません"; exit 1; }

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
echo "次: fly auth login && fly launch --no-deploy --copy-config --name trial-booking"
