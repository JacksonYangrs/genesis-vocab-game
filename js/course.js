/**
 * Course —— 课程包格式与课程库
 *
 * 课程包是教师端生成的产物，也是学生端唯一的输入。
 * 体积小（2.7 KB/课），纯 JSON，可直接放仓库 courses/ 目录。
 *
 * 格式：
 * {
 *   id: "genesis-1-1-2",
 *   title: "创世记 1:1-2",
 *   subtitle: "CEV · Genesis 1:1-2",
 *   quote: "In the beginning God created...",   // 经文引言（首页展示）
 *   reference: "Genesis 1:1-2 (CEV)",
 *   createdAt: 1690000000000,
 *   thresholds: { t1: 26, t2: 45 },
 *   words: [
 *     {
 *       id: "w_beginning",
 *       word: "beginning",
 *       phonetic: "/bɪˈɡɪnɪŋ/",
 *       meaning: "n. 开始，起初",
 *       pos: "n",
 *       level: 0,                       // 0 入门 1 进阶 2 挑战
 *       score: 66,                     // 难度分
 *       distractors: ["beginnings", ...],  // 英文干扰项
 *       cnDistractors: ["…"],             // 中文干扰项
 *       example: "In the beginning God created the heavens and the earth.",
 *       syllables: ["be-gin-ning"]
 *     }
 *   ],
 *   sentences: [                       // 供句子题使用
 *     { text: "...", target: "beginning", level: 0 }
 *   ]
 * }
 */
