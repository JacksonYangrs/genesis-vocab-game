/**
 * 发音引擎 —— 基于浏览器 Web Speech API
 *
 * 提供三件事：
 * 1. speak()     朗读单词 / 句子（听音辨词、发音训练都用它）
 * 2. speakSeq()  逐音节朗读（跟读训练时高亮当前音节）
 * 3. record()    录音跟读，回放与标准音对比
 *
 * 兼容性：
 * - 朗读：Chrome / Safari / Edge / Firefox 均支持
 * - 录音：需要 HTTPS（GitHub Pages 满足）或 localhost；file:// 下会失败，
 *   此时发音训练自动降级为「听标准音 + 自评」，功能不中断。
 */
(function (global) {
  'use strict';

  var synth = global.speechSynthesis || null;
  var voices = [];
  var voiceReady = false;
  var recording = null;

  function pickVoice() {
    if (!voices.length) return null;
    var pref = (global.Store && global.Store.getSettings().voice) || 'default';
    var pool = voices;
    if (pref !== 'default') {
      var filtered = voices.filter(function (v) {
        return v.lang && v.lang.toLowerCase().indexOf(pref.toLowerCase()) === 0;
      });
      if (filtered.length) pool = filtered;
    }
    // 优先美式/英式的自然音色
    var preferred = pool.filter(function (v) {
      var n = (v.name || '').toLowerCase();
      return /samantha|karen|daniel|alex|google us english|google uk english|microsoft (aaron|aria|jenny|emma)|natural/.test(n);
    });
    return preferred[0] || pool[0] || null;
  }

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices() || [];
    if (voices.length) voiceReady = true;
  }

  var Speech = {
    supported: !!synth,
    voiceReady: false,

    init: function () {
      if (!synth) return;
      var self = this;
      loadVoices();
      if (typeof synth.onvoiceschanged !== 'undefined') {
        synth.onvoiceschanged = function () { loadVoices(); self.voiceReady = true; };
      }
      // 部分浏览器首帧拿不到声音列表，轮询兜底
      var tries = 0;
      var timer = setInterval(function () {
        loadVoices();
        if (voiceReady || tries++ > 20) clearInterval(timer);
      }, 250);
    },

    /** 当前可用音色列表（给设置页下拉用） */
    voices: function () {
      loadVoices();
      return voices.filter(function (v) { return v.lang && /^en/i.test(v.lang); });
    },

    /** 朗读一段文字 */
    speak: function (text, opts) {
      if (!synth || !text) return Promise.resolve(false);
      opts = opts || {};
      return new Promise(function (resolve) {
        try {
          synth.cancel();
          var u = new SpeechSynthesisUtterance(String(text));
          var v = pickVoice();
          if (v) { u.voice = v; u.lang = v.lang; }
          else { u.lang = 'en-US'; }
          u.rate = opts.rate || 1;
          u.pitch = opts.pitch || 1;
          u.volume = opts.volume === undefined ? 1 : opts.volume;
          var settled = false;
          var done = function (ok) {
            if (settled) return;
            settled = true;
            resolve(ok);
          };
          u.onend = function () { done(true); };
          u.onerror = function () { done(false); };
          // 部分环境不触发 onend，兜底定时器
          setTimeout(function () { done(true); }, Math.max(1500, String(text).length * 160));
          synth.speak(u);
        } catch (e) {
          resolve(false);
        }
      });
    },

    /** 依次朗读多个片段（逐音节），每段之间留出间隔 */
    speakSeq: function (items, opts) {
      opts = opts || {};
      var gap = opts.gap === undefined ? 220 : opts.gap;
      var self = this;
      var chain = Promise.resolve();
      items.forEach(function (it) {
        chain = chain.then(function () {
          if (opts.onItem) opts.onItem(it, it.__index);
          return self.speak(it.text, opts);
        }).then(function () {
          return new Promise(function (r) { setTimeout(r, gap); });
        });
      });
      return chain;
    },

    stop: function () {
      if (synth) { try { synth.cancel(); } catch (e) {} }
      if (recording && recording.stop) { try { recording.stop(); } catch (e) {} }
    },

    /** 能否录音 */
    canRecord: function () {
      return !!(global.navigator && global.navigator.mediaDevices &&
                global.navigator.mediaDevices.getUserMedia && global.MediaRecorder);
    },

    /**
     * 录音一次，返回 { blob, url, mime }
     * 失败时 reject，调用方负责降级。
     */
    record: function () {
      var self = this;
      if (!this.canRecord()) {
        return Promise.reject(new Error('当前环境不支持录音（需要 HTTPS 或本地服务器）'));
      }
      return global.navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var mime = '';
        var candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
        for (var i = 0; i < candidates.length; i++) {
          if (global.MediaRecorder.isTypeSupported && global.MediaRecorder.isTypeSupported(candidates[i])) {
            mime = candidates[i]; break;
          }
        }
        var rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        var chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          recording = null;
          resolveResult(blob);
        };
        var resolveResult, rejectResult;
        var p = new Promise(function (res, rej) { resolveResult = res; rejectResult = rej; });
        rec.onerror = function (e) { rejectResult(e.error || new Error('录音失败')); };
        rec.start();
        recording = rec;
        return p.then(function (blob) {
          return { blob: blob, url: URL.createObjectURL(blob), mime: blob.type };
        });
      });
    },

    /** 停止当前录音 */
    stopRecord: function () {
      if (recording && recording.state !== 'inactive') {
        try { recording.stop(); } catch (e) {}
      }
    },

    /** 录音是否正在进行 */
    isRecording: function () {
      return !!(recording && recording.state === 'recording');
    }
  };

  global.Speech = Speech;
})(window);
