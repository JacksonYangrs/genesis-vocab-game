#!/usr/bin/env python3
"""
生成前端词典（assets/dict/lexicon.json）

数据源：ECDICT (skywind3000/ECDICT)，MIT 许可。
原始 77 万条、66MB —— 直接前端加载不可行，这里裁剪成"教学常用词"子集。

裁剪规则（三条并集）：
  1. 有中文释义（translation 非空）
  2. 通用词频靠前（frq/bnc 排名）
  3. 牛津核心标记（oxford=1）或 collins 星级 >= 3

关键兜底：frq=0 的词（如 heavens 这类圣经专有复数）语料频次为 0，
不能因为 frq 低就丢掉 —— 这类词恰恰是学习重点。故对"有中文释义且
词形规整（纯字母、2-16 字母）"的词，只要 collins>=2 或 oxford=1 就保留，
另外保留全部 frq<=60000 的词。

输出字段（单字母压缩，减小体积）：
  c=中文释义  p=音标  t=词性  e=词形变化  f=词频
"""

import csv
import gzip
import json
import os
import sys

csv.field_size_limit(10 ** 9)

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = os.path.join(PROJECT, "assets", "dict")
SOURCE = os.environ.get("ECDICT_CSV", "/tmp/ecdict-repo/ecdict.csv")


def pos_short(pos: str) -> str:
    """词性缩写：只取第一个（n. / v. / a. / adv. ...）"""
    if not pos:
        return ""
    first = pos.split("/")[0].strip()
    # 词性字段有时是 "n:34/v:35" 这种带词频后缀的
    for sep in (":", " "):
        if sep in first:
            first = first.split(sep)[0]
    return first.strip()


def main() -> int:
    if not os.path.exists(SOURCE):
        print(f"找不到 ECDICT 源文件: {SOURCE}", file=sys.stderr)
        print("请先 clone: git clone --depth 1 --filter=blob:none "
              "--sparse https://github.com/skywind3000/ECDICT.git /tmp/ecdict-repo "
              "&& cd /tmp/ecdict-repo && git sparse-checkout set --skip-checks ecdict.csv",
              file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)

    kept = {}
    total = 0
    with open(SOURCE, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}

        def get(row, key):
            i = idx.get(key)
            if i is None or i >= len(row):
                return ""
            return row[i]

        for row in reader:
            total += 1
            word = get(row, "word").lower()
            if not word or not word.isalpha() or not (2 <= len(word) <= 16):
                continue

            translation = get(row, "translation").replace("\\n", "; ").strip()
            if len(translation) < 2:
                continue

            # 词频：frq 优先，其次 bnc
            freq = 0
            for key in ("frq", "bnc"):
                raw = get(row, key)
                if raw and raw.isdigit() and int(raw) > 0:
                    freq = int(raw) if freq == 0 else min(freq, int(raw))

            collins_raw = get(row, "collins")
            try:
                collins = int(collins_raw) if collins_raw else 0
            except ValueError:
                collins = 0
            oxford = 1 if get(row, "oxford") == "1" else 0

            # --- 三条入选规则 ---
            keep = False
            if freq and freq <= 60000:
                keep = True                       # 规则 2
            if collins >= 3 or oxford == 1:
                keep = True                       # 规则 3
            # 规则 1 兜底：frq=0 的词（如 heavens 这类圣经专有复数）语料频次为 0，
            # 不能因为频次低就丢掉 —— 这类词恰恰是学习重点。
            # 判定依据放在 collins>=2 / oxford / tag 字段上，避免无差别全收。
            if freq == 0:
                tag = get(row, "tag")
                if collins >= 2 or oxford == 1 or tag:
                    keep = True

            if not keep:
                continue

            kept[word] = {
                "c": translation,
                "p": get(row, "phonetic").strip(),
                "t": pos_short(get(row, "pos")),
                "e": (get(row, "exchange")
                      .replace("n/", "").replace("v/", "")
                      .replace("p/", "").replace("adj/", "")
                      .replace("adv/", "").replace("pron/", "").strip()),
                "f": freq,
            }

    # ---------- 词形变体反向补全 ----------
    # 有些词自身在 ECDICT 里是"孤儿"：没有 collins/oxford/tag/frq，
    # 仅有中文释义（典型如 heavens：诸天；天空（heaven 的复数形式））。
    # 但它们会被收录进其他词的 exchange 字段（如 heaven 的 s:heavens）。
    # 这里反查所有 exchange 字段，把这类词捞回来并从基础词继承释义前缀。
    variants = {}   # 变体词 -> 基础词
    for base, info in kept.items():
        ex = info.get("e") or ""
        for part in ex.split("/"):
            if ":" not in part:
                continue
            kind, vals = part.split(":", 1)
            for v in vals.split(","):
                v = v.strip()
                if v and v.isalpha() and v not in kept:
                    variants.setdefault(v, base)

    added = 0
    for var, base in variants.items():
        base_info = kept.get(base)
        if not base_info:
            continue
        base_tr = base_info["c"]
        # 从基础词释义切出中文主干（去掉 "（xxx的复数形式）" 这类括注）
        head = base_tr.split("（")[0].split("(")[0].strip().rstrip("，,")
        if not head:
            head = base_tr
        inherited = f"{head}（{base} 的变形）"
        kept[var] = {
            "c": inherited,
            "p": base_info["p"],
            "t": base_info["t"],
            "e": "",
            "f": 0,
        }
        added += 1

    raw = json.dumps(kept, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    gz = gzip.compress(raw, 9)
    json_path = os.path.join(OUT_DIR, "lexicon.json")
    gz_path = os.path.join(OUT_DIR, "lexicon.json.gz")
    with open(json_path, "wb") as fh:
        fh.write(raw)
    with open(gz_path, "wb") as fh:
        fh.write(gz)

    print(f"源词条 {total:,} → 精选 {len(kept):,} 词（其中 {added:,} 个由词形变化反推补全）")
    print(f"  lexicon.json     {len(raw) / 1048576:.2f} MB")
    print(f"  lexicon.json.gz  {len(gz) / 1048576:.2f} MB")

    # 覆盖率自检：本次课程的 17 个目标词必须全部命中
    targets = ["beginning", "god", "heaven", "heavens", "earth", "create", "created",
               "barren", "form", "life", "ocean", "roaring", "darkness", "spirit",
               "water", "move", "moving"]
    missing = [t for t in targets if t not in kept]
    if missing:
        print(f"  ⚠ 目标词缺失: {missing}", file=sys.stderr)
        return 1
    print("  ✓ 17 个目标词全部命中")
    return 0


if __name__ == "__main__":
    sys.exit(main())
