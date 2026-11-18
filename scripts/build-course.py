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


def to_ipa(raw):
    """ECDICT 音标 → 标准 IPA（保守版）

    与 js/lexicon.js 的 toIPA() 保持一致。

    原则：不猜。
    ECDICT 音标是混合体 —— 准 IPA（ˈdʒɛnəsɪs）与老式 ASCII（'bi'giniŋ）混用。
    老式里的 `i` 是 /ɪ/，准 IPA 里的 `i` 是 /i/（happy vowel），
    光看字符无法区分，所以只做绝对安全的符号规范化，
    元音层面的偏差靠 PHONETIC_OVERRIDE 覆盖。
    """
    if not raw:
        return ""
    t = str(raw).strip().strip("/").strip("'")
    if not t:
        return ""
    fixes = [
        (r":+", "ː"),
        (r"'", "ˈ"),
        (r"ɡ", "ɡ"),
        (r"ә", "ə"),
        (r"ɛi", "eɪ"),
        (r"ɛə", "eə"),
        (r"ɑi", "aɪ"),
        (r"ɔu", "əʊ"),
        (r"ːː+", "ː"),
        # ECDICT 老式音标里确定的错写组合，安全修正
        (r"ei", "eɪ"), (r"ai", "eɪ"), (r"ay", "eɪ"),
        (r"əu", "əʊ"),
        (r"ee", "iː"), (r"ea", "iː"), (r"oo", "uː"),
        (r"ou", "aʊ"), (r"ow", "aʊ"),
        (r"oi", "ɔɪ"), (r"oy", "ɔɪ"),
        (r"ch", "tʃ"), (r"sh", "ʃ"), (r"th", "θ"),
        (r"ng", "ŋ"),
        (r"g", "ɡ"),
    ]
    for pat, rep in fixes:
        t = re.sub(pat, rep, t)
    # 只保留 IPA 合法字符
    # 注意：ɡ（U+0261，IPA 的 g）必须在列表里，
    # 否则上面刚做的 g→ɡ 归一会把它当非法字符删掉
    t = re.sub(r"[^a-zɑɒɔɛɪʊʌæɜəɚʃʒŋθðɡˈˌː().·\-\s]", "", t, flags=re.I)
    return "/" + t.strip() + "/"


def short_meaning(raw):
    """精简释义：取一个义项，控制在 12 字以内。

    与 js/lexicon.js 的 shortMeaning() 保持一致。
    ECDICT 的 translation 是完整词典释义，动辄几十字，
    直接用在题目选项和反馈面板里既挤又乱。

    选取策略：优先名词义项 → 动词义项 → 第一个义项。
    """
    if not raw:
        return ""
    s = raw.strip()
    items = [x.strip() for x in re.split(r"[;；]", s) if x.strip()]
    if not items:
        return s

    chosen = ""
    for it in items:
        if re.match(r"^n\.?\s", it, re.I):
            chosen = it
            break
    if not chosen:
        for it in items:
            if re.match(r"^v(t)?\.?\s", it, re.I):
                chosen = it
                break
    if not chosen:
        chosen = items[0]

    first = re.sub(r"^[a-z]+\.?\s*", "", chosen, flags=re.I).strip()
    if not first:
        first = chosen
    first = re.sub(r"\[[^\]]*\]", "", first).strip()
    if len(first) > 12:
        comma = first.find(",")
        if 0 < comma <= 12:
            first = first[:comma]
        elif len(first) > 16:
            first = first[:14] + "…"
    return first


