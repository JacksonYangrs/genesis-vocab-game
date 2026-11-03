/**
 * 应用主控 —— 视图路由、交互绑定、状态同步
 */
(function () {
  'use strict';

  var VOCAB = window.VOCAB;
  var Store = window.Store;
  var Quiz = window.Quiz;
  var Speech = window.Speech;

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  var state = {
    view: 'home',
    pronIndex: 0,
    recordUrl: null,
    lastWrongIds: []
  };

  /* ============ 工具 ============ */

  function toast(msg) {
    var t = els.toast;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  function confirmDialog(title, text, confirmText) {
    return new Promise(function (resolve) {
      els.modalTitle.textContent = title;
      els.modalText.textContent = text;
      els.modalConfirm.textContent = confirmText || '确定';
      els.modal.hidden = false;
      els.modalConfirm.onclick = function () { els.modal.hidden = true; resolve(true); };
      els.modalCancel.onclick = function () { els.modal.hidden = true; resolve(false); };
      els.modalBackdrop.onclick = function (e) {
        if (e.target === els.modalBackdrop) { els.modal.hidden = true; resolve(false); }
      };
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wordById(id) {
    for (var i = 0; i < VOCAB.length; i++) if (VOCAB[i].id === id) return VOCAB[i];
    return null;
  }

  function fmtTime(sec) {
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ' 分 ' + s + ' 秒';
  }

  /* ============ 视图切换 ============ */

  var VIEWS = ['home', 'quiz', 'result', 'progress', 'wordlist', 'pronounce'];

  function showView(name) {
    VIEWS.forEach(function (v) {
      var el = $('view-' + v);
      if (el) el.hidden = (v !== name);
    });
    state.view = name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============ 首页 ============ */

  function renderHome() {
    // 模式卡片
    var grid = els.modeGrid;
    grid.innerHTML = '';
    Object.keys(Quiz.MODES).forEach(function (key) {
      var m = Quiz.MODES[key];
      var btn = document.createElement('button');
      btn.className = 'mode-card';
      btn.setAttribute('data-mode', key);
      var tag = '';
      if (key === 'listen') tag = '练听力';
      else if (key === 'spell') tag = '练拼写';
      else if (key === 'mixed') tag = '综合';
      btn.innerHTML =
        '<span class="m-icon">' + m.icon + '</span>' +
        '<span class="m-title">' + m.label + '</span>' +
        '<span class="m-desc">' + m.desc + '</span>' +
        (tag ? '<span class="m-tag">' + tag + '</span>' : '');
      btn.addEventListener('click', function () { startQuiz(key); });
      grid.appendChild(btn);
    });

    // 难度切换
    var diffSeg = els.segDifficulty;
    diffSeg.innerHTML = '';
    ['easy', 'medium', 'hard'].forEach(function (k) {
      var d = Quiz.DIFFICULTY[k];
      var b = document.createElement('button');
      b.className = 'seg-btn' + (Store.getSettings().difficulty === k ? ' active' : '');
      b.textContent = d.label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () {
        Store.setSetting('difficulty', k);
        renderSettings();
      });
      diffSeg.appendChild(b);
    });

    // 题量切换
    var countSeg = els.segCount;
    countSeg.innerHTML = '';
    [5, 10, 17].forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'seg-btn' + (Store.getSettings().count === n ? ' active' : '');
      b.textContent = n + ' 题';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () {
        Store.setSetting('count', n);
        renderSettings();
      });
      countSeg.appendChild(b);
    });

    renderSettings();
    renderHeroStats();
    renderWrongCount();
  }

  function renderSettings() {
    var s = Store.getSettings();
    els.diffDesc.textContent = Quiz.DIFFICULTY[s.difficulty].desc;
    // 同步高亮
    Array.prototype.forEach.call(els.segDifficulty.children, function (b, i) {
      b.classList.toggle('active', ['easy', 'medium', 'hard'][i] === s.difficulty);
    });
    Array.prototype.forEach.call(els.segCount.children, function (b, i) {
      b.classList.toggle('active', [5, 10, 17][i] === s.count);
    });
  }

  function renderHeroStats() {
    var counts = Store.levelCounts(VOCAB);
    var mastered = counts.mastered + counts.strong;
    var pct = Math.round(mastered / VOCAB.length * 100);
    var totalSeen = 0, totalCorrect = 0;
    VOCAB.forEach(function (w) {
      var r = Store.state.words[w.id];
      if (r) { totalSeen += r.seen; totalCorrect += r.correct; }
    });
    var acc = totalSeen ? Math.round(totalCorrect / totalSeen * 100) : 0;

    els.heroStats.innerHTML =
      '<span class="hero-stat"><b>' + mastered + '/' + VOCAB.length + '</b>已掌握</span>' +
      '<span class="hero-stat"><b>' + pct + '%</b>熟练度</span>' +
      '<span class="hero-stat"><b>' + acc + '%</b>总正确率</span>' +
      '<span class="hero-stat"><b>' + totalSeen + '</b>累计答题</span>';
  }

  function renderWrongCount() {
    var wrong = Store.wrongList(VOCAB);
    var el = $('wrong-count-desc');
    el.textContent = wrong.length ? ('共 ' + wrong.length + ' 个词待复习') : '还没有错题，继续保持';
    var card = document.querySelector('[data-special="wrong"]');
    if (card) card.classList.toggle('disabled', wrong.length === 0);
  }

  /* ============ 答题流程 ============ */

  function startQuiz(mode, opts) {
    opts = opts || {};
    var s = Store.getSettings();
    Quiz.start(mode, {
      count: opts.count || s.count,
      difficulty: opts.difficulty || s.difficulty,
      pool: opts.pool || null,
      forceSpell: opts.forceSpell || null
    });
    showView('quiz');
    renderQuestion();
  }

  var answered = false;

  function renderQuestion() {
    var session = Quiz.current;
    var q = Quiz.question();
    if (!q) return;

    answered = false;
    els.quizModeLabel.textContent = session.modeLabel;
    els.quizDiffLabel.textContent = session.difficulty.label + ' · 第 ' + (session.index + 1) + '/' + session.questions.length + ' 题';

    // 同步难度快捷按钮的选中态
    Array.prototype.forEach.call(els.segDifficultyQuick.children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-diff') === session.difficulty.key);
    });

    // 题型标签
    var kindText = { e2c: '英译中', c2e: '中译英', listen: '听音辨词', spell: '拼写题' };
    els.qKind.textContent = kindText[q.kind] || '';

    // 题干
    els.qPrompt.textContent = q.prompt;
    els.qPrompt.className = 'q-prompt' + (q.type === 'choice' && q.kind === 'e2c' ? ' is-word' : '');
    els.qSub.textContent = q.subPrompt || '';
    els.qSub.className = 'q-sub' + (q.kind === 'c2e' ? ' is-pos' : '');

    // 听音区
    var isListen = q.kind === 'listen';
    els.listenBox.hidden = !isListen;
    els.btnReplay.hidden = true;
    if (isListen) {
      setTimeout(function () { playQuestionAudio(); }, 260);
    }

    // 选项 / 拼写
    els.spellBox.hidden = q.type !== 'spell';
    els.options.innerHTML = '';
    els.spellInput.value = '';
    els.spellInput.disabled = false;
    els.btnSubmitSpell.disabled = false;

    if (q.type === 'choice') {
      q.options.forEach(function (opt, i) {
        var b = document.createElement('button');
        b.className = 'option-btn';
        b.innerHTML = '<span class="opt-key">' + (i + 1) + '</span><span>' + esc(opt) + '</span>';
        b.addEventListener('click', function () {
          if (answered) return;
          submitAnswer(opt, b);
        });
        els.options.appendChild(b);
      });
    } else {
      els.spellInput.focus();
    }

    // 提示
    els.hintRow.hidden = false;
    els.btnHint.textContent = '💡 看提示';
    els.btnHint.onclick = function () {
      els.btnHint.textContent = '💡 ' + q.hintText;
      els.btnHint.disabled = true;
    };

    // 反馈区隐藏
    els.feedback.hidden = true;
    els.feedback.className = 'feedback';

    // 进度条
    var pct = (session.index / session.questions.length) * 100;
    els.progressFill.style.width = pct + '%';
    els.progressText.textContent = (session.index + 1) + ' / ' + session.questions.length;
    els.progressStrip.hidden = false;

    updateScore();
    updateCombo();
  }

  function playQuestionAudio() {
    var q = Quiz.question();
    if (!q || !q.audio) return;
    els.btnSpeak.classList.add('speaking');
    Speech.speak(q.audio, { rate: 0.92 }).then(function () {
      els.btnSpeak.classList.remove('speaking');
      els.btnReplay.hidden = false;
    });
  }

  function updateScore() {
    var s = Quiz.current;
    var score = 0, combo = 0;
    s.responses.forEach(function (r) {
      if (r.grade.correct) {
        combo += 1;
        score += 10 + (combo >= 3 ? Math.min(10, (combo - 2) * 2) : 0);
      } else combo = 0;
    });
    els.quizScore.textContent = score;
  }

  function updateCombo() {
    var c = Quiz.current.combo;
    if (c >= 2) {
      els.comboFlag.hidden = false;
      els.comboFlag.textContent = '🔥 连对 ' + c + ' 题' + (c >= 3 ? '（每题 +' + Math.min(10, (c - 2) * 2) + ' 分）' : '');
    } else {
      els.comboFlag.hidden = true;
    }
  }

  function submitAnswer(response, chosenBtn) {
    if (answered) return;
    answered = true;

    var q = Quiz.question();
    var res = Quiz.submit(response);

    // 选项态
    if (q.type === 'choice') {
      Array.prototype.forEach.call(els.options.children, function (b) {
        b.disabled = true;
        var txt = b.querySelector('span:last-child').textContent;
        if (txt === q.answer) b.classList.add('correct');
        else if (b === chosenBtn) b.classList.add('wrong');
        else b.classList.add('dimmed');
      });
    } else {
      els.spellInput.disabled = true;
      els.btnSubmitSpell.disabled = true;
      if (!res.correct) {
        els.spellInput.classList.add('shake');
        setTimeout(function () { els.spellInput.classList.remove('shake'); }, 400);
      }
    }

    // 反馈面板
    var w = wordById(q.wordId);
    var fb = els.feedback;
    fb.hidden = false;
    fb.className = 'feedback ' + (res.correct ? 'ok' : 'no');

    var verdict = res.correct
      ? (res.nearMiss ? '⚠️ 算你过 —— 但拼写有误' : '✅ 答对了！')
      : '❌ 答错了';
    els.fbVerdict.textContent = verdict;

    var body = '';
    if (!res.correct) {
      body += '<div class="fb-answer">正确答案：' + esc(q.answerDetail) + '</div>';
    } else if (q.type === 'spell') {
      body += '<div class="fb-answer">' + esc(q.answerDetail) + '</div>';
    }

    // 释义行：英译中的答案本身就是中文，此处改显英文词，避免与上一行重复
    var meaningText = (q.kind === 'e2c') ? (w.word + '　' + w.pos) : w.meaning;
    var meaningLabel = (q.kind === 'e2c') ? '英文' : '释义';

    body += '<div class="fb-line"><span class="fb-label">' + meaningLabel + '</span><span class="fb-text">' + esc(meaningText) + '</span></div>';
    body += '<div class="fb-line"><span class="fb-label">音标</span><span class="fb-text mono">' + esc(w.phonetic) + '</span></div>';
    body += '<div class="fb-line"><span class="fb-label">例句</span><span class="fb-text"><i>' + esc(w.example) + '</i><br>' + esc(w.exampleZh) + '</span></div>';
    if (w.tip) {
      body += '<div class="fb-line"><span class="fb-label">提示</span><span class="fb-text">' + esc(w.tip) + '</span></div>';
    }
    if (!res.correct && w.note) {
      body += '<div class="fb-note">💡 ' + esc(w.note) + '</div>';
    }
    if (res.nearMiss) {
      body += '<div class="fb-nearmiss">✏️ ' + esc(res.detail) + '</div>';
    }
    els.fbBody.innerHTML = body;

    els.btnNext.textContent = (Quiz.current.index === Quiz.current.questions.length - 1) ? '查看结果 →' : '下一题 →';

    updateScore();
    updateCombo();

    // 反馈面板可能在视野之外（手机端尤其明显），滚动到可见位置，
    // 让学习者第一时间看到讲解，而不是以为没反应。
    setTimeout(function () {
      var top = fb.getBoundingClientRect().top + window.pageYOffset;
      var target = Math.max(0, top - 70);
      window.scrollTo({ top: target, behavior: 'smooth' });
    }, 60);

    els.btnNext.focus({ preventScroll: true });
  }

  function nextQuestion() {
    var more = Quiz.next();
    if (more) {
      renderQuestion();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      renderResult();
    }
  }

  /* ============ 结果页 ============ */

  function renderResult() {
    var sum = Quiz.summary;
    els.progressStrip.hidden = true;
    els.comboFlag.hidden = true;

    els.resultPct.textContent = sum.accuracy + '%';
    els.resultRing.style.setProperty('--pct', sum.accuracy + '%');

    var title = '测试完成';
    if (sum.accuracy === 100) title = '满分！全对 🎉';
    else if (sum.accuracy >= 80) title = '表现很棒！';
    else if (sum.accuracy >= 60) title = '不错，继续加油';
    else title = '需要多练几遍';
    els.resultTitle.textContent = title;
    els.resultSub.textContent = sum.modeLabel + ' · ' + sum.difficulty + ' · ' + fmtTime(sum.duration);

    var chips = '';
    chips += '<span class="chip good">✓ 答对 ' + sum.correct + '</span>';
    if (sum.wrong) chips += '<span class="chip bad">✗ 答错 ' + sum.wrong + '</span>';
    chips += '<span class="chip">得分 ' + sum.score + '</span>';
    if (sum.nearMiss) chips += '<span class="chip warn">≈ 容错通过 ' + sum.nearMiss + '</span>';
    if (sum.bestCombo >= 2) chips += '<span class="chip warn">🔥 最长连对 ' + sum.bestCombo + '</span>';
    els.resultChips.innerHTML = chips;

    // 错题清单
    state.lastWrongIds = [];
    if (sum.wrongWords.length) {
      els.wrongSection.hidden = false;
      els.wrongList.innerHTML = sum.wrongWords.map(function (r) {
        var w = wordById(r.question.wordId);
        state.lastWrongIds.push(w.id);
        var userTxt = r.response;
        var q = r.question;
        var yours;
        if (q.type === 'spell') {
          yours = '你写的：<b>' + esc(userTxt || '(空)') + '</b>';
        } else {
          yours = '你选的：<b>' + esc(userTxt) + '</b>';
        }
        var noteHtml = w.note ? '<div class="wrong-note">💡 ' + esc(w.note) + '</div>' : '';
        return '<div class="wrong-item">' +
          '<div class="wrong-head">' +
            '<span class="wrong-word">' + esc(w.word) + '</span>' +
            '<span class="wrong-ipa">' + esc(w.phonetic) + '</span>' +
          '</div>' +
          '<div class="wrong-yours">' + yours + '</div>' +
          '<div class="wrong-right">正确答案：<b>' + esc(w.word) + '</b> ' + esc(w.phonetic) + '</div>' +
          '<div class="wrong-cn">中文释义：' + esc(w.meaning) + '</div>' +
          '<div class="wrong-cn">例句：' + esc(w.example) + '</div>' +
          noteHtml +
        '</div>';
      }).join('');
    } else {
      els.wrongSection.hidden = true;
      els.wrongList.innerHTML = '';
    }

    showView('result');
  }

  /* ============ 掌握情况 ============ */

  function renderProgress() {
    var counts = Store.levelCounts(VOCAB);
    var order = Store.LEVEL_ORDER;
    var labels = { new: '未练习', weak: '生疏', learning: '巩固中', strong: '熟悉', mastered: '已掌握' };
    var colors = { new: '#94a3b8', weak: '#e5484d', learning: '#f5a524', strong: '#3b82f6', mastered: '#12a594' };

    els.masterySummary.innerHTML = order.map(function (k) {
      return '<div class="ms-item">' +
        '<div class="ms-num" style="color:' + colors[k] + '">' + counts[k] + '</div>' +
        '<div class="ms-label">' + labels[k] + '</div>' +
      '</div>';
    }).join('');

    // 按掌握程度排序：最弱的排前面
    var sorted = VOCAB.slice().sort(function (a, b) {
      var la = Store.levelOf(a.id), lb = Store.levelOf(b.id);
      var d = order.indexOf(la) - order.indexOf(lb);
      if (d !== 0) return d;
      return Store.accuracyOf(a.id) - Store.accuracyOf(b.id);
    });

    els.masteryList.innerHTML = sorted.map(function (w) {
      var lvl = Store.levelOf(w.id);
      var meta = Store.LEVELS[lvl];
      var r = Store.state.words[w.id];
      var acc = Store.accuracyOf(w.id);
      var stats = r && r.seen
        ? (r.correct + '/' + r.seen + ' 题 · ' + Math.round(acc * 100) + '%')
        : '还没练过';
      var pron = r && r.pronTotal ? ('🎤 跟读 ' + r.pronOk + '/' + r.pronTotal) : '';
      return '<div class="m-row">' +
        '<span class="m-dot" style="background:' + meta.color + '"></span>' +
        '<div class="m-word"><b>' + esc(w.word) + ' <span style="color:var(--text-3);font-weight:400;font-size:12px">' + esc(w.phonetic) + '</span></b>' +
          '<small>' + esc(w.meaning) + (pron ? ' · ' + pron : '') + '</small></div>' +
        '<div class="m-stats">' +
          '<span class="m-badge" style="background:' + meta.color + '1a;color:' + meta.color + '">' + meta.label + '</span>' +
          '<span class="m-acc">' + stats + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    // 历史
    var hist = Store.state.history.slice().reverse();
    if (hist.length) {
      els.historyList.innerHTML = hist.slice(0, 10).map(function (h) {
        var d = new Date(h.at);
        var ts = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                 (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
                 (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
        return '<div class="history-item">' +
          '<div class="h-mode"><b>' + esc(h.modeLabel) + ' · ' + esc(h.difficulty) + '</b>' +
          '<small>' + ts + ' · ' + h.correct + '/' + h.total + ' 题 · 得分 ' + h.score + '</small></div>' +
          '<div class="h-acc">' + h.accuracy + '%</div>' +
        '</div>';
      }).join('');
    } else {
      els.historyList.innerHTML = '<div class="h-empty">还没有测试记录</div>';
    }
  }

  /* ============ 生词表 ============ */

  function renderWordlist() {
    els.wordlist.innerHTML = VOCAB.map(function (w, i) {
      var lvl = Store.levelOf(w.id);
      var meta = Store.LEVELS[lvl];
      return '<div class="wl-item">' +
        '<span class="wl-num">' + (i + 1) + '</span>' +
        '<div class="wl-body">' +
          '<div class="wl-top">' +
            '<span class="wl-word">' + esc(w.word) + '</span>' +
            '<span class="wl-ipa">' + esc(w.phonetic) + '</span>' +
            '<span class="wl-pos">' + esc(w.pos) + '</span>' +
            '<span class="m-badge" style="background:' + meta.color + '1a;color:' + meta.color + '">' + meta.label + '</span>' +
          '</div>' +
          '<div class="wl-cn">' + esc(w.meaning) + '</div>' +
          '<div class="wl-ex"><i>' + esc(w.example) + '</i><br>' + esc(w.exampleZh) + '</div>' +
        '</div>' +
        '<button class="wl-speak" data-word="' + esc(w.word) + '" aria-label="播放 ' + esc(w.word) + '">🔊</button>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(els.wordlist.querySelectorAll('.wl-speak'), function (b) {
      b.addEventListener('click', function () {
        Speech.speak(b.getAttribute('data-word'), { rate: 0.92 });
      });
    });
  }

  /* ============ 发音训练 ============ */

  function renderPronounce() {
    var w = VOCAB[state.pronIndex];
    els.pronWord.textContent = w.word;
    els.pronIpa.textContent = w.phonetic;
    els.pronMeaning.textContent = w.meaning + '　(' + w.pos + ')';
    els.pronExample.innerHTML =
      '<div class="pe-en">' + esc(w.example) + '</div>' +
      '<div class="pe-zh">' + esc(w.exampleZh) + '</div>';

    els.pronSyllables.innerHTML = w.syllables.map(function (s, i) {
      return '<span class="syl" data-i="' + i + '">' + esc(s) + '</span>';
    }).join('');

    // 索引条
    els.pronIndex.innerHTML = VOCAB.map(function (x, i) {
      var lvl = Store.levelOf(x.id);
      var meta = Store.LEVELS[lvl];
      return '<button class="pi-item' + (i === state.pronIndex ? ' active' : '') + '" data-i="' + i + '" ' +
             'style="border-color:' + meta.color + '33">' + (i + 1) + '</button>';
    }).join('');
    Array.prototype.forEach.call(els.pronIndex.children, function (b) {
      b.addEventListener('click', function () {
        state.pronIndex = parseInt(b.getAttribute('data-i'), 10);
        renderPronounce();
      });
    });

    // 录音能力检测
    if (!Speech.canRecord()) {
      els.recordRow.hidden = true;
      els.recordHint.textContent = '⚠️ 当前环境不支持录音（需 HTTPS 或本地服务器），仍可听标准发音跟读';
    } else {
      els.recordRow.hidden = false;
      els.recordHint.textContent = '点「开始跟读」录下自己的声音，再和标准音对比';
    }
    els.btnRecord.classList.remove('recording');
    els.btnRecord.textContent = '🎙️ 开始跟读';
    els.btnPlayback.hidden = true;
    els.btnRateOk.classList.remove('rated');
  }

  function playStandard(rate) {
    var w = VOCAB[state.pronIndex];
    els.btnPronSpeak.classList.add('speaking');
    Speech.speak(w.word, { rate: rate || 0.92 }).then(function () {
      els.btnPronSpeak.classList.remove('speaking');
    });
  }

  function playSyllables() {
    var w = VOCAB[state.pronIndex];
    var items = w.syllables.map(function (s, i) {
      return { text: s, __index: i };
    });
    var sylEls = els.pronSyllables.children;
    Speech.speakSeq(items, {
      rate: 0.72,
      gap: 300,
      onItem: function (it) {
        Array.prototype.forEach.call(sylEls, function (el, i) {
          el.classList.toggle('active', i === it.__index);
        });
      }
    }).then(function () {
      Array.prototype.forEach.call(sylEls, function (el) { el.classList.remove('active'); });
    });
  }

  var recording = false;
  function toggleRecord() {
    if (recording) {
      Speech.stopRecord();
      recording = false;
      els.btnRecord.classList.remove('recording');
      els.btnRecord.textContent = '🎙️ 重新跟读';
      els.recordHint.textContent = '录音中… 点击「听我的录音」回放对比';
      return;
    }
    els.recordHint.textContent = '正在请求麦克风权限…';
    Speech.record().then(function (res) {
      recording = false;
      els.btnRecord.classList.remove('recording');
      els.btnRecord.textContent = '🎙️ 重新跟读';
      if (state.recordUrl) URL.revokeObjectURL(state.recordUrl);
      state.recordUrl = res.url;
      els.btnPlayback.hidden = false;
      els.selfRateRow.hidden = false;
      els.recordHint.textContent = '✅ 录好了！先听标准音，再听自己的，对比重音位置';
      // 自动播放标准音，方便对比
      setTimeout(function () { playStandard(0.85); }, 250);
    }).catch(function (err) {
      recording = false;
      els.btnRecord.classList.remove('recording');
      els.btnRecord.textContent = '🎙️ 开始跟读';
      els.recordHint.textContent = '⚠️ 录音失败：' + (err && err.message ? err.message : '未知原因');
    });
    recording = true;
    els.btnRecord.classList.add('recording');
    els.btnRecord.textContent = '⏹ 停止录音';
    els.recordHint.textContent = '🎙️ 正在录音… 请朗读上面的单词';
  }

  /** 跟读自评：结果计入该词的跟读统计 */
  function ratePronounce(ok) {
    var w = VOCAB[state.pronIndex];
    Store.recordPronounce(w.id, ok);
    els.btnRateOk.classList.toggle('rated', ok);
    els.recordHint.textContent = ok
      ? '👍 已记录：这个词你读准了，继续下一个'
      : '💪 已记录：还会继续练，多听几遍标准音';
    toast(ok ? '已记录 · 读准了' : '已记录 · 还要练');
  }

  /* ============ 事件绑定 ============ */

  function bind() {
    // 首页
    els.modeGrid.addEventListener('click', function (e) {
      var card = e.target.closest('.mode-card');
      if (card) startQuiz(card.getAttribute('data-mode'));
    });

    document.querySelector('[data-special="wrong"]').addEventListener('click', function () {
      var wrong = Store.wrongList(VOCAB);
      if (!wrong.length) { toast('还没有错题，先做一次测试吧'); return; }
      startQuiz('mixed', {
        pool: wrong,
        count: Math.min(wrong.length, Store.getSettings().count)
      });
    });

    document.querySelector('[data-special="pronounce"]').addEventListener('click', function () {
      state.pronIndex = 0;
      renderPronounce();
      showView('pronounce');
    });

    // 答题页难度快捷切换：立即用新难度重开当前模式
    els.segDifficultyQuick.innerHTML = '';
    ['easy', 'medium', 'hard'].forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'seg-btn';
      b.textContent = Quiz.DIFFICULTY[k].label;
      b.setAttribute('data-diff', k);
      b.addEventListener('click', function () {
        if (Quiz.current && Quiz.current.difficulty.key === k) return;
        Store.setSetting('difficulty', k);
        var s = Quiz.current;
        if (s) {
          Quiz.start(s.mode, {
            count: s.questions.length,
            difficulty: k,
            pool: s.pool,
            forceSpell: s.forceSpell
          });
        }
        renderHome();
        renderQuestion();
        toast('已切换为「' + Quiz.DIFFICULTY[k].label + '」难度');
      });
      els.segDifficultyQuick.appendChild(b);
    });

    // 答题
    els.btnQuit.addEventListener('click', function () {
      confirmDialog('退出测试？', '已作答的题目仍会记入掌握情况，但不会生成成绩单。', '退出').then(function (ok) {
        if (ok) {
          Quiz.abandon();
          els.progressStrip.hidden = true;
          showView('home');
          renderHome();
        }
      });
    });
    els.btnSpeak.addEventListener('click', playQuestionAudio);
    els.btnReplay.addEventListener('click', playQuestionAudio);
    els.btnSubmitSpell.addEventListener('click', function () {
      if (answered) return;
      var v = els.spellInput.value.trim();
      if (!v) { els.spellInput.classList.add('shake'); setTimeout(function(){ els.spellInput.classList.remove('shake'); }, 400); return; }
      submitAnswer(v, null);
    });
    els.spellInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); els.btnSubmitSpell.click(); }
    });
    els.btnNext.addEventListener('click', nextQuestion);

    // 键盘快捷键（桌面）
    document.addEventListener('keydown', function (e) {
      if (state.view === 'quiz' && !answered) {
        var q = Quiz.question();
        if (q && q.type === 'choice') {
          var n = parseInt(e.key, 10);
          if (n >= 1 && n <= q.options.length) {
            els.options.children[n - 1].click();
          }
        } else if (q && q.type === 'spell' && e.key === 'Enter') {
          els.btnSubmitSpell.click();
        }
      }
      if (state.view === 'quiz' && answered && e.key === 'Enter') {
        e.preventDefault();
        els.btnNext.click();
      }
    });

    // 结果页
    els.btnRetry.addEventListener('click', function () {
      Quiz.restart();
      showView('quiz');
      renderQuestion();
    });
    els.btnReviewWrong.addEventListener('click', function () {
      if (!state.lastWrongIds.length) { toast('没有错题可复习'); return; }
      var ids = {};
      state.lastWrongIds.forEach(function (id) { ids[id] = true; });
      var pool = VOCAB.filter(function (w) { return ids[w.id]; });
      startQuiz('mixed', { pool: pool, count: pool.length, forceSpell: ids });
    });
    els.btnBackHome.addEventListener('click', function () {
      showView('home'); renderHome();
    });

    // 掌握情况
    els.btnProgress.addEventListener('click', function () {
      renderProgress();
      showView('progress');
    });
    els.btnCloseProgress.addEventListener('click', function () {
      showView('home'); renderHome();
    });
    els.btnExport.addEventListener('click', function () {
      var data = Store.exportJSON();
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'genesis-vocab-progress-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('进度已导出');
    });
    els.btnImport.addEventListener('click', function () { els.fileImport.click(); });
    els.fileImport.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          Store.importJSON(reader.result);
          toast('进度导入成功');
          renderProgress();
          renderHome();
        } catch (err) {
          toast('导入失败：' + (err.message || '文件格式错误'));
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    els.btnReset.addEventListener('click', function () {
      confirmDialog('清空全部进度？', '掌握情况、错题本、测试历史都会被删除，且无法恢复。', '确认清空').then(function (ok) {
        if (!ok) return;
        Store.reset();
        toast('进度已清空');
        renderProgress();
        renderHome();
      });
    });

    // 生词表
    els.btnWordlist.addEventListener('click', function () {
      renderWordlist();
      showView('wordlist');
    });
    els.btnCloseWordlist.addEventListener('click', function () {
      showView('home'); renderHome();
    });

    // 发音训练
    els.btnClosePronounce.addEventListener('click', function () {
      Speech.stop();
      showView('home'); renderHome();
    });
    els.btnPronSpeak.addEventListener('click', function () { playStandard(0.92); });
    els.btnSlow.addEventListener('click', function () { playStandard(0.55); });
    els.btnSyllable.addEventListener('click', playSyllables);
    els.btnRecord.addEventListener('click', toggleRecord);
    els.btnPlayback.addEventListener('click', function () {
      if (!state.recordUrl) return;
      var a = new Audio(state.recordUrl);
      a.play();
      els.recordHint.textContent = '正在播放你的录音 —— 和刚才的标准音比一比';
    });
    els.btnRateOk.addEventListener('click', function () { ratePronounce(true); });
    els.btnRateAgain.addEventListener('click', function () { ratePronounce(false); });
    els.btnPronPrev.addEventListener('click', function () {
      state.pronIndex = (state.pronIndex - 1 + VOCAB.length) % VOCAB.length;
      renderPronounce();
    });
    els.btnPronNext.addEventListener('click', function () {
      state.pronIndex = (state.pronIndex + 1) % VOCAB.length;
      renderPronounce();
    });
  }

  /* ============ 启动 ============ */

  function init() {
    els = {
      toast: $('toast'),
      modal: $('modal'),
      modalBackdrop: $('modal'),
      modalTitle: $('modal-title'),
      modalText: $('modal-text'),
      modalConfirm: $('modal-confirm'),
      modalCancel: $('modal-cancel'),
      modeGrid: $('mode-grid'),
      segDifficulty: $('seg-difficulty'),
      segCount: $('seg-count'),
      diffDesc: $('diff-desc'),
      heroStats: $('hero-stats'),
      progressStrip: $('progress-strip'),
      progressFill: $('progress-fill'),
      progressText: $('progress-text'),
      quizModeLabel: $('quiz-mode-label'),
      quizDiffLabel: $('quiz-diff-label'),
      quizScore: $('quiz-score'),
      btnQuit: $('btn-quit'),
      segDifficultyQuick: $('seg-difficulty-quick'),
      comboFlag: $('combo-flag'),
      qKind: $('q-kind'),
      listenBox: $('listen-box'),
      btnSpeak: $('btn-speak'),
      btnReplay: $('btn-replay'),
      qPrompt: $('q-prompt'),
      qSub: $('q-sub'),
      options: $('q-options'),
      spellBox: $('spell-box'),
      spellInput: $('spell-input'),
      btnSubmitSpell: $('btn-submit-spell'),
      hintRow: $('hint-row'),
      btnHint: $('btn-hint'),
      feedback: $('feedback'),
      fbVerdict: $('fb-verdict'),
      fbBody: $('fb-body'),
      btnNext: $('btn-next'),
      resultRing: $('result-ring'),
      resultPct: $('result-pct'),
      resultTitle: $('result-title'),
      resultSub: $('result-sub'),
      resultChips: $('result-chips'),
      wrongSection: $('wrong-section'),
      wrongList: $('wrong-list'),
      btnRetry: $('btn-retry'),
      btnReviewWrong: $('btn-review-wrong'),
      btnBackHome: $('btn-back-home'),
      btnProgress: $('btn-progress'),
      btnCloseProgress: $('btn-close-progress'),
      masterySummary: $('mastery-summary'),
      masteryList: $('mastery-list'),
      historyList: $('history-list'),
      btnExport: $('btn-export'),
      btnImport: $('btn-import'),
      btnReset: $('btn-reset'),
      fileImport: $('file-import'),
      btnWordlist: $('btn-wordlist'),
      btnCloseWordlist: $('btn-close-wordlist'),
      wordlist: $('wordlist'),
      btnClosePronounce: $('btn-close-pronounce'),
      pronWord: $('pron-word'),
      pronIpa: $('pron-ipa'),
      pronMeaning: $('pron-meaning'),
      pronExample: $('pron-example'),
      pronSyllables: $('pron-syllables'),
      pronIndex: $('pron-index'),
      btnPronSpeak: $('btn-pron-speak'),
      btnSlow: $('btn-slow'),
      btnSyllable: $('btn-syllable'),
      btnRecord: $('btn-record'),
      btnPlayback: $('btn-playback'),
      recordRow: $('record-row'),
      recordHint: $('record-hint'),
      selfRateRow: $('self-rate-row'),
      btnRateOk: $('btn-rate-ok'),
      btnRateAgain: $('btn-rate-again'),
      btnPronPrev: $('btn-pron-prev'),
      btnPronNext: $('btn-pron-next')
    };

    Store.load();
    Speech.init();
    bind();
    renderHome();
    showView('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
