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
      var override = PHONETIC_OVERRIDE[key];
      return {
        word: key,
        phonetic: override || toIPA(hit.p),
        rawPhonetic: hit.p,
        meaning: BIBLE_TERMS[key] || meaningOf(key, hit.c),
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

    // 切出义项：ECDICT 用半角 ";" 或全角 "；" 分隔
    // （separated 的释义就是全角分号："分居；分开的；不在一起生活的"）
    var items = s.split(/[;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
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

    // 过长则截断（用第一个逗号切，太长则硬截）
    if (first.length > 12) {
      var comma = first.indexOf(',') >= 0 ? first.indexOf(',') : first.indexOf('，');
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
  /**
   * ECDICT 音标 → 标准 IPA
   *
   * 设计原则：**不猜**。
   *
   * ECDICT 的音标是混合体：一部分是准 IPA（ˈdʒɛnəsɪs），
   * 一部分是老式 ASCII 风格（'bi'giniŋ、'da:knis）。
   *
   * 关键难点：老式音标里的 `i` 是 /ɪ/，准 IPA 里的 `i` 是 /i/
   * （happy vowel，如 deuteronomy 的 -mi）。**光看字符无法区分**，
   * 所以不能做「ASCII 元音 → IPA」的猜测映射 ——
   * 那会把 deuteronomy 变成 dʌːtəˈrɑːnəmɪ、separated 变成 sɛpərɛɪtɪd。
   *
   * 所以这里只做**绝对安全的符号规范化**：
   *   ' → ˈ   （主重音）      : → ː  （长度符）
   *   ә → ə   （schwa 另一写法）  g → ɡ  （字形归一）
   *   组合双元音修正（ɛi→eɪ 这类明确的错写）
   *
   * 元音层面的偏差，用 PHONETIC_OVERRIDE 覆盖（见下），不在这里瞎猜。
   */
  var IPA_FIXES = [
    [/:+/g, 'ː'],
    [/'/g, 'ˈ'],
    [/ɡ/g, 'ɡ'],
    [/g/g, 'ɡ'],
    [/ә/g, 'ə'],
    // 明确的错写修正（这些组合在任何音标里都不是合法的英式拼法）
    [/ɛi/g, 'eɪ'],
    [/ɛə/g, 'eə'],
    [/ɑi/g, 'aɪ'],
    [/ɔu/g, 'əʊ'],
    // ECDICT 老式音标里这些 ASCII 组合是确定的错写，安全修正：
    //   ei/ai/ay → eɪ    əu → əʊ    ea/ee → iː
    //   ch→tʃ  sh→ʃ  th→θ  ng→ŋ
    // 不做「裸 i → ɪ」的全局替换 —— 准 IPA 里 i 是 /i/（happy vowel），
    // 如 deuteronomy 的 -mi。只修确定的组合。
    [/ei/g, 'eɪ'],
    [/ai/g, 'eɪ'],
    [/ay/g, 'eɪ'],
    [/əu/g, 'əʊ'],
    [/ee/g, 'iː'],
    [/ea/g, 'iː'],
    [/oo/g, 'uː'],
    [/ou/g, 'aʊ'],
    [/ow/g, 'aʊ'],
    [/oi/g, 'ɔɪ'],
    [/oy/g, 'ɔɪ'],
    [/ch/g, 'tʃ'],
    [/sh/g, 'ʃ'],
    [/th/g, 'θ'],
    [/ng/g, 'ŋ'],
    [/ːː+/g, 'ː'],
    [/['']/g, "'"]
  ];

  function toIPA(raw) {
    if (!raw) return '';
    var s = String(raw).trim().replace(/^\/+|\/+$/g, '').replace(/^'+|'+$/g, '');
    if (!s) return '';

    for (var i = 0; i < IPA_FIXES.length; i++) {
      s = s.replace(IPA_FIXES[i][0], IPA_FIXES[i][1]);
    }

    // 只保留 IPA 合法字符
    // 注意：ɡ（U+0261，IPA 的 g）必须在列表里，
    // 否则上面刚做的 g→ɡ 归一会把它当非法字符删掉
    // （实测 beginning 的音标因此丢了 g 变成 biˈiniŋ）
    s = s.replace(/[^a-zɑɒɔɛɪʊʌæɜəɚʃʒŋθðɡˈˌː().·\-\s]/gi, '');

    return '/' + s.trim() + '/';
  }

  /**
   * 圣经专有名词标准译法表
   *
   * 问题：通用词典给的是「词的一般义项」，但在圣经学习场景里
   *   genesis → "发生, 起源, 创世记"   ← 学生要的是「创世记」
   *   exodus  → "大批的离去"            ← 应为「出埃及记」
   *   numbers → "数"                   ← 应为「民数记」
   *
   * 原因：ECDICT 是通用英汉词典，不区分「圣经书名」这个专名用法。
   * 这里补一份圣经场景的专名标准译法，优先级高于通用义项。
   *
   * 覆盖范围：66 卷书名 + 常见圣经专名（人物、地名、节期、概念）。
   */
  var BIBLE_TERMS = {
    // ---------- 旧约 39 卷 ----------
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

    // ---------- 新约 27 卷 ----------
    "matthew": "马太福音", "mark": "马可福音", "luke": "路加福音",
    "john": "约翰福音", "acts": "使徒行传", "romans": "罗马书",
    "corinthians": "哥林多前书", "galatians": "加拉太书", "ephesians": "以弗所书",
    "philippians": "腓立比书", "colossians": "歌罗西书", "thessalonians": "帖撒罗尼迦前书",
    "timothy": "提摩太前书", "titus": "提多书", "philemon": "腓利门书",
    "hebrews": "希伯来书", "james": "雅各书", "peter": "彼得前书",
    "johns": "约翰一书", "jude": "犹大书", "revelation": "启示录",

    // ---------- 常见圣经专名 ----------
    "adam": "亚当", "eve": "夏娃", "noah": "挪亚", "abraham": "亚伯拉罕",
    "abram": "亚伯兰", "isaac": "以撒", "jacob": "雅各", "israel": "以色列",
    "moses": "摩西", "aaron": "亚伦", "joshua1": "约书亚", "caleb": "迦勒",
    "samson": "参孙", "delilah": "黛莉拉", "david": "大卫", "solomon": "所罗门",
    "elijah": "以利亚", "elisha": "以利沙", "jonah1": "约拿",
    "daniel1": "但以理", "zelbabel": "别西八", "mordecai": "末底改",
    "esther1": "以斯帖", "nehemiah1": "尼希米", "job1": "约伯",
    "moses1": "摩西", "joseph": "约瑟", "pharaoh": "法老",
    "angel": "天使", "angels": "天使", "spirit": "灵", "gospel": "福音",
    "apostle": "使徒", "apostles": "使徒", "church": "教会",
    "christ": "基督", "jesus": "耶稣", "messiah": "弥赛亚",
    "savior": "救主", "lord": "主", "god": "上帝",
    "sin": "罪", "grace": "恩典", "faith": "信心", "hope": "希望",
    "love": "爱", "prayer": "祷告", "prayer1": "祷告",
    "baptism": "洗礼", "communion": "圣餐", "resurrection": "复活",
    "salvation": "救恩", "redemption": "救赎", "covenant": "约",
    "temple": "圣殿", "altar": "祭坛", "sacrifice": "献祭",
    "tabernacle": "会幕", "ark": "约柜", "altar1": "祭坛",
    "covenant1": "约", "prophecy": "预言", "prophets": "先知",
    "psalm1": "诗篇", "hymn": "诗歌", "parable": "比喻",
    "miracle": "神迹", "miracles": "神迹", "disciple": "门徒",
    "disciples": "门徒", "worship": "敬拜", "prayer2": "祷告",
    "fast": "禁食", "holiday": "节期", "festival": "节期",
    "passover": "逾越节", "pentecost": "五旬节", "sabbath": "安息日",
    "sinai": "西奈山", "zion": "锡安", "jerusalem": "耶路撒冷",
    "jericho": "耶利哥", "babylon": "巴比伦", "egypt": "埃及",
    "canaan": "迦南", "gilead": "基列", "jordan": "约旦河",
    "galilee": "加利利", "bethlehem": "伯利恒", "nazareth": "拿撒勒",
    "damascus": "大马士革", "rome": "罗马", "athens": "雅典"
  };

  /**
   * 音标人工校准表
   *
   * 这些是已核对过的标准音标（现代英语词典），
   * 优先于 ECDICT —— ECDICT 的老式写法在这些词上不准确。
   * 与 scripts/build-course.py 的 PHONETIC_OVERRIDE 保持一致。
   */
  var PHONETIC_OVERRIDE = {
    "genesis": "/ˈdʒɛnəsɪs/",
    "exodus": "/ˈɛksədəs/",
    "leviticus": "/ləˈvɪtɪkəs/",
    "numbers": "/ˈnʌmbərz/",
    "deuteronomy": "/ˌduːtəˈrɑːnəmi/",
    "separated": "/ˈsɛpəreɪtɪd/",
    // 创世记课程里已核对的词（ECDICT 的老式音标元音不准）
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
    "god": "/ɡɒd/"
  };

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
    "create": "创造, 创作",
    // 圣经语境的常用词（通用义项在此处不准确或太长）
    "separated": "分开的, 分离的",
    "light": "光, 光亮",
    "darkness": "黑暗",
    "day": "日, 白天",
    "night": "夜, 夜晚",
    "morning": "早晨, 清晨",
    "evening": "傍晚, 夜晚",
    "called": "称为, 呼召",
    "saw": "看见, 察觉",
    "said": "说, 讲",
    "made": "造, 制作",
    "gave": "给, 赐",
    "land": "土地, 陆地",
    "famine": "饥荒",
    "covered": "覆盖, 遮盖",
    "called2": "蒙召"
  };

  function meaningOf(word, raw) {
    var ov = MEANING_OVERRIDE[String(word || '').toLowerCase()];
    return ov || shortMeaning(raw);
  }

  Lexicon.toIPA = toIPA;
  Lexicon.shortMeaning = shortMeaning;
  Lexicon.PHONETIC_OVERRIDE = PHONETIC_OVERRIDE;
  Lexicon.BIBLE_TERMS = BIBLE_TERMS;
  Lexicon.MEANING_OVERRIDE = MEANING_OVERRIDE;

  global.Lexicon = Lexicon;
})(window);
