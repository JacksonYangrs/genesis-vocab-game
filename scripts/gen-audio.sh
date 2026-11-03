#!/usr/bin/env bash
#
# 生成小程序/网页版用的单词发音音频（mp3）
#
# 背景：微信小程序的运行环境是裁剪过的沙箱，没有 speechSynthesis / SpeechSynthesisUtterance，
#       浏览器里的 Web Speech API 在小程序里完全不可用。因此发音必须预先生成音频文件，
#       用 wx.createInnerAudioContext() 播放。
#
# 链路：macOS 内置 say 命令（离线、无需 API key、无需网络）
#       → .m4a → ffmpeg 转 mp3（单声道 22.05kHz 48kbps，单个约 4KB）
#
# 用法：bash scripts/gen-audio.sh
# 依赖：macOS 内置 say、ffmpeg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/audio"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

VOICE="${GV_VOICE:-Samantha}"   # 美式女声，清晰标准，适合单词朗读
RATE="${GV_RATE:-175}"           # 略慢于默认(~175)，单词更清晰

mkdir -p "$OUT"

gen() {
  local text="$1" name="$2"
  if [ -f "$OUT/$name.mp3" ]; then
    echo "  skip  $name.mp3 (已存在)"
    return
  fi
  say -v "$VOICE" -r "$RATE" --data-format=aac -o "$TMP/$name.m4a" "$text"
  ffmpeg -y -loglevel error -i "$TMP/$name.m4a" \
    -ac 1 -ar 22050 -b:a 48k -metadata title="$name" "$OUT/$name.mp3"
  printf "  ok    %-18s %s\n" "$name.mp3" "$(du -h "$OUT/$name.mp3" | cut -f1)"
}

echo "生成单词音频 → $OUT"

# ---- 17 个生词 ----
gen "beginning"  "word-beginning"
gen "God"        "word-god"
gen "heaven"     "word-heaven"
gen "heavens"    "word-heavens"
gen "earth"      "word-earth"
gen "create"     "word-create"
gen "created"    "word-created"
gen "barren"     "word-barren"
gen "form"       "word-form"
gen "life"       "word-life"
gen "ocean"      "word-ocean"
gen "roaring"    "word-roaring"
gen "darkness"   "word-darkness"
gen "Spirit"     "word-spirit"
gen "water"      "word-water"
gen "move"       "word-move"
gen "moving"     "word-moving"

# ---- 例句（听音辨词 / 发音训练朗读整句用） ----
gen "In the beginning God created the heavens and the earth."            "sent-beginning"
gen "But the Spirit of God was moving over the water."                    "sent-spirit"
gen "God created heaven and earth."                                       "sent-heaven"
gen "The earth was barren, with no form of life."                         "sent-earth"
gen "It was under a roaring ocean covered with darkness."                 "sent-ocean"
gen "The Spirit of God moved over the water."                             "sent-move"

echo "完成：$(ls "$OUT"/*.mp3 2>/dev/null | wc -l | tr -d ' ') 个音频，总计 $(du -sh "$OUT" | cut -f1)"
