/**
 * Lexicon —— 词典查询与分层引擎（教师端专用）
 *
 * 词典数据来自 ECDICT (skywind3000/ECDICT, MIT)，构建脚本 scripts/build-lexicon.py。
 * 学生端永不加载本模块，只有教师模式才按需 fetch。
 *
 * 职责：
 *   1. 查词：拿音标（转 IPA）+ 中文释义 + 词性
 *   2. 难度分：按词形特征 + 词频算绝对难度
 *   3. 分层：门槛过滤式切三层，越初级词越多
 */
(function (global) {
  'use strict';

  var Lexicon = {
    dict: null,        // 已加载的词条缓存（跨分片累积）
    _shards: {},       // 已加载的分片
    _loading: {},      // 正在加载的分片 promise
    loading: false,
    loaded: false,

    /**
     * 按需加载词典分片
     *
     * 词典按首字母分成 26+ 片，每片 gzip 后平均 58KB。
     * 一份课程材料通常只涉及 10-20 个首字母 → 实际加载 0.6-1MB。
     *
     * 对比全量加载：1.9MB（gzip）在慢网络下要 30-90 秒，不可接受。
     *
     * @param {Array} words  需要查的词
     * @param {function} onProgress (loaded, total)
     */
    loadShards: function (words, onProgress) {
      var self = this;
      var letters = {};
      (words || []).forEach(function (w) {
        var c = String(w || '').toLowerCase().charAt(0);
        if (c >= 'a' && c <= 'z') letters[c] = true;
      });
      var needed = Object.keys(letters);

      if (!this.dict) this.dict = {};
      if (!needed.length) {
        if (onProgress) onProgress(0, 0);
        return Promise.resolve(this.dict);
      }

      var done = 0;
      var jobs = needed.map(function (letter) {
        if (self._shards[letter]) { done++; return Promise.resolve(); }
        if (self._loading[letter]) return self._loading[letter];

        self._loading[letter] = self._fetchShard(letter).then(function (words) {
          self._shards[letter] = true;
          Object.keys(words).forEach(function (w) { self.dict[w] = words[w]; });
          done++;
          if (onProgress) onProgress(done, needed.length);
        }).catch(function (err) {
          console.warn('[Lexicon] 分片 ' + letter + ' 加载失败：', err.message);
          done++;
          if (onProgress) onProgress(done, needed.length);
        }).then(function () {
          delete self._loading[letter];
        });
        return self._loading[letter];
      });

      this.loading = true;
      return Promise.all(jobs).then(function () {
        self.loading = false;
        self.loaded = true;
        return self.dict;
      });
    },

    /** 加载单个分片 */
    _fetchShard: function (letter) {
      var gzUrl = 'assets/dict/shards/' + letter + '.json.gz';

      // 不支持 DecompressionStream 时加载未压缩分片
      if (typeof global.DecompressionStream === 'undefined') {
        return fetch('assets/dict/shards/' + letter + '.json')
          .then(function (res) {
            if (!res.ok) throw new Error('分片不存在 ' + letter);
            return res.json();
          });
      }

      return fetch(gzUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('分片不存在 ' + letter);
          return res.arrayBuffer();
        })
        .then(function (buf) {
          var stream = new global.DecompressionStream('gzip');
          var writer = stream.writable.getWriter();
          writer.write(new Uint8Array(buf));
          writer.close();
          return new global.Response(stream.readable).text();
        })
        .then(function (text) { return JSON.parse(text); });
    },

    /** 查词：返回 {word, phonetic, meaning, pos, freq} 或 null */
    lookup: function (word) {
      if (!this.dict) return null;
      var key = String(word || '').toLowerCase().trim();
      var hit = this.dict[key];
      if (!hit) return null;
      return {
        word: key,
        phonetic: toIPA(hit.p),
        rawPhonetic: hit.p,
        meaning: meaningOf(key, hit.c),
        fullMeaning: hit.c,
        pos: hit.t,
        forms: hit.e,
        freq: hit.f
      };
    },

    /** 音节数（英语教学用近似算法） */
    syllables: function (word) {
      var w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!w) return 1;
      var m = w.match(/[aeiouy]+/g);
      var n = m ? m.length : 1;
      if (w.endsWith('e') && n > 1) n -= 1;
      if (/(?:[^aeiou]le|[aeiou]{3})$/.test(w) && n > 1) n += 0; // -le 结尾已是辅音连缀
      return Math.max(1, n);
    },

    /**
     * 难度分（绝对难度，与具体材料无关）
     * 分数越高越难。
     *
     * 组成：音节数 + 词长 + 词频稀有度 + 释义复杂度
     * 词频用 ECDICT 的 frq/bnc（通用语料排名），仅作辅助信号，
     * 不作为分层主依据 —— 圣经英语的词在通用语料里频次普遍偏低。
     */
    difficulty: function (word, info) {
      var w = String(word).toLowerCase();
      var d = info || this.lookup(w);
      if (!d) return 50;

      var score = 0;
      var syl = this.syllables(w);
      score += (syl - 1) * 18;                    // 多音节更难

      var len = w.length;
      score += Math.max(0, len - 4) * 6;           // 长词更难

      var freq = d.freq || 0;
      if (freq === 0) {
        score += 26;                              // 通用语料罕见：可能是生僻词或专有词
      } else if (freq <= 3000) {
        score += 0;
      } else if (freq <= 12000) {
        score += 6;
      } else if (freq <= 40000) {
        score += 12;
      } else {
        score += 18;
      }

      var semis = (d.meaning || '').split(';').length - 1;
      if (semis >= 4) score += 6;                 // 一词多义，记忆负担大
      if (semis >= 8) score += 5;

      return score;
    },

    /**
     * 分层：按难度排名分配层位
     *
     * 核心逻辑（松哥定的）：
     *   越初级 → 收进来的词越多（大部分已认识，只剩少数难词）
     *   越高级 → 收进来的词越少
     *
     * 为什么按排名而不是按难度门槛过滤：
     *   门槛是按分数切，同分的词会一起落在同一侧，层内数量不可控。
     *   实测 17 个词用固定门槛切出过 10/3/4、8/4/5 两种非单调结果。
     *   按排名分配则层位完全由顺序决定，单调性天然成立。
     *
     * @param {Array} words  [{word, info}]
     * @param {object} opts  {r0, r1} 各层比例（默认 0.47 / 0.29）
     * @returns {object} {0:[],1:[],2:[]} 每层是按难度升序的词数组
     */
    stratify: function (words, opts) {
      opts = opts || {};
      var scored = words.map(function (w) {
        return {
          word: w.word,
          info: w.info || this.lookup(w.word),
          score: w.score != null ? w.score : this.difficulty(w.word, w.info)
        };
      }, this);

      scored.sort(function (a, b) { return a.score - b.score; });

      var n = scored.length;
      var r0 = opts.r0 != null ? opts.r0 : 0.47;
      var r1 = opts.r1 != null ? opts.r1 : 0.29;
      var n0 = Math.max(1, Math.round(n * r0));
      var n1 = Math.max(1, Math.round(n * r1));
      if (n0 + n1 >= n) { n0 = Math.max(1, n - 2); n1 = 1; }

      var layers = [[], [], []];
      scored.forEach(function (s, i) {
        s.level = i < n0 ? 0 : (i < n0 + n1 ? 1 : 2);
        layers[s.level].push(s);
      });

      this.lastThresholds = {
        t1: n0 ? scored[n0 - 1].score : 0,
        t2: (n0 + n1) ? scored[n0 + n1 - 1].score : 0,
        n0: n0, n1: n1
      };
      return layers;
    },

    lastThresholds: null
  };

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos);
    var hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * 精简释义：只取第一个义项，控制在 12 个字以内。
   *
   * ECDICT 的 translation 是完整词典释义，动辄几十字
   * （如 earth → "n. 地球，泥土，世界，尘世；vt. 埋入土中，掘入洞穴；vi. 躲入洞穴"），
   * 直接用在题目选项和反馈面板里既挤又乱。
   *
   * 英语学习场景只需要「这个词最常用的那个意思」。
   */
  function shortMeaning(raw) {
    if (!raw) return '';
    var s = String(raw).trim();

    // 切出义项：形如 "n. 释义; a. 释义; vt. 释义"
    var items = s.split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!items.length) return s;

    // 优先名词义项（英语学习里最常用），其次动词，最后第一个
    var chosen = '';
    for (var i = 0; i < items.length; i++) {
      if (/^n\.?\s/i.test(items[i])) { chosen = items[i]; break; }
    }
    if (!chosen) {
      for (var j = 0; j < items.length; j++) {
        if (/^v(t)?\.?\s/i.test(items[j])) { chosen = items[j]; break; }
      }
    }
    if (!chosen) chosen = items[0];

    // 去掉词性前缀
    var first = chosen.replace(/^[a-z]+\.?\s*/i, '').trim();
    if (!first) first = chosen;

    // 去掉方括号补充说明
    first = first.replace(/\[[^\]]*\]/g, '').trim();

    // 过长则截断
    if (first.length > 12) {
      var comma = first.indexOf(',');
      if (comma > 0 && comma <= 12) first = first.slice(0, comma);
      else if (first.length > 16) first = first.slice(0, 14) + '…';
    }
    return first;
  }

  /**
   * ASCII 音标 → IPA
   * ECDICT 用的是 ASCII 风格：'bærәn / bi'giniŋ / 'ɒ:riŋ
   * 需要转换为主流 IPA：/bærən/ / /bɪˈɡɪnɪŋ/ / /ɒːrɪŋ/
   */
  var IPA_MAP = {
    'a': 'ɑ', 'b': 'b', 'c': 'k', 'd': 'd', 'e': 'ɛ', 'f': 'f',
    'g': 'ɡ', 'h': 'h', 'i': 'ɪ', 'j': 'dʒ', 'k': 'k', 'l': 'l',
    'm': 'm', 'n': 'n', 'o': 'ɒ', 'p': 'p', 'q': 'k', 'r': 'r',
    's': 's', 't': 't', 'u': 'ʌ', 'v': 'v', 'w': 'w', 'x': 'ks',
    'y': 'j', 'z': 'z'
  };

  function toIPA(raw) {
    if (!raw) return '';
    var s = String(raw).trim().replace(/^[\/'\"]+|[\/'\"]+$/g, '');
    if (!s) return '';

    // 重音符号：ECDICT 用 ' 标主重音
    s = s.replace(/'/g, 'ˈ');

    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      // 已是 IPA 字符的直接保留
      if ('əɑɒɔɛɪʊʌɡθðʃʒŋʒðˈːˌɜɚaeiouæøy'.indexOf(ch) >= 0 && IPA_MAP[ch] === undefined) {
        out += ch;
        continue;
      }
      if (IPA_MAP[ch] !== undefined) {
        out += IPA_MAP[ch];
        continue;
      }
      out += ch;
    }

    // 长音符号
    out = out.replace(/:/g, 'ː');
    // 双元音与常见组合修正
    out = out.replace(/ɪə/g, 'ɪə').replace(/ʊə/g, 'ʊə').replace(/eɪ/g, 'eɪ');
    // 清理重复
    out = out.replace(/ːː/g, 'ː');

    return '/' + out + '/';
  }

  /**
   * 人工校准：ECDICT 缺义项或义项不匹配教学场景的词。
   * 与 scripts/build-course.py 的 MEANING_OVERRIDE 保持一致。
   * 教师端导入新材料时也走这套，保证课程包与内置课程口径一致。
   */
  var MEANING_OVERRIDE = {
    "moving": "移动的, 活动的",
    "heavens": "诸天, 天空",
    "created": "创造了",
    "barren": "荒芜的, 贫瘠的",
    "roaring": "咆哮的, 轰鸣的",
    "beginning": "开始, 起初",
    "darkness": "黑暗",
    "ocean": "海洋, 大海",
    "spirit": "灵, 圣灵",
    "heaven": "天堂, 天",
    "god": "上帝, 神",
    "life": "生命, 生活",
    "form": "形状, 形式",
    "earth": "地球, 大地",
    "water": "水",
    "move": "移动, 运动",
    "create": "创造, 创作"
  };

  function meaningOf(word, raw) {
    var ov = MEANING_OVERRIDE[String(word || '').toLowerCase()];
    return ov || shortMeaning(raw);
  }

  Lexicon.toIPA = toIPA;
  Lexicon.shortMeaning = shortMeaning;
  Lexicon.MEANING_OVERRIDE = MEANING_OVERRIDE;

  global.Lexicon = Lexicon;
})(window);
