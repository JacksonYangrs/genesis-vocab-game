/**
 * Fusion —— 融合测试组卷引擎
 *
 * 核心变化（相对 v1）：
 *   1. 一次测试融合所有题型，不再分开选模式
 *   2. 学生自选水平（入门/进阶/挑战）决定抽词范围
 *   3. 新增句子填空、句子排序两种基于材料的题型
 *
 * 分层原则（松哥定的）：
 *   越初级 → 生词表越长（大部分已认识，只剩少数难词）
 *   越高级 → 生词表越短
 *   所以按难度门槛过滤，而非等分切块。
 */
(function (global) {
  'use strict';

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** 编辑距离，用于拼写题容错 */
  function levenshtein(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur.slice();
    }
    return prev[b.length];
  }

  /* ============ 水平配置 ============ */
  /* 水平决定：抽词范围 + 选项数 + 拼写容错 */

  var LEVEL_CONFIG = {
    0: {
      level: 0, label: '入门', desc: '基础词为主，答对率高，适合刚开始',
      optionCount: 4, spellTolerance: 1, spellRatio: 0.15
    },
    1: {
      level: 1, label: '进阶', desc: '中等难度，含部分拼写与听音',
      optionCount: 4, spellTolerance: 1, spellRatio: 0.3
    },
    2: {
      level: 2, label: '挑战', desc: '生僻词，重点攻克，严格判分',
      optionCount: 6, spellTolerance: 0, spellRatio: 0.45
    }
  };

  /* ============ 题型配比 ============ */
  /* 六种题型在一次测试中的占比 */

  var KIND_MIX = [
    { kind: 'e2c',    weight: 25, label: '英译中' },
    { kind: 'c2e',    weight: 20, label: '中译英' },
    { kind: 'spell',  weight: 20, label: '单词拼写' },
    { kind: 'listen', weight: 15, label: '听音辨词' },
    { kind: 'fill',   weight: 10, label: '句子填空' },
    { kind: 'order',  weight: 10, label: '句子排序' }
  ];

  /**
   * 按权重分配题量
   *
   * 关键：句子题（fill/order）的数量受「可用句子素材数」硬约束。
   * 一门课可能只有 6 条句子，若按 20% 硬分配，
   * 挑战层（4 个词 → 8 道题）要 2 道句子题但素材只够 1-2 条，
   * 结果一类句子题恒为 0。
   *
   * 正确做法（顺序很重要）：
   *   1. 先算句子题总配额 = min(权重配额, 素材数)
   *   2. 配额内 fill 与 order 按各自权重比例分配
   *   3. 剩余名额给普通题，按普通题权重分配
   *   4. 最后校验总数恰好等于 total（多退少补，且裁剪时两类句子题各退一半）
   *
   * 早期版本是「先 push 普通题再 push 句子题然后裁剪」，
   * 裁剪时 fill 被优先裁掉，挑战层的填空题恒为 0。
   *
   * @param {number} total 总题数
   * @param {number} sentenceCapacity 可用句子素材数
   */
  function allocateKinds(total, sentenceCapacity) {
    var cap = sentenceCapacity == null ? Infinity : sentenceCapacity;
    var kinds = [];

    var fillM = KIND_MIX.filter(function (x) { return x.kind === 'fill'; })[0];
    var orderM = KIND_MIX.filter(function (x) { return x.kind === 'order'; })[0];
    var sentenceWeight = fillM.weight + orderM.weight;

    // 1) 句子题总配额
    var wantSentence = Math.round(total * sentenceWeight / 100);
    var canSentence = Math.max(0, Math.min(wantSentence, cap));

    // 2) 配额内两类按权重比例分配（先 fill 后 order，差额补给 order）
    var fillN = Math.round(canSentence * fillM.weight / sentenceWeight);
    var orderN = canSentence - fillN;

    // 3) 剩余名额给普通题
    var normalTotal = total - fillN - orderN;
    var normalKinds = KIND_MIX.filter(function (m) {
      return m.kind !== 'fill' && m.kind !== 'order';
    });
    var normalWeight = 0;
    normalKinds.forEach(function (m) { normalWeight += m.weight; });

    var normalCounts = {};
    normalKinds.forEach(function (m) {
      normalCounts[m.kind] = Math.round(normalTotal * m.weight / normalWeight);
    });
    // 补齐普通题的舍入误差
    var normalSum = 0;
    Object.keys(normalCounts).forEach(function (k) { normalSum += normalCounts[k]; });
    var diff = normalTotal - normalSum;
    if (diff !== 0) {
      // 差额补给权重最大的普通题
      var biggest = normalKinds[0].kind;
      normalKinds.forEach(function (m) {
        if (m.weight > (normalKinds.filter(function (x) { return x.kind === biggest; })[0].weight)) biggest = m.kind;
      });
      normalCounts[biggest] += diff;
    }

    // 4) 组装
    Object.keys(normalCounts).forEach(function (k) {
      for (var i = 0; i < normalCounts[k]; i++) kinds.push(k);
    });
    for (var f = 0; f < fillN; f++) kinds.push('fill');
    for (var o = 0; o < orderN; o++) kinds.push('order');

    // 5) 兜底：总数必须精确等于 total
    while (kinds.length > total) {
      // 优先裁句子题，fill/order 各退一半，避免某一类被裁光
      var iFill = kinds.lastIndexOf('fill');
      var iOrder = kinds.lastIndexOf('order');
      if (iFill < 0 && iOrder < 0) { kinds.pop(); continue; }
      if (iFill >= 0 && (iOrder < 0 || kinds.length - 1 - iFill <= kinds.length - 1 - iOrder)) {
        kinds.splice(iFill, 1);
      } else {
        kinds.splice(iOrder, 1);
      }
    }
    while (kinds.length < total) kinds.push('e2c');

    return shuffle(kinds);
  }

  /* ============ 题目构造 ============ */

  /**
   * 单词题（英译中 / 中译英 / 听音 / 拼写）
   */
  function makeWordQuestion(word, kind, cfg, peers) {
    var q = {
      type: 'choice',
      kind: kind,
      wordId: word.id,
      word: word.word,
      prompt: '',
      subPrompt: '',
      options: [],
      answer: '',
      answerDetail: '',
      hintText: '',
      audio: null
    };

    var optionCount = cfg.optionCount;

    if (kind === 'e2c') {
      q.prompt = word.word;
      q.subPrompt = word.phonetic || '';
      q.answer = word.meaning;
      q.answerDetail = word.meaning;
      // 中文干扰项：优先同层词的释义
      var cnPool = (word.cnDistractors || []).slice();
      peers.forEach(function (p) {
        if (p.word !== word.word && cnPool.indexOf(p.meaning) === -1) cnPool.push(p.meaning);
      });
      var cnDist = shuffle(cnPool).slice(0, optionCount - 1);
      q.options = shuffle([word.meaning].concat(cnDist));
      q.hintText = word.meaning;

    } else if (kind === 'c2e') {
      q.prompt = word.meaning;
      q.subPrompt = word.pos ? word.pos + ' · 看中文选英文' : '看中文选英文';
      q.answer = word.word;
      q.answerDetail = word.word + (word.phonetic ? ' ' + word.phonetic : '');
      var enPool = (word.distractors || []).slice();
      peers.forEach(function (p) {
        if (p.word !== word.word && enPool.indexOf(p.word) === -1) enPool.push(p.word);
      });
      var enDist = shuffle(enPool).slice(0, optionCount - 1);
      q.options = shuffle([word.word].concat(enDist));
      q.hintText = word.phonetic || '';

    } else if (kind === 'listen') {
      q.prompt = '🎧';
      q.subPrompt = '点击喇叭听发音，选出你听到的单词';
      q.audio = word.word;
      q.answer = word.word;
      q.answerDetail = word.word + (word.phonetic ? ' ' + word.phonetic : '');
      var lPool = (word.distractors || []).slice();
      peers.forEach(function (p) {
        if (p.word !== word.word && lPool.indexOf(p.word) === -1) lPool.push(p.word);
      });
      var lDist = shuffle(lPool).slice(0, optionCount - 1);
      q.options = shuffle([word.word].concat(lDist));
      q.hintText = word.phonetic || '';

    } else if (kind === 'spell') {
      q.type = 'spell';
      q.prompt = word.meaning;
      q.subPrompt = word.pos ? word.pos + ' · 看中文拼出英文' : '看中文拼出英文';
      q.answer = word.word;
      q.answerDetail = word.word + (word.phonetic ? ' ' + word.phonetic : '');
      q.hintText = word.phonetic || '';
    }

    return q;
  }

  /**
   * 句子填空题：从材料原句挖掉目标词
   *
   * 干扰项来源：目标词自身的易混词 + 全课程同层词的释义/词
   * （不能只用本层词 —— 挑战层只有 4 个词，扣掉目标词只剩 3 个，
   *   凑不满干扰项就会整题作废）
   */
  function makeFillQuestion(sentence, word, peers, allPeers) {
    var text = sentence.text;
    var target = word.word;

    // 挖空：大小写不敏感匹配，替换成 ____
    var idx = text.toLowerCase().indexOf(target.toLowerCase());
    if (idx < 0) return null;

    var blanked = text.slice(0, idx) + '____' + text.slice(idx + target.length);

    // 选项：目标词 + 干扰词
    var pool = (word.distractors || []).slice();
    var candidates = (allPeers && allPeers.length ? allPeers : peers);
    candidates.forEach(function (p) {
      if (p.word !== target && pool.indexOf(p.word) === -1) pool.push(p.word);
    });
    var distractors = shuffle(pool).slice(0, 3);
    if (!distractors.length) return null;

    return {
      type: 'choice',
      kind: 'fill',
      wordId: word.id,
      word: target,
      prompt: blanked,
      subPrompt: '📖 选出填入空格的正确单词',
      options: shuffle([target].concat(distractors)),
      answer: target,
      answerDetail: target + (word.phonetic ? ' ' + word.phonetic : ''),
      hintText: word.meaning,
      sentence: text
    };
  }

  /**
   * 句子排序题：把一句打乱成若干片段，让学生重排
   */
  function makeOrderQuestion(sentence, word) {
    var text = sentence.text;
    var words = text.split(/\s+/).filter(Boolean);
    if (words.length < 4 || words.length > 18) return null;

    // 目标词在句中的位置。
    // 注意：原句里的词可能带标点（"water." / "beginning"），
    // 必须剥掉标点后再比较，否则永远匹配不上。
    var target = String(word.word).toLowerCase();
    var targetIdx = -1;
    for (var i = 0; i < words.length; i++) {
      var clean = words[i].toLowerCase().replace(/[^a-z']/g, '');
      if (clean === target) { targetIdx = i; break; }
    }
    if (targetIdx < 0) return null;

    var chunks = [];
    var chunkCount = Math.min(5, Math.max(3, Math.floor(words.length / 4)));
    var per = Math.ceil(words.length / chunkCount);
    for (var k = 0; k < words.length; k += per) {
      chunks.push(words.slice(k, k + per).join(' '));
    }
    if (chunks.length < 3) return null;

    var scrambled = shuffle(chunks);

    return {
      type: 'order',
      kind: 'order',
      wordId: word.id,
      word: word.word,
      prompt: '把打乱的句子片段按正确顺序排列',
      subPrompt: '点击片段按正确语序排列，点错了可再点取消',
      chunks: scrambled,
      answer: chunks.join(' '),
      answerDetail: text,
      hintText: word.meaning,
      sentence: text
    };
  }

  /* ============ 组卷 ============ */

  /**
   * 组一份融合卷
   *
   * @param {object} opts {
   *   level:     0/1/2 学生自选水平
   *   count:     题量
   *   course:    课程数据
   *   pool:      限定词池（错题复习用）
   *   forceSpell:强制拼写的词 id 映射
   * }
   */
  function buildFusionPaper(opts) {
    var course = opts.course || (global.Course && global.Course.active());
    if (!course) throw new Error('没有可用的课程数据');

    var cfg = LEVEL_CONFIG[opts.level] || LEVEL_CONFIG[1];
    var level = cfg.level;

    // 1) 取该层词池
    var words = course.words.filter(function (w) { return w.level === level; });
    if (opts.pool && opts.pool.length) {
      // 错题复习：限定在指定词内，但仍优先本层
      var poolIds = {};
      opts.pool.forEach(function (w) { poolIds[w.id] = true; });
      var filtered = words.filter(function (w) { return poolIds[w.id]; });
      if (filtered.length) words = filtered;
    }
    if (!words.length) {
      // 本层没词 → 退回全课程词
      words = course.words.slice();
    }

    var peers = words.slice();
    var count = Math.min(opts.count || 15, words.length * 2);
    count = Math.max(count, Math.min(6, words.length));

    // 2) 分配题型（句子题配额受可用句子素材数限制）
    var sentencePool = (global.Course && global.Course.sentencesAtLevel)
      ? global.Course.sentencesAtLevel(level, 200)
      : (course.sentences || []).slice();
    var kinds = allocateKinds(count, sentencePool.length);

    // 3) 逐题构造：单词题用不同目标词，句子题用含该词的句子
    var usedWordIds = {};
    var usedSentences = {};

    function nextWord() {
      var avail = peers.filter(function (w) { return !usedWordIds[w.id]; });
      if (!avail.length) { usedWordIds = {}; avail = peers; }
      var pick = avail[Math.floor(Math.random() * avail.length)];
      usedWordIds[pick.id] = true;
      return pick;
    }

    /** 句子题专用：在全课程词里找一个「有可用句子」的词 */
    function nextWordWithSentence() {
      var all = course.words || [];
      var cands = all.filter(function (w) {
        if (usedWordIds[w.id]) return false;
        return sentencePool.some(function (s) {
          return s.text.toLowerCase().indexOf(w.word.toLowerCase()) >= 0;
        });
      });
      if (!cands.length) return null;
      var pick = cands[Math.floor(Math.random() * cands.length)];
      usedWordIds[pick.id] = true;
      return pick;
    }

    function nextSentence(word) {
      // 只接受「句子确实含该词」的素材。
      // 早前版本有"任意未用句子"的兜底，会把不含目标词的句子配给该词，
      // 导致 makeFillQuestion 的 indexOf 返回 -1、整题作废，
      // 表现是挑战层的 fill 题恒为 0。
      var cands = sentencePool.filter(function (s) {
        if (usedSentences[s.text]) return false;
        return s.text.toLowerCase().indexOf(word.word.toLowerCase()) >= 0;
      });
      if (!cands.length) return null;
      var s = cands[Math.floor(Math.random() * cands.length)];
      usedSentences[s.text] = true;
      return s;
    }

    // 4) 两轮分配
    //
    // 为什么要两轮：句子素材是稀缺资源。
    // 一门课可能只有 6 条可用句子，而 fill+order 按配比要占 20% 的题量。
    // 若顺序分配，排在前面的 fill 会把句子用光，后面的 order 就只能退回普通题
    // —— 实测挑战层（4 个词、8 道题）order 恒为 0。
    //
    // 所以第一轮先把所有句子题造出来（优先消耗句子素材），
    // 第二轮再填普通题，最后按原顺序交织输出。

    var slots = kinds.slice();          // 每格是什么题型
    var byKind = {};
    slots.forEach(function (k, idx) {
      if (!byKind[k]) byKind[k] = [];
      byKind[k].push(idx);
    });
    var built = {};                     // slot index -> question

    // 第一轮：句子题
    // fill 与 order 交替处理，避免 fill 抢光句子素材导致 order 无题可出。
    // 比例按配额数分配：fill 几个就 order 几个，剩余的先给 fill。
    var sentenceSlots = (byKind['fill'] || []).concat(byKind['order'] || []);
    var fillSlots = byKind['fill'] || [];
    var orderSlots = byKind['order'] || [];
    var interleaved = [];
    var fi = 0, oi = 0;
    while (fi < fillSlots.length || oi < orderSlots.length) {
      if (fi < fillSlots.length) interleaved.push({ slot: fillSlots[fi++], kind: 'fill' });
      if (oi < orderSlots.length) interleaved.push({ slot: orderSlots[oi++], kind: 'order' });
    }

    interleaved.forEach(function (item) {
      var kind = item.kind;
      var q = null;
      var tries = 0;
      while (!q && tries < 14) {
        tries++;
        // 在全课程词里找「有可用句子且句中含该词」的词。
        // 不能只在本层找：越高级生词表越短（挑战层可能只有 4 个词），
        // 而句子素材的 target 词往往落在别的层，限定本层就完全抽不到句子题。
        var w = nextWordWithSentence();
        if (!w) break;
        var sent = nextSentence(w);
        if (!sent) continue;
        q = (kind === 'fill') ? makeFillQuestion(sent, w, peers, course.words)
                              : makeOrderQuestion(sent, w);
      }
      built[item.slot] = q;            // 可能为 null，后面兜底
    });

    // 第二轮：普通题
    slots.forEach(function (kind, slotIdx) {
      if (built[slotIdx]) return;
      if (kind === 'fill' || kind === 'order') {
        // 句子素材不够，退回英译中
        var w2 = nextWord();
        built[slotIdx] = makeWordQuestion(w2, 'e2c', cfg, peers);
        return;
      }
      var w3 = nextWord();
      // 按概率把部分题改成拼写（拼写只在答案本身是英文单词的题型上）
      var finalKind = kind;
      if ((kind === 'c2e' || kind === 'listen') && Math.random() < cfg.spellRatio) {
        finalKind = 'spell';
      }
      built[slotIdx] = makeWordQuestion(w3, finalKind, cfg, peers);
    });

    var questions = slots.map(function (kind, idx) {
      var q = built[idx];
      q._tolerance = cfg.spellTolerance;
      q.level = level;
      return q;
    });

    return {
      questions: questions,
      config: cfg,
      level: level
    };
  }

  /* ============ 判分 ============ */

  function grade(question, response) {
    if (question.type === 'spell') {
      var raw = String(response == null ? '' : response).trim();
      if (!raw) return { correct: false, nearMiss: false, detail: '没有作答' };
      var exact = raw.toLowerCase() === question.answer.toLowerCase();
      if (exact) {
        return {
          correct: true, nearMiss: false,
          detail: raw !== question.answer ? '拼写正确（注意大小写）' : '完全正确'
        };
      }
      var dist = levenshtein(raw.toLowerCase(), question.answer.toLowerCase());
      if (dist <= (question._tolerance || 0)) {
        return {
          correct: true, nearMiss: true,
          detail: '接近了：正确拼写是 ' + question.answer + '（你写的是 ' + raw + '，只差 ' + dist + ' 处）'
        };
      }
      return {
        correct: false, nearMiss: false,
        detail: '正确拼写是 ' + question.answer + '（你写的是 ' + raw + '）'
      };
    }

    if (question.type === 'order') {
      var got = Array.isArray(response) ? response.join(' ') : String(response || '');
      var ok = got.trim() === String(question.answer).trim();
      return {
        correct: ok, nearMiss: false,
        detail: ok ? '语序正确' : '正确顺序：' + question.answerDetail
      };
    }

    var ok2 = response === question.answer;
    return {
      correct: ok2, nearMiss: false,
      detail: ok2 ? '回答正确' : '正确答案：' + question.answerDetail
    };
  }

  /* ============ 对外接口 ============ */

  var Fusion = {
    LEVEL_CONFIG: LEVEL_CONFIG,
    KIND_MIX: KIND_MIX,
    buildPaper: buildFusionPaper,
    grade: grade,
    allocateKinds: allocateKinds,
    levenshtein: levenshtein,
    shuffle: shuffle,

    /** 题型中文名 */
    kindLabel: function (kind) {
      var m = KIND_MIX.filter(function (x) { return x.kind === kind; })[0];
      return m ? m.label : kind;
    }
  };

  global.Fusion = Fusion;
})(window);
