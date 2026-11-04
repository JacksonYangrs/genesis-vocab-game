#!/usr/bin/env python3
"""
生成创世记 1:1-2 (CEV) 课程包 —— courses/genesis-1-1-2.json

用词典构建脚本产出的精选词典，按分层算法给 17 个生词分层，
再组装成与教师端完全一致的课程包格式。

这样课程包是"脚本产物"而不是"手写数据"，
教师端再导入新材料时走的是同一套逻辑，两边行为一致。
"""

import csv
import json
import os
import re
import sys

csv.field_size_limit(10 ** 9)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
LEXICON = os.path.join(PROJECT, "assets", "dict", "lexicon.json")
OUT_DIR = os.path.join(PROJECT, "courses")

# 创世记 1:1-2 (CEV) 的 17 个重点生词
TARGETS = [
    "beginning", "god", "heaven", "heavens", "earth", "create", "created",
    "barren", "form", "life", "ocean", "roaring", "darkness", "spirit",
    "water", "move", "moving",
]

# 人工策划的易混干扰项 —— 自动生成质量不够，这组是手工校准的
MANUAL_DISTRACTORS = {
    "heaven":   ["heavens", "heavenly", "heavens"],
    "heavens":  ["heaven", "heavenly", "heavens"],
    "create":   ["created", "moving", "move"],
    "created":  ["create", "moving", "move"],
    "move":     ["moved", "moving", "movement"],
    "moving":   ["move", "moved", "movement"],
    "beginning": ["begin", "begun", "beginnings"],
    "barren":   ["barrenly", "barrens", "roaring"],
    "roaring":  ["roar", "roared", "roarer"],
    "darkness": ["dark", "darkened", "dawn"],
    "spirit":   ["spirits", "spiritual", "sprout"],
    "form":     ["formed", "former", "forms"],
    "life":     ["lives", "lively", "light"],
    "ocean":    ["oceans", "oceanic", "motion"],
    "earth":    ["earthly", "earths", "eager"],
    "water":    ["waters", "watery", "later"],
    "god":      ["gods", "godly", "gold"],
}

QUOTE_EN = ("In the beginning God created the heavens and the earth. "
            "The earth was barren, with no form of life; it was under a roaring "
            "ocean covered with darkness. But the Spirit of God was moving over the water.")

# CEV 经文原句（用于句子填空 / 句子排序）
SENTENCES = [
    ("In the beginning God created the heavens and the earth.", "beginning"),
    ("The earth was barren, with no form of life.", "barren"),
    ("The earth was barren, with no form of life; it was under a roaring ocean covered with darkness.", "barren"),
    ("It was under a roaring ocean covered with darkness.", "roaring"),
    ("But the Spirit of God was moving over the water.", "moving"),
    ("The Spirit of God was moving over the water.", "spirit"),
]

VOWEL = re.compile(r"[aeiouy]")
SUFFIXES = ["ing", "ed", "es", "s", "ly", "ness", "ment", "tion", "ful",
            "ous", "ive", "er", "est", "al", "ic", "ate", "ize", "ise", "ify"]


def syllables(w):
    w = w.lower()
    n = len(VOWEL.findall(w))
    if w.endswith("e") and n > 1:
        n -= 1
    return max(1, n)


def stem(w):
    for s in SUFFIXES:
        if len(w) - len(s) >= 4 and w.endswith(s):
            return w[:-len(s)]
    return w


