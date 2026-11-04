/**
 * Teacher —— 教师模式：导入材料 → 生成词表 → 导出课程包
 *
 * 流程：
 *   1. 导入（PDF 或粘贴文本）→ pdf.js 解析 → 抽词 + 抽句
 *   2. 查词典（音标/释义）→ 分层 → 组干扰项 → 预览校对
 *   3. 导出课程包 JSON
 */
(function (global) {
  'use strict';

  var Teacher = {
    step: 1,
    parsed: null,       // {text, sentences, candidates}
    layers: null,       // [[],[],[]] 分层后的词
    sentences: null,    // 带 level 的句子
    packageData: null,  // 最终课程包
    _selected: {},      // 词 id → 是否保留

    /** 重置到步骤 1 */
    reset: function () {
      this.step = 1;
      this.parsed = null;
      this.layers = null;
      this.sentences = null;
      this.packageData = null;
      this._selected = {};
    },

    /**
     * 步骤 1：解析材料
     * @param {File} file  PDF 文件（可选）
     * @param {string} text 直接粘贴的文本（可选）
     * @param {function} onStatus  状态回调
     */
    parse: function (file, text, onStatus) {
      var self = this;
      var status = function (msg) { if (onStatus) onStatus(msg); };

      var parsePromise;
      if (file) {
        status('正在解析 PDF…');
        parsePromise = global.Importer.parsePdf(file);
      } else {
        status('正在分析文本…');
        parsePromise = Promise.resolve(global.Importer.parseText(text || ''));
      }

      return parsePromise.then(function (result) {
        if (!result.text || result.text.trim().length < 30) {
          throw new Error('没有从材料里读到文字。若是扫描件（图片型 PDF），请改用文本粘贴方式。');
        }
        status('正在提取生词…');
        var candidates = global.Importer.extractCandidates(result.text, result.sentences);
        if (!candidates.length) {
          throw new Error('没有提取到候选生词，请检查材料内容。');
        }
        self.parsed = {
          text: result.text,
          sentences: result.sentences,
          candidates: candidates,
          pageCount: result.pageCount
        };

        // 按需加载词典分片：只拉候选词涉及的首字母，不加载全量。
        // 实测全量 1.9MB 在慢网络下要 30-90 秒，分片后通常 0.6-1MB。
        var words = candidates.map(function (c) { return c.word; });
        var letters = {};
        words.forEach(function (w) {
          var c = String(w).toLowerCase().charAt(0);
          if (c >= 'a' && c <= 'z') letters[c] = true;
        });
        var n = Object.keys(letters).length;
        status('正在加载词典（' + n + ' 个分片）…');

        return global.Lexicon.loadShards(words, function (done, total) {
          status('词典加载中 ' + done + '/' + total + '…');
        });
      }).then(function () {
        status('正在查词并分层…');
        self.buildLayers();
        return self.parsed;
      });
    },

    /**
     * 步骤 2：查词典 + 分层 + 组干扰项
     */
    buildLayers: function () {
      var self = this;
      var cands = this.parsed.candidates;

      // 查词典：只保留词典里有的词
      var looked = [];
      var missing = [];
      cands.forEach(function (c) {
        var info = global.Lexicon.lookup(c.word);
        if (info) {
          looked.push({ word: c.word, info: info, sentences: c.sentences });
        } else {
          missing.push(c.word);
        }
      });

      if (!looked.length) {
        throw new Error('提取到的词在词典里都查不到，请检查材料是否为英文。');
      }

      // 分层（门槛过滤式：越初级词越多）
      var layers = global.Lexicon.stratify(looked);

      // 组干扰项：同层内互相干扰
      layers.forEach(function (list) {
        list.forEach(function (item) {
          item.distractors = global.Importer.buildDistractors(item.word, list, 3);
          item.cnDistractors = [];
        });
      });

      // 中文干扰项：取同层其他词的释义
      layers.forEach(function (list) {
        list.forEach(function (item) {
          var pool = [];
          list.forEach(function (other) {
            if (other.word !== item.word && pool.indexOf(other.info.meaning) === -1) {
              pool.push(other.info.meaning);
            }
          });
          item.cnDistractors = pool.slice(0, 3);
        });
      });

      this.layers = layers;
      this.missing = missing;

      // 句子按目标词难度分层
      var levelOf = {};
      layers.forEach(function (list) {
        list.forEach(function (item) { levelOf[item.word] = item.level; });
      });

      var self2 = this;
      var sentOut = [];
      this.parsed.sentences.forEach(function (s) {
        // 找出句中第一个属于生词的词
        var words = s.toLowerCase().match(/[a-z][a-z'\-]*/g) || [];
        var target = null;
        for (var i = 0; i < words.length; i++) {
          if (levelOf[words[i]] != null) { target = words[i]; break; }
        }
        if (!target) return;
        sentOut.push({
          text: s,
          target: target,
          level: levelOf[target],
          wordCount: words.length
        });
      });
      this.sentences = sentOut;

      // 默认全选
      this._selected = {};
      layers.forEach(function (list) {
        list.forEach(function (item) { self2._selected[item.word] = true; });
      });

      return layers;
    },

    /**
     * 切换词的选中状态
     */
    toggleWord: function (word) {
      this._selected[word] = !this._selected[word];
      return this._selected[word];
    },

    setLevel: function (word, level) {
      var self = this;
      this.layers.forEach(function (list) {
        list.forEach(function (item) {
          if (item.word === word) item.level = level;
        });
      });
      // 句子跟随词的层级
      this.sentences.forEach(function (s) {
        if (s.target === word) {
          var found = null;
          self.layers.forEach(function (list) {
            list.forEach(function (item) { if (item.word === word) found = item.level; });
          });
          if (found != null) s.level = found;
        }
      });
    },

    /** 当前选中的词（按层分组） */
    selectedByLevel: function () {
      var out = [[], [], []];
      var self = this;
      this.layers.forEach(function (list) {
        list.forEach(function (item) {
          if (self._selected[item.word]) out[item.level].push(item);
        });
      });
      return out;
    },

    /**
     * 步骤 3：组装课程包
     */
    buildPackage: function (meta) {
      var byLevel = this.selectedByLevel();
      var words = [];
      var self = this;

      byLevel.forEach(function (list) {
        list.forEach(function (item) {
          words.push({
            id: 'w_' + item.word,
            word: item.word,
            phonetic: item.info.phonetic,
            meaning: item.info.meaning,
            pos: item.info.pos,
            level: item.level,
            score: item.score,
            distractors: item.distractors || [],
            cnDistractors: item.cnDistractors || [],
            example: (item.sentences && item.sentences[0]) || '',
            syllables: splitSyllables(item.word)
          });
        });
      });

      var sentences = this.sentences.filter(function (s) {
        return self._selected[s.target];
      }).map(function (s) {
        return { text: s.text, target: s.target, level: s.level };
      });

      var id = meta.id || slugify(meta.title || 'course');
      var data = {
        id: id,
        title: meta.title || '未命名课程',
        subtitle: meta.subtitle || '',
        reference: meta.reference || '',
        quote: meta.quote || '',
        createdAt: Date.now(),
        thresholds: global.Lexicon.lastThresholds,
        words: words,
        sentences: sentences
      };

      this.packageData = data;
      return data;
    },

    /** 下载课程包 */
    download: function () {
      if (!this.packageData) return;
      var text = global.Course.exportJson(this.packageData);
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = this.packageData.id + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },

    /** 复制课程包到剪贴板 */
    copy: function () {
      if (!this.packageData) return Promise.reject(new Error('尚未生成课程包'));
      var text = global.Course.exportJson(this.packageData);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      // 降级方案
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error('复制失败'));
    }
  };

  /* ============ 辅助 ============ */

  function slugify(s) {
    return String(s || 'course')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'course';
  }

  /** 简易音节切分（用于发音训练展示） */
  function splitSyllables(word) {
    var w = String(word || '').toLowerCase();
    var parts = w.match(/[aeiouy]*[^aeiouy]*|[aeiouy]+/g) || [w];
    var out = [];
    parts.forEach(function (p) { if (p) out.push(p); });
    if (!out.length) return [w];
    // 合并单字母孤立元音到前一个
    var merged = [];
    out.forEach(function (p) {
      if (merged.length && p.length === 1 && /[aeiouy]/.test(p) && !/[aeiouy]/.test(merged[merged.length - 1])) {
        merged[merged.length - 1] += p;
      } else {
        merged.push(p);
      }
    });
    return merged;
  }

  Teacher.slugify = slugify;
  Teacher.splitSyllables = splitSyllables;
  global.Teacher = Teacher;
})(window);
