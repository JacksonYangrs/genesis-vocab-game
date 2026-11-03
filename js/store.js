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
      version: 1,
      words: {},          // id -> { seen, correct, wrong, streak, bestStreak, lastCorrect, pronOk, pronTotal }
      settings: {
        difficulty: 'medium',   // easy | medium | hard
        count: 10,              // 每次抽题数量
        voice: 'default'        // 朗读音色偏好
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