def quantile(values, q):
    """分位数（与 js/lexicon.js 的 quantile 一致）"""
    if not values:
        return 0
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo, hi = int(pos // 1), int(-(-pos // 1))
    if lo == hi:
        return s[lo]
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def difficulty(word, info):
    """与 js/lexicon.js 的 difficulty() 保持一致"""
    score = 0
    score += (syllables(word) - 1) * 18
    score += max(0, len(word) - 4) * 6
    freq = info.get("f", 0) or 0
    if freq == 0:
        score += 26
    elif freq <= 3000:
        score += 0
    elif freq <= 12000:
        score += 6
    elif freq <= 40000:
        score += 12
    else:
        score += 18
    semis = info.get("c", "").count(";")
    if semis >= 4:
        score += 6
    if semis >= 8:
        score += 5
    return score


def main():
    if not os.path.exists(LEXICON):
        print(f"找不到词典 {LEXICON}，请先运行 scripts/build-lexicon.py", file=sys.stderr)
        return 1

    with open(LEXICON, encoding="utf-8") as fh:
        lex = json.load(fh)

    scored = []
    for w in TARGETS:
        info = lex.get(w)
        if not info:
            print(f"  ⚠ 词典缺词: {w}", file=sys.stderr)
            continue
        scored.append({"word": w, "info": info, "score": difficulty(w, info)})

    scored.sort(key=lambda x: x["score"])

    # 分层：按难度排名分配层位，严格保证 入门 > 进阶 > 挑战 的词数单调递减。
    #
    # 为什么不用「难度门槛过滤」：门槛是按分数切，同分的词会一起落在同一侧，
    # 层内数量不可控 —— 实测 17 个词切出过 10/3/4、8/4/5 两种非单调结果。
    # 按排名分配则层位完全由顺序决定，单调性天然成立。
    #
    # 比例：入门 47% / 进阶 29% / 挑战 24%
    # （对应松哥定的「越初级生词表越长」——大部分词已认识，只剩少数难词）
    n = len(scored)
    n0 = max(1, round(n * 0.47))
    n1 = max(1, round(n * 0.29))
    if n0 + n1 >= n:
        n0 = max(1, n - 2)
        n1 = 1
    t1 = scored[n0 - 1]["score"] if n0 else 0
    t2 = scored[n0 + n1 - 1]["score"] if n0 + n1 else 0

    for i, item in enumerate(scored):
        item["level"] = 0 if i < n0 else (1 if i < n0 + n1 else 2)

    levels = [[], [], []]
    for item in scored:
        levels[item["level"]].append(item)

    # 若某层为空（极端情况），保底把最难的词放进去
    if not levels[2] and levels[1]:
        levels[2] = levels[1][-3:]
        levels[1] = levels[1][:-3]
    if not levels[1] and levels[0]:
        levels[1] = levels[0][-3:]
        levels[0] = levels[0][:-3]

    words = []
    for lv, lst in enumerate(levels):
        for item in lst:
            w = item["word"]
            # 英文干扰项：人工策划优先，不足用同层词补
            distractors = []
            for d in MANUAL_DISTRACTORS.get(w, []):
                if d != w and d not in distractors and d in lex:
                    distractors.append(d)
            for other in lst:
                if len(distractors) >= 3:
                    break
                ow = other["word"]
                if ow != w and ow not in distractors:
                    distractors.append(ow)
            distractors = distractors[:3]

            # 中文干扰项：同层其他词的释义
            cn = []
            for other in lst:
                if len(cn) >= 3:
                    break
                m = other["info"]["c"]
                if m != item["info"]["c"] and m not in cn:
                    cn.append(m)

            example = ""
            for text, target in SENTENCES:
                if target == w:
                    example = text
                    break
            if not example:
                example = next((t for t, tg in SENTENCES if w in t.lower()), "")

            words.append({
                "id": "w_" + w,
                "word": w,
                "phonetic": item["info"]["p"],
                "meaning": item["info"]["c"],
                "pos": item["info"]["t"],
                "level": lv,
                "score": item["score"],
                "distractors": distractors,
                "cnDistractors": cn,
                "example": example,
                "syllables": None,
            })

    sentences = []
    for text, target in SENTENCES:
        item = next((x for x in scored if x["word"] == target), None)
        sentences.append({
            "text": text,
            "target": target,
            "level": item["level"] if item else 0,
        })

    data = {
        "id": "genesis-1-1-2",
        "title": "创世记 1:1–2",
        "subtitle": "CEV · Genesis 1:1-2",
        "reference": "Genesis 1:1-2 (CEV)",
        "quote": "「起初，神创造了诸天和大地。大地空荒，毫无生命的形态；是被咆哮的海洋覆盖着的黑暗。但神的灵在水面上运行。」",
        "createdAt": 1700000000000,
        "thresholds": {"t1": t1, "t2": t2},
        "words": words,
        "sentences": sentences,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "genesis-1-1-2.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))

    index = [{
        "id": "genesis-1-1-2",
        "title": "创世记 1:1–2",
        "subtitle": "CEV · Genesis 1:1-2",
        "reference": "Genesis 1:1-2 (CEV)",
        "quote": data["quote"],
        "wordCount": len(words),
        "levelCounts": {"0": len(levels[0]), "1": len(levels[1]), "2": len(levels[2])},
        "file": "genesis-1-1-2.json",
    }]
    with open(os.path.join(OUT_DIR, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)

    size = os.path.getsize(path)
    print(f"课程包已生成: {path}  ({size / 1024:.1f} KB)")
    print(f"  入门 {len(levels[0])} / 进阶 {len(levels[1])} / 挑战 {len(levels[2])}  （单调递减: "
          f"{'✓' if len(levels[0]) > len(levels[1]) > len(levels[2]) else '✗'}）")
    for lv, name in ((0, "入门"), (1, "进阶"), (2, "挑战")):
        ws = [x["word"] for x in levels[lv]]
        print(f"  {name}: {ws}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