(function (global) {
  'use strict';

  // 本地导入的课程包 / 当前选中课程都存 localStorage。
  // 只存课程包本体（体积约 2-8 KB/课），不存 library 数组，避免与远端清单打架。
  var LOCAL_KEY = 'gv_local_courses_v1';
  var ACTIVE_KEY = 'gv_active_course_v1';
  // 已删除课程 id 清单。内置课每次启动都会从 courses/index.json 读回来，
  // 不记这个清单的话删了刷新就复活。
  var DELETED_KEY = 'gv_deleted_courses_v1';

  function readLocalStore() {
    try {
      var raw = global.localStorage.getItem(LOCAL_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) { return {}; }
  }

  function writeLocalStore(map) {
    try { global.localStorage.setItem(LOCAL_KEY, JSON.stringify(map)); return true; }
    catch (e) { return false; }
  }

  function readActive() {
    try { return global.localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) { return ''; }
  }

  function writeActive(id) {
    try { global.localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* 忽略 */ }
  }

  function readDeleted() {
    try {
      var raw = global.localStorage.getItem(DELETED_KEY);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch (e) { return {}; }
  }

  function writeDeleted(map) {
    try { global.localStorage.setItem(DELETED_KEY, JSON.stringify(map)); return true; }
    catch (e) { return false; }
  }

  /** 课程包 → 课程库 meta（本地包数据已在内存，不需要 fetch） */
  function localMeta(data) {
    return {
      id: data.id,
      title: data.title || data.id,
      subtitle: data.subtitle || '',
      reference: data.reference || '',
      quote: data.quote || '',
      quoteEn: data.quoteEn || '',
      wordCount: data.words.length,
      levelCounts: countLevels(data.words),
      file: 'local-' + data.id + '.json',
      _loaded: true,
      _data: data,
      _local: true
    };
  }

  var LEVELS = [
    { key: 0, label: '入门', desc: '基础词，多已认识' },
    { key: 1, label: '进阶', desc: '中等难度' },
    { key: 2, label: '挑战', desc: '生僻词，重点攻' }
  ];

  var Course = {
    LEVELS: LEVELS,
    library: [],          // 已加载的课程包
    activeId: null,

    /**
     * 加载课程库（从 courses/index.json 读清单，再按需加载各课程）
     *
     * 注意：本地已保存的课程（如教师模式生成的）必须保留，
     * 不能被远端清单覆盖掉。同时加载完清单后要立刻把首个课程的数据拉下来，
     * 否则 active() 返回 null，首页会退回内置词表。
     */
    loadLibrary: function () {
      var self = this;
      var deleted = readDeleted();
      // 先把已删除的从内存里清掉 —— init() 每次都会重新注入内置兜底课程，
      // 不先清的话被删的课会在首屏闪一下，fetch 失败时更会一直留着。
      this.library = this.library.filter(function (c) { return !deleted[c.id]; });

      // 再把上一次导入、已写进 localStorage 的课程恢复回来；
      // 没这一步，刷新后 init() 只重建内置课程，用户导入的课就"消失"了。
      var stored = readLocalStore();
      Object.keys(stored).forEach(function (id) {
        var d = stored[id];
        if (!d || !d.words || !Array.isArray(d.words)) return;
        if (deleted[id]) return;
        if (self.library.some(function (c) { return c.id === d.id; })) return;
        self.library.unshift(localMeta(d));
      });

      // 再记住本地课程，loadLibrary 会重建数组
      var localCourses = this.library.filter(function (c) { return c._local; });

      return fetch('courses/index.json')
        .then(function (res) {
          if (!res.ok) throw new Error('课程清单加载失败');
          return res.json();
        })
        .then(function (list) {
          var remote = list.map(function (meta) {
            return {
              id: meta.id,
              title: meta.title,
              subtitle: meta.subtitle || '',
              reference: meta.reference || '',
              quote: meta.quote || '',
              quoteEn: meta.quoteEn || '',
              wordCount: meta.wordCount || 0,
              levelCounts: meta.levelCounts || { 0: 0, 1: 0, 2: 0 },
              file: meta.file,
              _loaded: false,
              _data: null
            };
          });

          // 本地课程排前面（教师刚生成的应该优先选）
          var ids = {};
          remote.forEach(function (c) { ids[c.id] = true; });
          var kept = localCourses.filter(function (c) { return !ids[c.id]; });
          // 远端清单里的内置课也会被带回来，统一按删除清单过滤，刷新不复活
          self.library = kept.concat(remote).filter(function (c) { return !deleted[c.id]; });
          // 刷新后仍高亮用户上次选的那门课；没记录过才退回清单第一门
          var saved = readActive();
          self.activeId = (saved && self.library.some(function (c) { return c.id === saved; }))
            ? saved
            : (self.library.length ? self.library[0].id : null);

          // 立刻加载首个课程的完整数据
          if (!self.activeId) return self.library;
          return self.loadCourse(self.activeId).then(function () {
            return self.library;
          });
        });
    },

    /** 按 id 加载完整课程数据 */
    loadCourse: function (id) {
      var meta = this.library.filter(function (c) { return c.id === id; })[0];
      if (!meta) return Promise.reject(new Error('课程不存在: ' + id));
      if (meta._loaded) return Promise.resolve(meta._data);

      return fetch('courses/' + meta.file)
        .then(function (res) {
          if (!res.ok) throw new Error('课程加载失败: ' + meta.file);
          return res.json();
        })
        .then(function (data) {
          meta._loaded = true;
          meta._data = data;
          meta.wordCount = data.words.length;
          meta.levelCounts = countLevels(data.words);
          meta.quote = data.quote || '';
          meta.quoteEn = data.quoteEn || '';
          meta.reference = data.reference || '';
          return data;
        });
    },

    /** 当前激活课程的数据 */
    active: function () {
      var meta = this.library.filter(function (c) { return c.id === this.activeId; }, this)[0];
      return meta ? meta._data : null;
    },

    activeMeta: function () {
      var self = this;
      return this.library.filter(function (c) { return c.id === self.activeId; })[0] || null;
    },

    /**
     * 取某一层的词
     * @param {number} level  0 入门 1 进阶 2 挑战
     */
    wordsAtLevel: function (level) {
      var course = this.active();
      if (!course) return [];
      return course.words.filter(function (w) { return w.level === level; });
    },

    /**
     * 取句子素材
     *
     * 关键设计：句子题不按层严格限制。
     * 原因是句子素材的总量远小于生词量 —— 一门课可能只有几条可用句子，
     * 若按层严格取，低层（入门）层会抽不到句子，句子题被迫退回普通题，
     * 题型配比就失效了。
     *
     * 策略：优先取本层的句子，不够时用其他层的补足。
     *
     * @param {number} level
     * @param {number} limit
     */
    sentencesAtLevel: function (level, limit) {
      var course = this.active();
      if (!course || !course.sentences.length) return [];
      var same = course.sentences.filter(function (s) { return s.level === level; });
      var others = course.sentences.filter(function (s) { return s.level !== level; });
      var list = same.concat(others);
      return limit ? list.slice(0, limit) : list;
    },

    /** 把课程放进内存课程库（首屏内置兜底也走这里，不落盘） */
    saveLocal: function (data) {
      var meta = localMeta(data);
      // 替换同 id 的
      var i = this.library.findIndex(function (c) { return c.id === data.id; });
      if (i >= 0) this.library[i] = meta;
      else this.library.unshift(meta);
      this.activeId = data.id;
      return meta;
    },

    /**
     * 导入课程包（教师模式生成课程时调用）
     * 与 saveLocal 的区别：写进 localStorage，刷新后课程和选中状态都还在。
     * 返回 { meta, persisted }；persisted=false 表示浏览器不给存，本次可用但刷新会丢。
     */
    importCourse: function (data) {
      var meta = this.saveLocal(data);
      var map = readLocalStore();
      map[data.id] = data;
      var persisted = writeLocalStore(map);
      // 重新导入同 id 的课程要撤销删除标记，否则刷新后又被 loadLibrary 过滤掉
      var deleted = readDeleted();
      if (deleted[data.id]) { delete deleted[data.id]; writeDeleted(deleted); }
      if (persisted) writeActive(data.id);
      return { meta: meta, persisted: persisted };
    },

    /**
     * 删除课程（内置课与教师导入课都能删）
     * 三件事一起做：从内存课程库移除、从本地课程包里移除、记进删除清单，
     * 这样内置课刷新后不会从 courses/index.json 复活。
     * 学习进度不在这里动 —— Store 的历史按 courseId 留档，重新导入同名课程后还在。
     * 返回 { persisted, activeId }。
     */
    deleteCourse: function (id) {
      this.library = this.library.filter(function (c) { return c.id !== id; });

      var map = readLocalStore();
      delete map[id];
      writeLocalStore(map);

      var deleted = readDeleted();
      deleted[id] = Date.now();
      var persisted = writeDeleted(deleted);

      // 删的是当前课 → 自动切到剩下第一门，避免 activeId 指向不存在的课程
      if (this.activeId === id) {
        this.setActive(this.library.length ? this.library[0].id : '');
      }
      return { persisted: persisted, activeId: this.activeId };
    },

    /** 记住当前选中的课程，刷新后仍高亮同一门 */
    setActive: function (id) {
      this.activeId = id;
      writeActive(id);
    },

    /** 导出为可下载的 JSON 文本 */
    exportJson: function (data) {
      return JSON.stringify(data, null, 2);
    },

    /**
     * 导入课程包（解析老师保存的 JSON 文本）
     */
    importJson: function (text) {
      var data = JSON.parse(text);
      if (!data.words || !Array.isArray(data.words)) {
        throw new Error('不是有效的课程包：缺少 words 字段');
      }
      if (!data.id) data.id = 'imported-' + Date.now();
      if (!data.title) data.title = '导入的课程';
      // 第三方课程包可能没带句子素材，sentencesAtLevel 会直接读 .length
      if (!Array.isArray(data.sentences)) data.sentences = [];
      return data;
    }
  };

  function countLevels(words) {
    var c = { 0: 0, 1: 0, 2: 0 };
    words.forEach(function (w) { c[w.level] = (c[w.level] || 0) + 1; });
    return c;
  }

  Course.countLevels = countLevels;
  global.Course = Course;
})(window);
