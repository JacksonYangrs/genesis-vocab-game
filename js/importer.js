/**
 * Importer —— PDF 课程材料解析与生词提取（教师端）
 *
 * 用 pdf.js 在浏览器内直接解析 PDF，不上传任何服务器。
 * 同时抽出完整句子，供句子填空 / 句子排序题型使用。
 */
(function (global) {
  'use strict';

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var Importer = {
    _pdfjsReady: null,

    /** 高频功能词黑名单 —— 这些词不该成为"生词" */
    STOPWORDS: ('a an the and or but if then than that this these those there here of in on at to for from by with without ' +
      'is are was were be been being am do does did done have has had having will would shall should can could may might must ' +
      'i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours ourselves ' +
      'they them their theirs themselves who whom whose which what when where why how all any both each few more most other some ' +
      'such no nor not only own same so too very just as also because while until against between among through during before ' +
      'after above below up down out off over under again further once about into onto upon per said says say one two three four ' +
      'five six seven eight nine ten first second next last new old good great little big small long short high low ' +
      'many much every able let get make made go goes going went come came see seen saw know knew known take took taken ' +
      'give gave given find found tell told ask asked work worked seem seemed feel felt try tried leave left call called ' +
      'may might must shall').split(/\s+/),

    /** 词形还原用的后缀表（用于判断是否为同一词根的变体） */
    SUFFIXES: ['ing', 'ed', 'es', 's', 'ly', 'ness', 'ment', 'tion', 'ful', 'ous', 'ive', 'er', 'est', 'al', 'ic', 'ate', 'ize', 'ise', 'ify'],

    /** 确保 pdf.js 已加载 */
    ensurePdfJs: function () {
      if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
      if (this._pdfjsReady) return this._pdfjsReady;

      this._pdfjsReady = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = PDFJS_URL;
        script.onload = function () {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          resolve(global.pdfjsLib);
        };
        script.onerror = function () {
          reject(new Error('pdf.js 加载失败，请检查网络后重试'));
        };
        document.head.appendChild(script);
      });
      return this._pdfjsReady;
    },

    /**
     * 解析 PDF → { text, sentences, pageCount }
     * @param {File|ArrayBuffer} file
     */
    parsePdf: function (file) {
      var self = this;
      return this.ensurePdfJs().then(function (pdfjsLib) {
        return file.arrayBuffer().then(function (buf) {
          return pdfjsLib.getDocument({ data: buf }).promise;
        }).then(function (pdf) {
          var pageTexts = [];
          var chain = Promise.resolve();
          for (var i = 1; i <= pdf.numPages; i++) {
            (function (pageNo) {
              chain = chain.then(function () {
                return pdf.getPage(pageNo).then(function (page) {
                  return page.getTextContent().then(function (tc) {
                    var line = '';
                    var lines = [];
                    for (var k = 0; k < tc.items.length; k++) {
                      var it = tc.items[k];
                      line += it.str;
                      if (it.hasEOL) { lines.push(line); line = ''; }
                    }
                    if (line) lines.push(line);
                    pageTexts.push(lines.join('\n'));
                  });
                });
              });
            })(i);
          }
          return chain.then(function () {
            var text = pageTexts.join('\n\n');
            return {
              text: text,
              sentences: self.splitSentences(text),
              pageCount: pdf.numPages,
              charCount: text.length
            };
          });
        });
      });
    },

    /** 解析纯文本（老师直接粘贴材料时用） */
    parseText: function (text) {
      return {
        text: text,
        sentences: this.splitSentences(text),
        pageCount: 0,
        charCount: text.length
      };
    },

    /** 切句：保留标点，供句子题使用 */
    splitSentences: function (text) {
      var raw = String(text || '').replace(/\r/g, '');
      var blocks = raw.split(/\n+/);
      var out = [];
      blocks.forEach(function (block) {
        block = block.trim();
        if (!block) return;
        // 逐句切分：句号/问号/叹号 + 空白，或换行
        var parts = block.split(/(?<=[.!?])\s+/);
        parts.forEach(function (s) {
          s = s.trim();
          // 单句至少要有 4 个词、20 个字符才值得出题
          var wc = (s.match(/[A-Za-z][A-Za-z'\-]*/g) || []).length;
          if (wc >= 4 && s.length >= 20 && s.length <= 300) out.push(s);
        });
      });
      return out;
    },

    /**
     * 从文本提取生词候选
     * @returns {Array} [{word, count, inSentences:[句子]}]
     */
    extractCandidates: function (text, sentences) {
      var self = this;
      var tokens = String(text || '').match(/[A-Za-z][A-Za-z'\-]*/g) || [];
      var stop = {};
      this.STOPWORDS.forEach(function (w) { stop[w] = true; });

      var freq = {};
      tokens.forEach(function (t) {
        var w = t.toLowerCase().replace(/^-+|-+$/g, '');
        if (w.length < 3 || w.length > 18) return;
        if (!/^[a-z]+(?:'[a-z]+)?$/.test(w)) return;
        if (stop[w]) return;
        freq[w] = (freq[w] || 0) + 1;
      });

      // 找出包含该词的句子
      var sentenceMap = {};
      (sentences || []).forEach(function (s) {
        var ws = s.toLowerCase().match(/[a-z][a-z'\-]*/g) || [];
        var uniq = {};
        ws.forEach(function (w) { uniq[w] = true; });
        Object.keys(uniq).forEach(function (w) {
          if (!freq[w]) return;
          if (!sentenceMap[w]) sentenceMap[w] = [];
          if (sentenceMap[w].length < 3) sentenceMap[w].push(s);
        });
      });

      var cands = Object.keys(freq).map(function (w) {
        return {
          word: w,
          count: freq[w],
          sentences: sentenceMap[w] || []
        };
      });

      // 排序：出现次数多的先排（同频次按字母）
      cands.sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a.word.localeCompare(b.word);
      });
      return cands;
    },

    /** 词根（用于识别形态变体） */
    stem: function (word) {
      var w = String(word).toLowerCase();
      for (var i = 0; i < this.SUFFIXES.length; i++) {
        var suf = this.SUFFIXES[i];
        if (w.length - suf.length >= 4 && w.slice(-suf.length) === suf) {
          return w.slice(0, -suf.length);
        }
      }
      return w;
    },

    /**
     * 组装干扰项
     * 策略：形态变体优先（质量最高，heaven↔heavens）→ 同学层同词性词兜底
     *
     * @param {string} target 目标词
     * @param {Array} peers  同层其他词（词对象数组）
     * @param {number} n      需要几个
     */
    buildDistractors: function (target, peers, n) {
      n = n || 3;
      var t = String(target).toLowerCase();
      var out = [];
      var seen = {};
      seen[t] = true;

      // 1) 形态变体：优先同学层里的同词根词
      var targetStem = this.stem(t);
      (peers || []).forEach(function (p) {
        if (out.length >= n) return;
        var pw = (typeof p === 'string' ? p : p.word).toLowerCase();
        if (seen[pw]) return;
        if (Importer.stem(pw) === targetStem) {
          out.push(pw);
          seen[pw] = true;
        }
      });

      // 2) 兜底：同学层同词性的词
      (peers || []).forEach(function (p) {
        if (out.length >= n) return;
        var pw = (typeof p === 'string' ? p : p.word).toLowerCase();
        if (seen[pw]) return;
        out.push(pw);
        seen[pw] = true;
      });

      return out.slice(0, n);
    }
  };

  global.Importer = Importer;
})(window);
