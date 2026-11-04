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
      // 先记住本地课程，loadLibrary 会重建数组
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
          self.library = kept.concat(remote);
          self.activeId = self.library.length ? self.library[0].id : null;

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

    /** 保存老师生成的课程包到本地（老师本地预览用） */
    saveLocal: function (data) {
      var meta = {
        id: data.id,
        title: data.title,
        subtitle: data.subtitle || '',
        reference: data.reference || '',
        quote: data.quote || '',
        wordCount: data.words.length,
        levelCounts: countLevels(data.words),
        file: 'local-' + data.id + '.json',
        _loaded: true,
        _data: data,
        _local: true
      };
      // 替换同 id 的
      var i = this.library.findIndex(function (c) { return c.id === data.id; });
      if (i >= 0) this.library[i] = meta;
      else this.library.unshift(meta);
      this.activeId = data.id;
      return meta;
    },

    /** 导出为可下载的 JSON 文本 */
    exportJson: function (data) {
      return JSON.stringify(data, null, 2);
    },

    /**
     * 导入课程包（老师加载自己保存的 JSON）
     */
    importJson: function (text) {
      var data = JSON.parse(text);
      if (!data.words || !Array.isArray(data.words)) {
        throw new Error('不是有效的课程包：缺少 words 字段');
      }
      if (!data.id) data.id = 'imported-' + Date.now();
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
