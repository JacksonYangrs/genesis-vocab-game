/**
 * 进度存储 —— 掌握度追踪 + 错题本 + 学习历史
 * 使用 localStorage，数据结构带版本号，便于以后升级。
 *
 * 注意：进度保存在「本机浏览器」里。换设备或清缓存会丢失，
 * 因此提供「导出 / 导入进度」功能，方便组内成员互传。
 */
(function (global) {
  'use strict';

  var KEY = 'genesis-vocab-progress-v1';

  /** 五级掌握度标尺 */
  var LEVELS = {
    new:      { label: '未练习', color: '#94a3b8', desc: '还没练过这个词' },
    weak:     { label: '生疏',   color: '#e5484d', desc: '最近答错了，需要重点回炉' },
    learning: { label: '巩固中', color: '#f5a524', desc: '记住了，但还不够牢' },
    strong:   { label: '熟悉',   color: '#3b82f6', desc: '掌握得不错，继续保持' },
    mastered: { label: '已掌握', color: '#12a594', desc: '已经很稳，可以放心' }
  };

  var LEVEL_ORDER = ['new', 'weak', 'learning', 'strong', 'mastered'];

  function defaultState() {
    return {
      version: 2,
      words: {},          // id -> { seen, correct, wrong, streak, bestStreak, lastCorrect, pronOk, pronTotal }
      settings: {
        level: 1,                // 学生自选水平：0 入门 1 进阶 2 挑战
        count: 10,              // 每次抽题数量
        voice: 'default'        // 朗读音色偏好
      },
      identity: {
        name: '',                // 学生昵称（无需密码）
        joinedAt: 0
      },
      history: [],        // 每次测试的记录（最多保留 50 条）
      createdAt: Date.now()
    };
  }

  var Store = {
    LEVELS: LEVELS,
    LEVEL_ORDER: LEVEL_ORDER,
    state: defaultState(),

    /** 读取本地进度（带容错，坏数据不阻塞游戏） */
    load: function () {
      try {
        var raw = global.localStorage.getItem(KEY);
        if (!raw) { this.state = defaultState(); return this.state; }
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('bad shape');
        var base = defaultState();
        // 逐字段合并，防止旧版本缺字段导致崩溃
        this.state = {
          version: parsed.version || 1,
          words: (parsed.words && typeof parsed.words === 'object') ? parsed.words : base.words,
          settings: Object.assign({}, base.settings, parsed.settings || {}),
          identity: Object.assign({}, base.identity, parsed.identity || {}),
          history: Array.isArray(parsed.history) ? parsed.history.slice(-50) : [],
          createdAt: parsed.createdAt || Date.now()
        };
      } catch (e) {
        this.state = defaultState();
      }
      return this.state;
    },

    save: function () {
      try {
        global.localStorage.setItem(KEY, JSON.stringify(this.state));
        return true;
      } catch (e) {
        return false;
      }
    },

    /** 取（并初始化）某个词的成绩档案 */
    recordOf: function (wordId) {
      if (!this.state.words[wordId]) {
        this.state.words[wordId] = {
          seen: 0, correct: 0, wrong: 0,
          streak: 0, bestStreak: 0, lastCorrect: null,
          pronOk: 0, pronTotal: 0
        };
      }
      var r = this.state.words[wordId];
      // 兼容早期版本缺失字段
      if (typeof r.seen !== 'number') r.seen = 0;
      if (typeof r.correct !== 'number') r.correct = 0;
      if (typeof r.wrong !== 'number') r.wrong = 0;
      if (typeof r.streak !== 'number') r.streak = 0;
      if (typeof r.bestStreak !== 'number') r.bestStreak = r.streak;
      if (typeof r.pronOk !== 'number') r.pronOk = 0;
      if (typeof r.pronTotal !== 'number') r.pronTotal = 0;
      return r;
    },

    /** 记一次答题结果 */
    record: function (wordId, isCorrect) {
      var r = this.recordOf(wordId);
      r.seen += 1;
      if (isCorrect) {
        r.correct += 1;
        r.streak += 1;
        if (r.streak > r.bestStreak) r.bestStreak = r.streak;
      } else {
        r.wrong += 1;
        r.streak = 0;
      }
      r.lastCorrect = !!isCorrect;
      this.save();
      return r;
    },

    /** 记一次跟读自评 */
    recordPronounce: function (wordId, ok) {
      var r = this.recordOf(wordId);
      r.pronTotal += 1;
      if (ok) r.pronOk += 1;
      this.save();
      return r;
    },

    /** 判定掌握等级 */
    levelOf: function (wordId) {
      var r = this.state.words[wordId];
      if (!r || !r.seen) return 'new';
      var acc = r.correct / r.seen;
      if (r.streak === 0) return 'weak';                       // 最近一次答错
      if (r.seen >= 3 && acc >= 0.85 && r.bestStreak >= 3) return 'mastered';
      if (acc >= 0.75) return 'strong';
      return 'learning';
    },

    /** 某词正确率 */
    accuracyOf: function (wordId) {
      var r = this.state.words[wordId];
      if (!r || !r.seen) return 0;
      return r.correct / r.seen;
    },

    /** 统计各等级词数 */
    levelCounts: function (vocab) {
      var counts = { new: 0, weak: 0, learning: 0, strong: 0, mastered: 0 };
      vocab.forEach(function (w) { counts[Store.levelOf(w.id)] += 1; });
      return counts;
    },

    /** 错题本：所有「最近一次答错」或「正确率低于 50%」的词 */
    wrongList: function (vocab) {
      return vocab.filter(function (w) {
        var r = Store.state.words[w.id];
        if (!r || !r.seen) return false;
        if (r.streak === 0) return true;
        return (r.correct / r.seen) < 0.5;
      });
    },

    /** 记录一次测试历史 */
    pushHistory: function (entry) {
      this.state.history.push(entry);
      if (this.state.history.length > 50) this.state.history = this.state.history.slice(-50);
      this.save();
    },

    /** 设置项读写 */
    getSettings: function () { return this.state.settings; },
    setSetting: function (k, v) { this.state.settings[k] = v; this.save(); },

    /* ============ 身份（昵称即可，无需密码） ============ */

    /** 取学生昵称 */
    identity: function () {
      return this.state.identity || { name: '', joinedAt: 0 };
    },

    /** 设置昵称 */
    setName: function (name) {
      var n = String(name || '').trim().slice(0, 24);
      this.state.identity = this.state.identity || { name: '', joinedAt: 0 };
      this.state.identity.name = n;
      if (!this.state.identity.joinedAt) this.state.identity.joinedAt = Date.now();
      this.save();
      return n;
    },

    /** 是否已设置昵称 */
    hasIdentity: function () {
      return !!(this.state.identity && this.state.identity.name);
    },

    /* ============ 阶段报告分析 ============ */

    /**
     * 生成个人阶段报告
     * @param {Array} vocab 当前课程的词表
     * @returns {object} 报告数据
     */
    buildReport: function (vocab) {
      var self = this;
      var words = vocab || [];
      var hist = this.state.history || [];

      // ---- 1. 成绩趋势 ----
      var trend = hist.map(function (h) {
        return {
          at: h.at,
          accuracy: h.accuracy,
          score: h.score,
          total: h.total,
          correct: h.correct,
          mode: h.modeLabel || h.mode
        };
      });

      // 最近 3 次 vs 更早 —— 判断进步/退步
      var recent = trend.slice(-3);
      var earlier = trend.slice(0, Math.max(0, trend.length - 3));
      var avg = function (arr) {
        if (!arr.length) return null;
        return Math.round(arr.reduce(function (s, t) { return s + t.accuracy; }, 0) / arr.length);
      };
      var recentAvg = avg(recent);
      var earlierAvg = avg(earlier);
      var delta = (recentAvg != null && earlierAvg != null) ? (recentAvg - earlierAvg) : null;

      // ---- 2. 掌握度分布 ----
      var counts = this.levelCounts(words);

      // ---- 3. 弱项：反复答错的词 ----
      var weak = words.map(function (w) {
        var r = self.state.words[w.id];
        if (!r || !r.seen) return null;
        return {
          word: w.word,
          phonetic: w.phonetic || '',
          meaning: w.meaning || '',
          level: w.level,
          seen: r.seen,
          correct: r.correct,
          wrong: r.wrong,
          accuracy: r.correct / r.seen,
          lastCorrect: r.lastCorrect
        };
      }).filter(Boolean).filter(function (x) {
        // 薄弱标准：答错至少 2 次，或正确率低于 60%
        return x.wrong >= 2 || (x.seen >= 2 && x.accuracy < 0.6);
      }).sort(function (a, b) {
        if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
        return b.wrong - a.wrong;
      });

      // ---- 4. 建议加练：完全没练过 + 练过但没掌握的 ----
      var untouched = [];
      var notMastered = [];
      words.forEach(function (w) {
        var r = self.state.words[w.id];
        var lvl = self.levelOf(w.id);
        if (!r || !r.seen) {
          untouched.push({ word: w.word, meaning: w.meaning || '', level: w.level });
        } else if (lvl !== 'mastered') {
          notMastered.push({ word: w.word, meaning: w.meaning || '', level: w.level, accuracy: self.accuracyOf(w.id) });
        }
      });
      notMastered.sort(function (a, b) { return a.accuracy - b.accuracy; });

      // ---- 5. 跟读统计 ----
      var pronTotal = 0, pronOk = 0;
      Object.keys(this.state.words).forEach(function (id) {
        var r = self.state.words[id];
        pronTotal += r.pronTotal || 0;
        pronOk += r.pronOk || 0;
      });

      // ---- 6. 综合评价 ----
      var overallAcc = trend.length
        ? Math.round(trend.reduce(function (s, t) { return s + t.accuracy; }, 0) / trend.length)
        : 0;

      var comment;
      if (!trend.length) {
        comment = '还没有测试记录。做完第一次测试后，这里会显示你的学习分析。';
      } else if (overallAcc >= 90) {
        comment = '掌握得非常扎实！继续保持这个节奏，可以尝试挑战更高水平。';
      } else if (overallAcc >= 75) {
        comment = '整体不错，个别词还需要巩固。建议重点复习下面列出的弱项。';
      } else if (overallAcc >= 55) {
        comment = '基础已经打起来了，但错的词比较集中。建议先集中攻弱项，再做新一轮测试。';
      } else {
        comment = '正确率还不稳，建议放慢速度、把每个词的音标和释义读一遍再作答。';
      }

      var suggestion;
      if (delta == null) suggestion = '再积累几次记录，就能看出你的进步曲线。';
      else if (delta >= 8) suggestion = '最近比之前进步了 ' + delta + ' 个百分点，方向对，保持。';
      else if (delta > -8) suggestion = '成绩比较平稳，' + (delta > 0 ? '略有进步' : '基本持平') + '。';
      else suggestion = '最近比之前下滑了 ' + Math.abs(delta) + ' 个百分点，先回到错题本把弱项过一遍。';

      return {
        name: this.identity().name,
        generatedAt: Date.now(),
        courseId: (window.Course && window.Course.activeId) || '',
        courseTitle: (window.Course && window.Course.activeMeta() ? window.Course.activeMeta().title : ''),
        totalTests: trend.length,
        overallAccuracy: overallAcc,
        recentAvg: recentAvg,
        earlierAvg: earlierAvg,
        delta: delta,
        trend: trend,
        mastery: counts,
        weak: weak,
        untouched: untouched,
        notMastered: notMastered,
        pronunciation: { total: pronTotal, ok: pronOk },
        comment: comment,
        suggestion: suggestion
      };
    },

    /** 导出学习档案（带身份标识，供老师汇总） */
    exportProfile: function () {
      var vocab = (window.Course && window.Course.active())
        ? window.Course.active().words
        : (window.VOCAB || []);
      var report = this.buildReport(vocab);
      return JSON.stringify({
        app: 'genesis-vocab',
        kind: 'student-profile',
        exportedAt: new Date().toISOString(),
        identity: this.identity(),
        report: report,
        words: this.state.words,
        history: this.state.history
      }, null, 2);
    },

    /** 清空全部进度（需二次确认，UI 层负责） */
    reset: function () {
      this.state = defaultState();
      this.save();
    },

    /** 导出为 JSON 字符串 */
    exportJSON: function () {
      return JSON.stringify({
        app: 'genesis-vocab',
        exportedAt: new Date().toISOString(),
        state: this.state
      }, null, 2);
    },

    /** 从导入数据恢复（校验必需字段） */
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      var incoming = parsed && parsed.state ? parsed.state : parsed;
      if (!incoming || typeof incoming !== 'object' || typeof incoming.words !== 'object') {
        throw new Error('文件格式不对，请选择本游戏导出的进度文件');
      }
      var base = defaultState();
      this.state = {
        version: incoming.version || 1,
        words: incoming.words || {},
        settings: Object.assign({}, base.settings, incoming.settings || {}),
        history: Array.isArray(incoming.history) ? incoming.history.slice(-50) : [],
        createdAt: incoming.createdAt || Date.now()
      };
      this.save();
      return true;
    }
  };

  global.Store = Store;
})(window);
