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

# 値そのものは表示せず、長さだけで取り違えを検出する。
# チャネルシークレットは32文字の16進、長期アクセストークンは150文字以上。
check_length() {
  local label="$1" value="$2" min="$3" max="$4"
  local len=${#value}
  if [ "$len" -lt "$min" ] || [ "$len" -gt "$max" ]; then
    echo "  ⚠ ${label}が${len}文字です。通常は${min}〜${max}文字で、取り違えの可能性があります。"
    return 1
  fi
  return 0
}

while :; do
  read -rsp 'LINE チャネルシークレット: ' LINE_SECRET; echo
  read -rsp 'LINE チャネルアクセストークン: ' LINE_TOKEN; echo

  if [ -z "$LINE_SECRET" ] || [ -z "$LINE_TOKEN" ]; then
    echo "  ⚠ 空の値は設定できません。"
    continue
  fi

  ok=0
  check_length 'シークレット' "$LINE_SECRET" 32 32 || ok=1
  check_length 'アクセストークン' "$LINE_TOKEN" 150 400 || ok=1
  [ "$ok" -eq 0 ] && break

  echo "  シークレットは「チャネル基本設定」、トークンは「Messaging API設定」の最下部です。"
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
echo "次: fly auth login && fly launch --no-deploy --copy-config --name trial-booking"