# 圣经专有名词标准译法表
#
# 问题：ECDICT 是通用英汉词典，genesis 给的是「发生, 起源, 创世记」，
# 但圣经学习场景要的是「创世记」；exodus 给「大批的离去」而非「出埃及记」。
# 这里补一份圣经场景的专名标准译法，优先级高于通用义项。
# 与 js/lexicon.js 的 BIBLE_TERMS 保持一致。
BIBLE_TERMS = {
    # 旧约 39 卷
    "genesis": "创世记", "exodus": "出埃及记", "leviticus": "利未记",
    "numbers": "民数记", "deuteronomy": "申命记", "joshua": "约书亚记",
    "judges": "士师记", "ruth": "路得记", "samuel": "撒母耳记上",
    "kings": "列王纪上", "chronicles": "历代志上", "ezra": "以斯拉记",
    "nehemiah": "尼希米记", "esther": "以斯帖记", "job": "约伯记",
    "psalms": "诗篇", "psalm": "诗篇", "proverbs": "箴言", "ecclesiastes": "传道书",
    "song": "雅歌", "songofsolomon": "雅歌", "isaiah": "以赛亚书",
    "jeremiah": "耶利米书", "lamentations": "耶利米哀歌", "ezekiel": "以西结书",
    "daniel": "但以理书", "hosea": "何西阿书", "joel": "约珥书",
    "amos": "阿摩司书", "obadiah": "俄巴底亚书", "jonah": "约拿书",
    "micah": "弥迦书", "nahum": "那鸿书", "habakkuk": "哈巴谷书",
    "zephaniah": "西番雅书", "haggai": "哈该书", "zechariah": "撒迦利亚书",
    "malachi": "玛拉基书",
    # 新约 27 卷
    "matthew": "马太福音", "mark": "马可福音", "luke": "路加福音",
    "john": "约翰福音", "acts": "使徒行传", "romans": "罗马书",
    "corinthians": "哥林多前书", "galatians": "加拉太书", "ephesians": "以弗所书",
    "philippians": "腓立比书", "colossians": "歌罗西书", "thessalonians": "帖撒罗尼迦前书",
    "timothy": "提摩太前书", "titus": "提多书", "philemon": "腓利门书",
    "hebrews": "希伯来书", "james": "雅各书", "peter": "彼得前书",
    "johns": "约翰一书", "jude": "犹大书", "revelation": "启示录",
    # 常见圣经专名
    "adam": "亚当", "eve": "夏娃", "noah": "挪亚", "abraham": "亚伯拉罕",
    "abram": "亚伯兰", "isaac": "以撒", "jacob": "雅各", "israel": "以色列",
    "moses": "摩西", "aaron": "亚伦", "caleb": "迦勒", "samson": "参孙",
    "delilah": "黛莉拉", "david": "大卫", "solomon": "所罗门",
    "elijah": "以利亚", "elisha": "以利沙", "zelbabel": "别西八",
    "mordecai": "末底改", "joseph": "约瑟", "pharaoh": "法老",
    "angel": "天使", "angels": "天使", "spirit": "灵", "gospel": "福音",
    "apostle": "使徒", "apostles": "使徒", "church": "教会",
    "christ": "基督", "jesus": "耶稣", "messiah": "弥赛亚",
    "savior": "救主", "lord": "主", "god": "上帝",
    "sin": "罪", "grace": "恩典", "faith": "信心", "hope": "希望",
    "love": "爱", "prayer": "祷告", "baptism": "洗礼", "communion": "圣餐",
    "resurrection": "复活", "salvation": "救恩", "redemption": "救赎",
    "covenant": "约", "temple": "圣殿", "altar": "祭坛", "sacrifice": "献祭",
    "tabernacle": "会幕", "ark": "约柜", "prophecy": "预言", "prophets": "先知",
    "parable": "比喻", "miracle": "神迹", "miracles": "神迹",
    "disciple": "门徒", "disciples": "门徒", "worship": "敬拜",
    "fast": "禁食", "festival": "节期", "passover": "逾越节",
    "pentecost": "五旬节", "sabbath": "安息日", "sinai": "西奈山",
    "zion": "锡安", "jerusalem": "耶路撒冷", "jericho": "耶利哥",
    "babylon": "巴比伦", "egypt": "埃及", "canaan": "迦南",
    "gilead": "基列", "jordan": "约旦河", "galilee": "加利利",
    "bethlehem": "伯利恒", "nazareth": "拿撒勒", "damascus": "大马士革",
    "rome": "罗马", "athens": "雅典",
}

