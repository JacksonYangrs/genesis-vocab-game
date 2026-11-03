/**
 * 测验引擎 —— 出题、判分、错题归因
 *
 * 四类题目载体：
 *   choice  选择题（英译中 / 中译英 / 听音辨词）
 *   spell   拼写题（看中文写英文）
 *
 * 六种练习模式：
 *   e2c     英译中
 *   c2e     中译英
 *   spell   单词拼写
 *   listen  听音辨词
 *   mixed   混合挑战
 *   （pronunciation 发音训练是独立练习视图，见 app.js）
 *
 * 难度分三档，作用于三件事：选项数量、干扰项相似度、拼写题占比与容错。
 */
(function (global) {
  'use strict';

  var VOCAB = global.VOCAB;

  /* ============ 通用工具 ============ */

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sample(arr, n) {
    return shuffle(arr).slice(0, n);
  }

  /** 编辑距离，用于拼写题容错判断 */
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

  /* ============ 难度配置 ============ */

  var DIFFICULTY = {
    easy: {
      key: 'easy', label: '入门', desc: '4 选 1，干扰项来自其他单词',
      optionCount: 4, closeDistractors: false, spellRatio: 0, spellTolerance: 1
    },
    medium: {
      key: 'medium', label: '进阶', desc: '4 选 1 + 部分拼写题，干扰项为易混词',
      optionCount: 4, closeDistractors: true, spellRatio: 0.34, spellTolerance: 1
    },
    hard: {
      key: 'hard', label: '挑战', desc: '6 选 1 + 大量拼写题，严格匹配',
      optionCount: 6, closeDistractors: true, spellRatio: 0.6, spellTolerance: 0
    }
  };

  var MODES = {
    e2c:  { key: 'e2c',  label: '英译中', icon: '🔤', desc: '看英文，选正确的中文意思' },
    c2e:  { key: 'c2e',  label: '中译英', icon: '🀄', desc: '看中文，选对应的英文单词' },
    spell:{ key: 'spell',label: '单词拼写', icon: '⌨️', desc: '看中文释义，自己拼出英文单词' },
    listen:{key: 'listen',label: '听音辨词', icon: '🎧', desc: '听发音，选出或拼写对应单词' },
    mixed:{ key: 'mixed',label: '混合挑战', icon: '🎲', desc: '随机抽题，综合检验掌握程度' }
  };

  /* ============ 干扰项构造 ============ */

  /**
   * 为某个词构造干扰项列表。
   * closeDistractors = true 时优先使用人工策划的易混词（heaven/heavens 等），
   * 否则从其他单词里随机取 —— 让入门档靠常识排除即可。
   */
  function buildDistractors(word, field, count, closeDistractors, exclude) {
    var pool = [];
    var i;

    if (closeDistractors && word[field] && word[field].length) {
      pool = pool.concat(word[field]);
    }
    // 补足：来自其他单词的释义 / 单词
    VOCAB.forEach(function (w) {
      if (w.id === word.id) return;
      if (field === 'cnDistractors') {
        if (pool.indexOf(w.meaning) === -1) pool.push(w.meaning);
      } else {
        if (pool.indexOf(w.word) === -1) pool.push(w.word);
      }
    });

    pool = pool.filter(function (v) {
      return exclude.indexOf(v) === -1;
    });

    // 易混模式：易混词在前；非易混模式：打散全部
    if (!closeDistractors) pool = shuffle(pool);

    return pool.slice(0, count);
  }

  /* ============ 出题 ============ */

  /**
   * 生成一道题
   * @param {object} word     词条
   * @param {string} mode     模式 key
   * @param {object} diff     难度配置
   * @param {number} index    题号（用于混合模式轮换题型）
   */
  function makeQuestion(word, mode, diff, index) {
    var kind = mode;
    if (mode === 'mixed') {
      // 混合模式按固定节奏轮换题型，保证四种题都出现，且不至于连续同型
      var cycle = ['e2c', 'c2e', 'listen', 'spell'];
      kind = cycle[index % cycle.length];
      if (Math.random() < 0.25) kind = cycle[Math.floor(Math.random() * cycle.length)];
    }

    var q = {
      wordId: word.id,
      word: word.word,
      kind: kind,
      type: 'choice',
      prompt: '',
      audio: null,
      options: [],
      answer: '',
      answerDetail: ''
    };

    if (kind === 'e2c') {
      q.prompt = word.word;
      q.subPrompt = word.phonetic;
      q.answer = word.meaning;
      q.answerDetail = word.meaning;
      var cnDist = buildDistractors(word, 'cnDistractors', diff.optionCount - 1, diff.closeDistractors, [word.meaning]);
      q.options = shuffle([word.meaning].concat(cnDist));
      q.hintText = word.meaning;
    } else if (kind === 'c2e') {
      q.prompt = word.meaning;
      q.subPrompt = word.pos;
      q.answer = word.word;
      q.answerDetail = word.word + ' ' + word.phonetic;
      var enDist = buildDistractors(word, 'enDistractors', diff.optionCount - 1, diff.closeDistractors, [word.word]);
      q.options = shuffle([word.word].concat(enDist));
      q.hintText = word.phonetic;
    } else if (kind === 'listen') {
      q.prompt = '🎧';
      q.subPrompt = '点击喇叭听发音';
      q.audio = word.word;
      q.answer = word.word;
      q.answerDetail = word.word + ' ' + word.phonetic;
      var enDist2 = buildDistractors(word, 'enDistractors', diff.optionCount - 1, diff.closeDistractors, [word.word]);
      q.options = shuffle([word.word].concat(enDist2));
      q.hintText = word.phonetic;
    } else if (kind === 'spell') {
      q.type = 'spell';
      q.prompt = word.meaning;
      q.subPrompt = word.pos;
      q.answer = word.word;
      q.answerDetail = word.word + ' ' + word.phonetic;
      q.hintText = word.phonetic;
    }

    return q;
  }

  /**
   * 组卷
   *
   * 语义原则：拼写只出现在「答案本身是英文单词」的题型上（汉译英 / 听音辨词 / 拼写专项）。
   * 英译中的答案是中文，强行改成拼写会把题目方向翻转、模式名与题面不符，
   * 因此英译中只通过选项数量与干扰项相似度体现难度。
   *
   * @param {string} mode        模式
   * @param {object} diff        难度配置
   * @param {number} count       题目数量
   * @param {array}  pool        候选词池（不传则全量）
   * @param {array}  forceSpell  强制拼写题的词 id 映射（错题复习用）
   */
  function buildPaper(mode, diff, count, pool, forceSpell) {
    var source = (pool && pool.length) ? pool : VOCAB;
    var picked = sample(source, Math.min(count, source.length));

    var questions = picked.map(function (w, i) {
      // 混合模式按固定节奏轮换题型，保证四种题都出现，且不至于连续同型
      var kind = mode;
      if (mode === 'mixed') {
        var cycle = ['e2c', 'c2e', 'listen', 'spell'];
        kind = cycle[i % cycle.length];
        if (Math.random() < 0.25) kind = cycle[Math.floor(Math.random() * cycle.length)];
      }

      var q = makeQuestion(w, kind, diff, i);

      // 决定是否改用拼写作答
      var useSpell = false;
      if (kind === 'spell') {
        useSpell = true;
      } else if (kind === 'c2e' || kind === 'listen') {
        if (forceSpell && forceSpell[w.id]) useSpell = true;
        else if (diff.spellRatio > 0 && Math.random() < diff.spellRatio) useSpell = true;
      }

      if (useSpell && q.type === 'choice') {
        q.originKind = q.kind;
        q.type = 'spell';
        if (q.originKind === 'listen') {
          q.prompt = '🎧 听发音后拼写单词';
          q.subPrompt = '拼出你听到的单词';
        } else {
          q.prompt = w.meaning;
          q.subPrompt = w.pos + ' · 看中文拼英文';
        }
        q.options = [];
        q.answer = w.word;
        q.answerDetail = w.word + ' ' + w.phonetic;
        q.hintText = w.phonetic;
      }

      return q;
    });

    return questions;
  }

  /* ============ 判分 ============ */

  /**
   * 判分
   * @returns {{correct:boolean, nearMiss:boolean, detail:string}}
   */
  function grade(question, response) {
    if (question.type === 'spell') {
      var raw = String(response == null ? '' : response).trim();
      if (!raw) return { correct: false, nearMiss: false, detail: '没有作答' };
      var exact = raw.toLowerCase() === question.answer.toLowerCase();
      if (exact) {
        var caseOnly = raw !== question.answer;
        return {
          correct: true,
          nearMiss: false,
          detail: caseOnly ? '拼写正确（注意大小写）' : '完全正确'
        };
      }
      var dist = levenshtein(raw.toLowerCase(), question.answer.toLowerCase());
      if (dist <= question._tolerance) {
        return {
          correct: true,
          nearMiss: true,
          detail: '接近了：正确拼写是 ' + question.answer + '（你写的是 ' + raw + '，只差 ' + dist + ' 处）'
        };
      }
      return {
        correct: false,
        nearMiss: false,
        detail: '正确拼写是 ' + question.answer + '（你写的是 ' + raw + '）'
      };
    }

    var ok = response === question.answer;
    return {
      correct: ok,
      nearMiss: false,
      detail: ok ? '回答正确' : '正确答案：' + question.answerDetail
    };
  }

  /* ============ 主控制器 ============ */

  var Quiz = {
    DIFFICULTY: DIFFICULTY,
    MODES: MODES,
    current: null,

    /**
     * 开始一次测试
     * @param {string} mode
     * @param {object} opts { count, difficulty, pool, forceSpell }
     */
    start: function (mode, opts) {
      opts = opts || {};
      var diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.medium;
      var count = opts.count || 10;
      var questions = buildPaper(mode, diff, count, opts.pool, opts.forceSpell);

      questions.forEach(function (q) {
        q._tolerance = (diff.spellTolerance === undefined) ? 0 : diff.spellTolerance;
      });

      this.current = {
        mode: mode,
        modeLabel: MODES[mode] ? MODES[mode].label : mode,
        difficulty: diff,
        questions: questions,
        index: 0,
        responses: [],      // { question, response, grade }
        combo: 0,
        bestCombo: 0,
        startedAt: Date.now(),
        finished: false,
        pool: opts.pool || null,
        forceSpell: opts.forceSpell || null
      };
      return this.current;
    },

    /** 当前题 */
    question: function () {
      if (!this.current) return null;
      return this.current.questions[this.current.index];
    },

    /** 提交答案 */
    submit: function (response) {
      var s = this.current;
      if (!s || s.finished) return null;
      var q = this.question();
      var res = grade(q, response);
      s.responses.push({ question: q, response: response, grade: res });

      if (res.correct) {
        s.combo += 1;
        if (s.combo > s.bestCombo) s.bestCombo = s.combo;
      } else {
        s.combo = 0;
      }
      return res;
    },

    /** 下一题；返回 false 表示已结束 */
    next: function () {
      var s = this.current;
      if (!s) return false;
      s.index += 1;
      if (s.index >= s.questions.length) {
        s.finished = true;
        this.finish();
        return false;
      }
      return true;
    },

    /** 结算 */
    finish: function () {
      var s = this.current;
      if (!s) return null;

      var correctCount = 0;
      var nearMissCount = 0;
      var wrongWords = [];
      var perWord = {};

      s.responses.forEach(function (r) {
        var id = r.question.wordId;
        if (!perWord[id]) {
          perWord[id] = {
            wordId: id,
            seen: 0, correct: 0, wrong: 0,
            questions: [],
            lastCorrect: null
          };
        }
        var pw = perWord[id];
        pw.seen += 1;
        pw.questions.push(r);
        if (r.grade.correct) {
          pw.correct += 1;
          correctCount += 1;
          if (r.grade.nearMiss) nearMissCount += 1;
          pw.lastCorrect = true;
        } else {
          pw.wrong += 1;
          pw.lastCorrect = false;
          wrongWords.push(r);
        }
      });

      // 计分：每题 10 分；连击从第 3 题起每题加 2 分，最高加 10 分
      var score = 0;
      var combo = 0;
      s.responses.forEach(function (r) {
        if (r.grade.correct) {
          combo += 1;
          var bonus = combo >= 3 ? Math.min(10, (combo - 2) * 2) : 0;
          score += 10 + bonus;
        } else {
          combo = 0;
        }
      });

      var total = s.responses.length;
      var baseMax = total * 10;

      // 写回每个词的掌握档案
      var store = global.Store;
      Object.keys(perWord).forEach(function (id) {
        var pw = perWord[id];
        pw.questions.forEach(function (r) {
          store.record(id, r.grade.correct);
        });
      });

      var summary = {
        mode: s.mode,
        modeLabel: s.modeLabel,
        difficulty: s.difficulty.label,
        total: total,
        correct: correctCount,
        wrong: total - correctCount,
        nearMiss: nearMissCount,
        score: score,
        baseMax: baseMax,
        accuracy: total ? Math.round(correctCount / total * 100) : 0,
        bestCombo: s.bestCombo,
        duration: Math.round((Date.now() - s.startedAt) / 1000),
        wrongWords: wrongWords,
        perWord: perWord,
        finishedAt: Date.now()
      };

      store.pushHistory({
        mode: s.mode,
        modeLabel: s.modeLabel,
        difficulty: s.difficulty.label,
        total: total,
        correct: correctCount,
        score: score,
        accuracy: summary.accuracy,
        at: summary.finishedAt
      });

      this.summary = summary;
      return summary;
    },

    /**
     * 中途放弃：已作答的词仍计入掌握度（学习已经发生），
     * 但不写入测试历史、不产生成绩单。
     */
    abandon: function () {
      var s = this.current;
      if (!s) return;
      var store = global.Store;
      s.responses.forEach(function (r) {
        store.record(r.question.wordId, r.grade.correct);
      });
      s.finished = true;
    },

    /** 重新开始当前模式 */
    restart: function () {
      var s = this.current;
      if (!s) return null;
      return this.start(s.mode, {
        count: s.questions.length,
        difficulty: s.difficulty.key,
        pool: s.pool,
        forceSpell: s.forceSpell
      });
    },

    shuffle: shuffle,
    levenshtein: levenshtein
  };

  global.Quiz = Quiz;
})(window);