# 音标人工校准表（已核对过的标准音标，优先于 ECDICT）
# 与 js/lexicon.js 的 PHONETIC_OVERRIDE 保持一致。
PHONETIC_OVERRIDE = {
    "genesis": "/ˈdʒɛnəsɪs/",
    "exodus": "/ˈɛksədəs/",
    "leviticus": "/ləˈvɪtɪkəs/",
    "numbers": "/ˈnʌmbərz/",
    "deuteronomy": "/ˌduːtəˈrɑːnəmi/",
    "separated": "/ˈsɛpəreɪtɪd/",
    # 创世记课程里已核对的词（ECDICT 的老式音标元音不准）
    "beginning": "/bɪˈɡɪnɪŋ/",
    "created": "/krɪˈeɪtɪd/",
    "roaring": "/ˈrɔːɪŋ/",
    "heavens": "/ˈhɛvənz/",
    "heaven": "/ˈhɛvən/",
    "barren": "/ˈbærən/",
    "darkness": "/ˈdɑːknəs/",
    "moving": "/ˈmuːvɪŋ/",
    "ocean": "/ˈəʊʃən/",
    "spirit": "/ˈspɪrɪt/",
    "create": "/kriˈeɪt/",
    "life": "/laɪf/",
    "earth": "/ɜːθ/",
    "form": "/fɔːm/",
    "move": "/muːv/",
    "water": "/ˈwɔːtə/",
    "god": "/ɡɒd/",
}

# 人工校准：ECDICT 缺义项或义项不匹配教学场景的词
# （moving 只有"动人的"没有"移动的"；heavens 的义项格式特殊）
MEANING_OVERRIDE = {
    "moving":   "移动的, 活动的",
    "heavens":  "诸天, 天空",
    "created":  "创造了",
    "barren":   "荒芜的, 贫瘠的",
    "roaring":  "咆哮的, 轰鸣的",
    "beginning": "开始, 起初",
    "darkness": "黑暗",
    "ocean":    "海洋, 大海",
    "spirit":   "灵, 圣灵",
    "heaven":   "天堂, 天",
    "god":      "上帝, 神",
    "life":     "生命, 生活",
    "form":     "形状, 形式",
    "earth":    "地球, 大地",
    "water":    "水",
    "move":     "移动, 运动",
    "create":   "创造, 创作",
    # 圣经语境的常用词（通用义项在此处不准确或太长）
    "separated": "分开的, 分离的",
    "light":    "光, 光亮",
    "day":      "日, 白天",
    "night":    "夜, 夜晚",
    "morning":  "早晨, 清晨",
    "evening":  "傍晚, 夜晚",
    "called":   "称为, 呼召",
    "saw":      "看见, 察觉",
    "said":     "说, 讲",
    "made":     "造, 制作",
    "gave":     "给, 赐",
    "land":     "土地, 陆地",
    "famine":   "饥荒",
    "covered":  "覆盖, 遮盖",
}


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
                ow = other["word"]
                m = BIBLE_TERMS.get(ow) or MEANING_OVERRIDE.get(ow, short_meaning(other["info"]["c"]))
                mine = BIBLE_TERMS.get(w) or MEANING_OVERRIDE.get(w, short_meaning(item["info"]["c"]))
                if m != mine and m not in cn:
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
                "phonetic": PHONETIC_OVERRIDE.get(w) or to_ipa(item["info"]["p"]),
                "meaning": BIBLE_TERMS.get(w) or MEANING_OVERRIDE.get(w, short_meaning(item["info"]["c"])),
                "fullMeaning": item["info"]["c"],
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
        "quoteEn": QUOTE_EN,
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
        "quoteEn": data["quoteEn"],
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
