/**
 * 应用主控 —— 视图路由、交互绑定、状态同步
 */
(function () {
  'use strict';

  var VOCAB = window.VOCAB;
  var Store = window.Store;
  var Quiz = window.Quiz;
  var Speech = window.Speech;
  var Teacher = window.Teacher;

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

  /**
   * 经文引言只取第一句 —— 完整段落会占满手机首屏，
   * 而引言的作用是「点题」，不是全文展示。
   *
   * 中英文标点不同，要分别处理：
   *   英文句号 . ! ?
   *   中文句号 。！？ 以及全角分号 ；
   */
  function shortenVerse(text) {
    if (!text) return '';
    var t = String(text).trim();

    // 先去掉中文引号包裹的引号（「」""），避免影响切分
    var t2 = t.replace(/^[「『""']+|[」』""']+$/g, '');

    // 中英文句末标点都算。
    // 注意两点：
    //   1. 分号不算句末 —— 中文经文用分号连接并列短句，按分号切会得到半句话
    //   2. 标点后不要求跟空白 —— 中文句号后直接接下一个字
    var m = t2.match(/^(.+?[.!?。！？])/);
    var first = m ? m[1] : t2;

    // 过长（没有句末标点）则按字符截断
    if (first.length > 160) {
      first = first.slice(0, 157).replace(/\s+\S*$/, '') + '…';
    }

    // 如果原本有中文引号包裹，保留回来
    var wrapped = /^[「『]/.test(t);
    return wrapped ? '「' + first + '」' : first;
  }

  function fmtTime(sec) {
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ' 分 ' + s + ' 秒';
  }

  /* ============ 视图切换 ============ */

  var VIEWS = ['home', 'quiz', 'result', 'progress', 'wordlist', 'pronounce', 'report', 'teacher'];

  function showView(name) {
    VIEWS.forEach(function (v) {
      var el = $('view-' + v);
      if (el) el.hidden = (v !== name);
    });
    state.view = name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============ 首页 ============ */

  /**
   * 首页渲染：课程列表 + 水平选择 + 题量设置
   *
   * 分层原则（松哥定的）：越初级 → 生词表越长；越高级 → 生词表越短。
   * 所以水平卡片上要直接显示"本层 N 词"，让学生知道选这个水平要背多少。
   */
  function renderHome() {
    renderCourseList();
    renderLevelGrid();
    renderCountSeg();
    renderHeroStats();
    renderWrongCount();
    renderNameBar();
  }

  /** 昵称提示条：没填昵称时显示一行引导 */
  function renderNameBar() {
    if (!els.nameBar) return;
    var id = Store.identity();
    if (id.name) {
      els.nameBar.hidden = false;
      els.nameBarText.textContent = '当前身份：' + id.name;
      els.nameBar.classList.add('done');
      els.btnNameBar.textContent = '改名';
    } else {
      els.nameBar.hidden = false;
      els.nameBarText.textContent = '填个昵称，学习报告就能标识你的成绩';
      els.nameBar.classList.remove('done');
      els.btnNameBar.textContent = '填昵称';
    }
  }

  /** 课程列表 */
  function renderCourseList() {
    var box = els.courseList;
    if (!box) return;
    box.innerHTML = '';

    var lib = window.Course ? window.Course.library : [];
    if (!lib.length) {
      box.innerHTML = '<p class="empty-note">还没有课程。点右上角 🎓 教师模式导入材料生成。</p>';
      els.courseHint.textContent = '无课程';
      return;
    }

    lib.forEach(function (c) {
      var btn = document.createElement('button');
      btn.className = 'course-card' + (c.id === window.Course.activeId ? ' active' : '');
      btn.setAttribute('data-course', c.id);
      var total = c.levelCounts ? (c.levelCounts[0] + c.levelCounts[1] + c.levelCounts[2]) : c.wordCount;
      btn.innerHTML =
        '<span class="c-title">' + esc(c.title) + '</span>' +
        (c.subtitle ? '<span class="c-sub">' + esc(c.subtitle) + '</span>' : '') +
        '<span class="c-meta">共 ' + total + ' 词 · 入门 ' +
        (c.levelCounts ? c.levelCounts[0] : 0) + ' / 进阶 ' +
        (c.levelCounts ? c.levelCounts[1] : 0) + ' / 挑战 ' +
        (c.levelCounts ? c.levelCounts[2] : 0) + '</span>';
      btn.addEventListener('click', function () { selectCourse(c.id); });
      box.appendChild(btn);
    });

    els.courseHint.textContent = lib.length + ' 个课程';
  }

  /** 水平选择卡片 */
  function renderLevelGrid() {
    var box = els.levelGrid;
    if (!box) return;
    box.innerHTML = '';

    var level = Store.getSettings().level;
    var cfgMap = window.Fusion ? window.Fusion.LEVEL_CONFIG : {};

    [0, 1, 2].forEach(function (lv) {
      var cfg = cfgMap[lv] || { label: ['入门', '进阶', '挑战'][lv], desc: '' };
      var count = currentLevelCount(lv);
      var btn = document.createElement('button');
      btn.className = 'level-card' + (lv === level ? ' active' : '');
      btn.setAttribute('data-level', lv);
      btn.innerHTML =
        '<span class="l-top">' +
          '<span class="l-name">' + esc(cfg.label) + '</span>' +
          '<span class="l-count">' + count + ' 词</span>' +
        '</span>' +
        '<span class="l-desc">' + esc(cfg.desc || '') + '</span>' +
        '<span class="l-bar"><i style="width:' + levelBarPct(lv, count) + '%"></i></span>';
      btn.addEventListener('click', function () {
        Store.setSetting('level', lv);
        renderLevelGrid();
        renderCountSeg();
      });
      box.appendChild(btn);
    });
  }

  /** 当前课程某层的词数 */
  function currentLevelCount(lv) {
    var course = window.Course ? window.Course.active() : null;
    if (!course) return 0;
    var n = 0;
    course.words.forEach(function (w) { if (w.level === lv) n++; });
    return n;
  }

  /** 水平条形图宽度：相对最长层 */
  function levelBarPct(lv, count) {
    var max = 0;
    [0, 1, 2].forEach(function (l) { max = Math.max(max, currentLevelCount(l)); });
    if (!max) return 0;
    return Math.round(count / max * 100);
  }

  /** 题量切换 */
  function renderCountSeg() {
    var seg = els.segCount;
    if (!seg) return;
    seg.innerHTML = '';
    var s = Store.getSettings();
    var poolSize = currentLevelCount(s.level) || 1;

    [10, 15, 20].forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'seg-btn' + (s.count === n ? ' active' : '');
      b.textContent = n + ' 题';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () {
        Store.setSetting('count', n);
        renderCountSeg();
      });
      seg.appendChild(b);
    });

    els.countDesc.textContent = '本水平共 ' + poolSize + ' 个生词，随机抽取';
  }

  /** 切换课程 */
  function selectCourse(id) {
    var self = this;
    window.Course.loadCourse(id).then(function () {
      window.Course.activeId = id;
      renderHome();
      toast('已切换到《' + window.Course.activeMeta().title + '》');
    }).catch(function (err) {
      toast('课程加载失败：' + err.message);
    });
  }

  function renderHeroStats() {
    var course = window.Course ? window.Course.active() : null;
    var words = course ? course.words : VOCAB;
    if (!words.length) words = VOCAB;

    // 经文引言：中文在上、英文在下（学习者正好对照）
    var meta = window.Course ? window.Course.activeMeta() : null;
    if (meta) {
      // 中文引言同样只取首句，与英文对齐（引言的作用是点题，不是全文）
      if (meta.quote) els.heroVerse.textContent = shortenVerse(meta.quote);
      els.heroVerseEn.textContent = shortenVerse(meta.quoteEn);
      els.heroVerseEn.hidden = !meta.quoteEn;
      els.heroEyebrow.textContent = meta.reference || meta.subtitle || 'Genesis 1:1–2 CEV';
    }

    var counts = Store.levelCounts(words);
    var mastered = counts.mastered + counts.strong;
    var pct = Math.round(mastered / words.length * 100);
    var totalSeen = 0, totalCorrect = 0;
    words.forEach(function (w) {
      var r = Store.state.words[w.id];
      if (r) { totalSeen += r.seen; totalCorrect += r.correct; }
    });
    var acc = totalSeen ? Math.round(totalCorrect / totalSeen * 100) : 0;

    els.heroStats.innerHTML =
      '<span class="hero-stat"><b>' + mastered + '/' + words.length + '</b>已掌握</span>' +
      '<span class="hero-stat"><b>' + pct + '%</b>熟练度</span>' +
      '<span class="hero-stat"><b>' + acc + '%</b>总正确率</span>' +
      '<span class="hero-stat"><b>' + totalSeen + '</b>累计答题</span>';
  }

  function renderWrongCount() {
    var course = window.Course ? window.Course.active() : null;
    var words = course ? course.words : VOCAB;
    var wrong = Store.wrongList(words);
    var el = $('wrong-count-desc');
    el.textContent = wrong.length ? ('共 ' + wrong.length + ' 个词待复习') : '还没有错题，继续保持';
    var card = document.querySelector('[data-special="wrong"]');
    if (card) card.classList.toggle('disabled', wrong.length === 0);
  }

  /* ============ 答题流程 ============ */

  /**
   * 开始一次融合测试
   * @param {object} opts {count, level, pool, forceSpell}
   */
  function startFusion(opts) {
    opts = opts || {};
    var s = Store.getSettings();
    var course = window.Course ? window.Course.active() : null;

    if (!course) {
      toast('请先选择或导入一个课程');
      return;
    }

    var built = window.Fusion.buildPaper({
      level: opts.level != null ? opts.level : s.level,
      count: opts.count || s.count,
      course: course,
      pool: opts.pool || null,
      forceSpell: opts.forceSpell || null
    });

    Quiz.current = {
      mode: 'fusion',
      modeLabel: '融合测试 · ' + built.config.label,
      difficulty: built.config,
      questions: built.questions,
      index: 0,
      responses: [],
      combo: 0,
      bestCombo: 0,
      startedAt: Date.now(),
      finished: false,
      pool: opts.pool || null,
      forceSpell: opts.forceSpell || null,
      courseId: window.Course.activeId
    };

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
    els.quizDiffLabel.textContent = '第 ' + (session.index + 1) + '/' + session.questions.length + ' 题 · ' +
      session.questions.length + ' 题覆盖全部题型';

    // 题型标签
    els.qKind.textContent = window.Fusion.kindLabel(q.kind);

    // 题干
    els.qPrompt.textContent = q.prompt;
    els.qPrompt.className = 'q-prompt' + (q.kind === 'e2c' ? ' is-word' : '') +
      (q.kind === 'fill' ? ' is-fill' : '');
    els.qSub.textContent = q.subPrompt || '';
    els.qSub.className = 'q-sub' + (q.kind === 'c2e' ? ' is-pos' : '');

    // 听音区
    var isListen = q.kind === 'listen';
    els.listenBox.hidden = !isListen;
    els.btnReplay.hidden = true;
    if (isListen) {
      setTimeout(function () { playQuestionAudio(); }, 260);
    }

    // 选项 / 拼写 / 排序
    els.spellBox.hidden = q.type !== 'spell';
    els.orderBox.hidden = q.type !== 'order';
    els.options.innerHTML = '';
    els.options.hidden = q.type !== 'choice';
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
    } else if (q.type === 'order') {
      renderOrderQuestion(q);
    } else {
      els.spellInput.focus();
    }

    // 提示
    els.hintRow.hidden = false;
    els.btnHint.textContent = '💡 看提示';
    els.btnHint.disabled = false;
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

  /* ============ 句子排序题交互 ============ */

  var orderPicked = [];

  function renderOrderQuestion(q) {
    orderPicked = [];
    els.orderSlots.innerHTML = '';
    els.orderChunks.innerHTML = '';

    q.chunks.forEach(function (chunk, i) {
      var b = document.createElement('button');
      b.className = 'chunk-btn';
      b.textContent = chunk;
      b.setAttribute('data-i', i);
      b.addEventListener('click', function () { pickChunk(i); });
      els.orderChunks.appendChild(b);
    });
  }

  function pickChunk(i) {
    var pickedIdx = orderPicked.indexOf(i);
    if (pickedIdx >= 0) {
      // 取消
      orderPicked.splice(pickedIdx, 1);
      var btn = els.orderChunks.querySelector('[data-i="' + i + '"]');
      if (btn) btn.classList.remove('picked');
    } else {
      orderPicked.push(i);
      var btn2 = els.orderChunks.querySelector('[data-i="' + i + '"]');
      if (btn2) btn2.classList.add('picked');
    }
    renderOrderSlots();
  }

  function renderOrderSlots() {
    var q = Quiz.question();
    if (!q || q.type !== 'order') return;
    els.orderSlots.innerHTML = '';
    orderPicked.forEach(function (chunkIdx, pos) {
      var slot = document.createElement('span');
      slot.className = 'order-slot';
      slot.textContent = (pos + 1) + '. ' + q.chunks[chunkIdx];
      slot.addEventListener('click', function () { pickChunk(chunkIdx); });
      els.orderSlots.appendChild(slot);
    });
    els.btnSubmitOrder.disabled = orderPicked.length !== q.chunks.length;
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
    var res = window.Fusion.grade(q, response);

    // 记录作答
    Quiz.current.responses.push({ question: q, response: response, grade: res });
    if (res.correct) {
      Quiz.current.combo += 1;
      if (Quiz.current.combo > Quiz.current.bestCombo) Quiz.current.bestCombo = Quiz.current.combo;
    } else {
      Quiz.current.combo = 0;
    }

    // 选项态
    if (q.type === 'choice') {
      Array.prototype.forEach.call(els.options.children, function (b) {
        b.disabled = true;
        var txt = b.querySelector('span:last-child').textContent;
        if (txt === q.answer) b.classList.add('correct');
        else if (b === chosenBtn) b.classList.add('wrong');
        else b.classList.add('dimmed');
      });
    } else if (q.type === 'order') {
      els.orderChunks.querySelectorAll('.chunk-btn').forEach(function (b) { b.disabled = true; });
      els.btnSubmitOrder.disabled = true;
      els.orderSlots.querySelectorAll('.order-slot').forEach(function (s) {
        s.classList.add(res.correct ? 'correct' : 'wrong');
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
    var w = currentWord(q.wordId) || {};
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
    var meaningText = (q.kind === 'e2c') ? (q.word + (w.pos ? '　' + w.pos : '')) : (w.meaning || '');
    var meaningLabel = (q.kind === 'e2c') ? '英文' : '释义';

    body += '<div class="fb-line"><span class="fb-label">' + meaningLabel + '</span><span class="fb-text">' + esc(meaningText) + '</span></div>';
    if (w.phonetic) {
      body += '<div class="fb-line"><span class="fb-label">音标</span><span class="fb-text mono">' + esc(w.phonetic) + '</span></div>';
    }
    if (w.example) {
      body += '<div class="fb-line"><span class="fb-label">例句</span><span class="fb-text"><i>' + esc(w.example) + '</i></span></div>';
    }
    if (q.sentence) {
      body += '<div class="fb-line"><span class="fb-label">原句</span><span class="fb-text"><i>' + esc(q.sentence) + '</i></span></div>';
    }
    if (w.tip) {
      body += '<div class="fb-line"><span class="fb-label">提示</span><span class="fb-text">' + esc(w.tip) + '</span></div>';
    }
    if (w.note) {
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

  /** 从当前课程里取词条 */
  function currentWord(id) {
    var course = window.Course ? window.Course.active() : null;
    if (course) {
      for (var i = 0; i < course.words.length; i++) {
        if (course.words[i].id === id) return course.words[i];
      }
    }
    return wordById(id);
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
        var w = currentWord(r.question.wordId) || {};
        var userTxt = r.response;
        var q = r.question;
        var yours;
        if (q.type === 'spell') {
          yours = '你写的：<b>' + esc(userTxt || '(空)') + '</b>';
        } else if (q.type === 'order') {
          yours = '你的顺序：<b>' + esc(Array.isArray(userTxt) ? userTxt.join(' / ') : (userTxt || '')) + '</b>';
        } else {
          yours = '你选的：<b>' + esc(userTxt) + '</b>';
        }
        var noteHtml = w.note ? '<div class="wrong-note">💡 ' + esc(w.note) + '</div>' : '';
        var exampleHtml = w.example ? '<div class="wrong-cn">例句：' + esc(w.example) + '</div>' : '';
        return '<div class="wrong-item">' +
          '<div class="wrong-head">' +
            '<span class="wrong-word">' + esc(w.word || q.word) + '</span>' +
            '<span class="wrong-ipa">' + esc(w.phonetic || '') + '</span>' +
          '</div>' +
          '<div class="wrong-yours">' + yours + '</div>' +
          '<div class="wrong-right">正确答案：<b>' + esc(q.answerDetail) + '</b></div>' +
          '<div class="wrong-cn">中文释义：' + esc(w.meaning || '') + '</div>' +
          exampleHtml +
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

  /** 当前课程的词表（没有课程时退回内置的 17 词） */
  function currentWords() {
    var course = window.Course ? window.Course.active() : null;
    if (course && course.words.length) return course.words;
    return VOCAB;
  }

  function renderProgress() {
    var words = currentWords();
    var counts = Store.levelCounts(words);
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
    var sorted = words.slice().sort(function (a, b) {
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
        '<div class="m-word"><b>' + esc(w.word) + ' <span style="color:var(--text-3);font-weight:400;font-size:12px">' + esc(w.phonetic || '') + '</span></b>' +
          '<small>' + esc(w.meaning || '') + (pron ? ' · ' + pron : '') + '</small></div>' +
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
    var words = currentWords();
    els.wordlistNote.textContent = (window.Course && window.Course.activeMeta()
      ? window.Course.activeMeta().title + ' · 共 ' + words.length + ' 个生词'
      : '共 ' + words.length + ' 个生词') + ' · 点击喇叭听发音';

    els.wordlist.innerHTML = words.map(function (w, i) {
      var lvl = Store.levelOf(w.id);
      var meta = Store.LEVELS[lvl];
      var lvlTag = (w.level != null)
        ? '<span class="wl-tier">T' + (w.level + 1) + '</span>' : '';
      return '<div class="wl-item">' +
        '<span class="wl-num">' + (i + 1) + '</span>' +
        '<div class="wl-body">' +
          '<div class="wl-top">' +
            '<span class="wl-word">' + esc(w.word) + '</span>' +
            '<span class="wl-ipa">' + esc(w.phonetic || '') + '</span>' +
            '<span class="wl-pos">' + esc(w.pos || '') + '</span>' +
            lvlTag +
            '<span class="m-badge" style="background:' + meta.color + '1a;color:' + meta.color + '">' + meta.label + '</span>' +
          '</div>' +
          '<div class="wl-cn">' + esc(w.meaning || '') + '</div>' +
          (w.example ? '<div class="wl-ex"><i>' + esc(w.example) + '</i></div>' : '') +
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
    var words = currentWords();
    if (state.pronIndex >= words.length) state.pronIndex = 0;
    var w = words[state.pronIndex];
    els.pronWord.textContent = w.word;
    els.pronIpa.textContent = w.phonetic || '';
    els.pronMeaning.textContent = (w.meaning || '') + (w.pos ? '　(' + w.pos + ')' : '');
    els.pronExample.innerHTML =
      '<div class="pe-en">' + esc(w.example || '') + '</div>' +
      (w.exampleZh ? '<div class="pe-zh">' + esc(w.exampleZh) + '</div>' : '');

    var syls = w.syllables || (w.word ? window.Teacher.splitSyllables(w.word) : []);
    els.pronSyllables.innerHTML = syls.map(function (s, i) {
      return '<span class="syl" data-i="' + i + '">' + esc(s) + '</span>';
    }).join('');

    // 索引条
    els.pronIndex.innerHTML = words.map(function (x, i) {
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
    var w = currentWords()[state.pronIndex];
    if (!w) return;
    els.btnPronSpeak.classList.add('speaking');
    Speech.speak(w.word, { rate: rate || 0.92 }).then(function () {
      els.btnPronSpeak.classList.remove('speaking');
    });
  }

  function playSyllables() {
    var w = currentWords()[state.pronIndex];
    if (!w) return;
    var syls = w.syllables || (window.Teacher ? window.Teacher.splitSyllables(w.word) : [w.word]);
    var items = syls.map(function (s, i) {
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
    var words = currentWords();
    var w = words[state.pronIndex];
    if (!w) return;
    Store.recordPronounce(w.id, ok);
    els.btnRateOk.classList.toggle('rated', ok);
    els.recordHint.textContent = ok
      ? '👍 已记录：这个词你读准了，继续下一个'
      : '💪 已记录：还会继续练，多听几遍标准音';
    toast(ok ? '已记录 · 读准了' : '已记录 · 还要练');
  }

  /* ============ 教师模式 ============ */

  function renderTeacher() {
    els.teacherStep1.hidden = Teacher.step !== 1;
    els.teacherStep2.hidden = Teacher.step !== 2;
    els.teacherStep3.hidden = Teacher.step !== 3;

    if (Teacher.step === 2) renderTeacherWords();
    if (Teacher.step === 3) renderExportBox();
  }

  /** 步骤 2：三层词表预览 + 校对 */
  function renderTeacherWords() {
    var byLevel = Teacher.selectedByLevel();
    var total = byLevel[0].length + byLevel[1].length + byLevel[2].length;
    var th = window.Lexicon.lastThresholds || {};

    els.teacherSummary.textContent =
      '共 ' + total + ' 个生词（入门 ' + byLevel[0].length +
      ' / 进阶 ' + byLevel[1].length + ' / 挑战 ' + byLevel[2].length +
      '）· 难度门槛 ' + (th.t1 || '-') + ' / ' + (th.t2 || '-') +
      '。点词名可切换分层，点「×」移除该词。';

    var names = ['入门', '进阶', '挑战'];
    els.teacherLevels.innerHTML = byLevel.map(function (list, i) {
      return '<div class="tl-row">' +
        '<span class="tl-name t' + i + '">' + names[i] + '</span>' +
        '<span class="tl-count">' + list.length + ' 词</span>' +
        '<span class="tl-bar"><i class="t' + i + '" style="width:' +
          (total ? Math.round(list.length / total * 100) : 0) + '%"></i></span>' +
      '</div>';
    }).join('');

    var all = [];
    Teacher.layers.forEach(function (list) { list.forEach(function (it) { all.push(it); }); });
    all.sort(function (a, b) { return a.score - b.score; });

    els.teacherWordlist.innerHTML = all.map(function (it) {
      var on = Teacher._selected[it.word];
      return '<div class="tw-item' + (on ? '' : ' off') + '">' +
        '<button class="tw-check" data-act="toggle" data-w="' + esc(it.word) + '">' +
          (on ? '✓' : '＋') + '</button>' +
        '<div class="tw-main">' +
          '<div class="tw-top">' +
            '<span class="tw-word">' + esc(it.word) + '</span>' +
            '<span class="tw-ipa">' + esc(it.info.phonetic || '') + '</span>' +
            '<span class="tw-score">难度 ' + it.score + '</span>' +
          '</div>' +
          '<div class="tw-cn">' + esc(it.info.meaning) + '</div>' +
          (it.sentences && it.sentences[0]
            ? '<div class="tw-ex"><i>' + esc(it.sentences[0]) + '</i></div>' : '') +
        '</div>' +
        '<div class="tw-actions">' +
          [0, 1, 2].map(function (lv) {
            return '<button class="tw-lv t' + lv + (it.level === lv ? ' on' : '') +
              '" data-act="level" data-w="' + esc(it.word) + '" data-lv="' + lv + '">' +
              ['入', '进', '挑'][lv] + '</button>';
          }).join('') +
          '<button class="tw-del" data-act="del" data-w="' + esc(it.word) + '">×</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /** 步骤 3：导出信息 */
  function renderExportBox() {
    var d = Teacher.packageData;
    if (!d) return;
    var size = new Blob([JSON.stringify(d)]).size;
    els.exportBox.innerHTML =
      '<div class="ex-row"><span>课程标题</span><b>' + esc(d.title) + '</b></div>' +
      '<div class="ex-row"><span>生词数</span><b>' + d.words.length + ' 个</b></div>' +
      '<div class="ex-row"><span>句子数</span><b>' + d.sentences.length + ' 条</b></div>' +
      '<div class="ex-row"><span>文件大小</span><b>' + (size / 1024).toFixed(1) + ' KB</b></div>' +
      '<div class="ex-row"><span>文件名</span><b class="mono">' + esc(d.id) + '.json</b></div>';
  }

  /** 教师模式事件绑定 */
  function bindTeacher() {
    // 拖拽上传
    var dz = els.dropZone;
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.add('drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.remove('drag');
      });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (f) handleParse(f, null);
    });
    dz.addEventListener('click', function () { els.filePdf.click(); });
    els.filePdf.addEventListener('change', function () {
      var f = els.filePdf.files[0];
      if (f) handleParse(f, null);
    });

    // 解析
    els.btnParse.addEventListener('click', function () {
      handleParse(null, els.teacherText.value);
    });

    // 词表校对
    els.teacherWordlist.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var w = btn.getAttribute('data-w');
      if (act === 'toggle') {
        Teacher.toggleWord(w);
      } else if (act === 'del') {
        Teacher._selected[w] = false;
      } else if (act === 'level') {
        Teacher.setLevel(w, parseInt(btn.getAttribute('data-lv'), 10));
      }
      renderTeacherWords();
    });

    els.btnTeacherBack.addEventListener('click', function () {
      Teacher.step = 1;
      renderTeacher();
    });

    // 导出
    els.btnTeacherExport.addEventListener('click', function () {
      var meta = {
        title: els.teacherText.value ? els.teacherText.value.split('\n')[0].slice(0, 40) : '新课程',
        subtitle: '教师导入 · ' + new Date().toLocaleDateString('zh-CN')
      };
      var data = Teacher.buildPackage(meta);
      Teacher.step = 3;
      renderTeacher();
      toast('课程包已生成');
    });

    els.btnTeacherDownload.addEventListener('click', function () {
      Teacher.download();
      toast('已下载课程包');
    });

    els.btnTeacherCopy.addEventListener('click', function () {
      Teacher.copy().then(function () {
        toast('已复制到剪贴板');
      }).catch(function (err) {
        toast('复制失败：' + err.message);
      });
    });

    els.btnTeacherPreview.addEventListener('click', function () {
      var data = Teacher.packageData;
      if (!data) return;
      window.Course.saveLocal(data);
      window.Course.activeId = data.id;
      showView('home');
      renderHome();
      toast('已切换到新课程，去首页开始测试吧');
    });
  }

  /** 执行解析 */
  function handleParse(file, text) {
    els.teacherStatus.textContent = '正在解析…';
    els.teacherStatus.className = 'teacher-status busy';
    els.btnParse.disabled = true;

    Teacher.parse(file, text, function (msg) {
      els.teacherStatus.textContent = msg;
    }).then(function () {
      els.teacherStatus.textContent = '';
      els.teacherStatus.className = 'teacher-status';
      els.btnParse.disabled = false;
      Teacher.step = 2;
      renderTeacher();
      toast('已提取生词，请校对');
    }).catch(function (err) {
      els.teacherStatus.textContent = '❌ ' + err.message;
      els.teacherStatus.className = 'teacher-status error';
      els.btnParse.disabled = false;
    });
  }

  /* ============ 阶段报告 ============ */

  function renderReport() {
    var words = currentWords();
    var rep = Store.buildReport(words);
    var id = Store.identity();

    // 身份卡
    els.reportIdentity.innerHTML =
      '<div class="ri-left">' +
        '<span class="ri-avatar">' + esc((id.name || '?').charAt(0).toUpperCase()) + '</span>' +
        '<div class="ri-text">' +
          '<b>' + esc(id.name || '未设置昵称') + '</b>' +
          '<small>' + (id.joinedAt
            ? '加入于 ' + new Date(id.joinedAt).toLocaleDateString('zh-CN')
            : '第一次使用本工具') + '</small>' +
        '</div>' +
      '</div>' +
      '<button class="btn-soft ri-edit" id="btn-edit-name">改昵称</button>';

    var editBtn = document.getElementById('btn-edit-name');
    if (editBtn) {
      editBtn.addEventListener('click', function () { openNameModal(); });
    }

    // 总览
    var deltaHtml = '';
    if (rep.delta != null) {
      var up = rep.delta >= 0;
      deltaHtml = '<span class="rh-delta ' + (up ? 'up' : 'down') + '">' +
        (up ? '↑' : '↓') + ' ' + Math.abs(rep.delta) + '%</span>';
    }
    els.reportHero.innerHTML =
      '<div class="rh-item"><div class="rh-num">' + rep.totalTests + '</div><div class="rh-label">完成测试</div></div>' +
      '<div class="rh-item"><div class="rh-num">' + (rep.overallAccuracy ? rep.overallAccuracy + '%' : '—') + deltaHtml + '</div><div class="rh-label">平均正确率</div></div>' +
      '<div class="rh-item"><div class="rh-num">' + rep.mastery.mastered + '</div><div class="rh-label">已掌握词</div></div>' +
      '<div class="rh-item"><div class="rh-num">' +
        (rep.pronunciation.total ? Math.round(rep.pronunciation.ok / rep.pronunciation.total * 100) + '%' : '—') +
        '</div><div class="rh-label">跟读准确</div></div>';

    // 评价
    els.reportComment.innerHTML =
      '<p class="rc-main">' + esc(rep.comment) + '</p>' +
      '<p class="rc-sub">' + esc(rep.suggestion) + '</p>';

    // 趋势图
    renderTrend(rep.trend);

    // 掌握度
    var labels = { new: '未练习', weak: '生疏', learning: '巩固中', strong: '熟悉', mastered: '已掌握' };
    var colors = { new: '#94a3b8', weak: '#b8503f', learning: '#c08a2e', strong: '#4a7fb5', mastered: '#3f7d52' };
    els.reportMastery.innerHTML = Store.LEVEL_ORDER.map(function (k) {
      return '<div class="ms-item">' +
        '<div class="ms-num" style="color:' + colors[k] + '">' + rep.mastery[k] + '</div>' +
        '<div class="ms-label">' + labels[k] + '</div>' +
      '</div>';
    }).join('');

    // 弱项
    els.reportWeakHint.textContent = rep.weak.length ? (rep.weak.length + ' 个词需要加强') : '';
    if (rep.weak.length) {
      els.reportWeak.innerHTML = rep.weak.slice(0, 12).map(function (w) {
        return '<div class="rw-item">' +
          '<div class="rw-main">' +
            '<div class="rw-top">' +
              '<span class="rw-word">' + esc(w.word) + '</span>' +
              '<span class="rw-ipa">' + esc(w.phonetic) + '</span>' +
              '<span class="rw-acc">' + Math.round(w.accuracy * 100) + '%</span>' +
            '</div>' +
            '<div class="rw-cn">' + esc(w.meaning) + '</div>' +
          '</div>' +
          '<div class="rw-stat">' + w.correct + '/' + w.seen + '</div>' +
        '</div>';
      }).join('');
    } else if (rep.totalTests) {
      els.reportWeak.innerHTML = '<div class="rw-empty">👍 目前没有反复出错的词，保持住！</div>';
    } else {
      els.reportWeak.innerHTML = '<div class="rw-empty">做完测试后这里会列出需要加强的词</div>';
    }

    // 建议
    var sug = [];
    if (rep.weak.length) {
      sug.push('优先复习这 ' + Math.min(5, rep.weak.length) + ' 个词：' +
        rep.weak.slice(0, 5).map(function (w) { return w.word; }).join('、'));
    }
    if (rep.untouched.length) {
      sug.push('还有 ' + rep.untouched.length + ' 个词没练过：' +
        rep.untouched.slice(0, 5).map(function (w) { return w.word; }).join('、') +
        (rep.untouched.length > 5 ? ' 等' : ''));
    }
    if (rep.notMastered.length) {
      sug.push('已练过但还没掌握牢的：' +
        rep.notMastered.slice(0, 5).map(function (w) { return w.word; }).join('、'));
    }
    if (rep.pronunciation.total && rep.pronunciation.ok / rep.pronunciation.total < 0.7) {
      sug.push('跟读准确率偏低，建议每天花两分钟练发音');
    }
    if (!sug.length) {
      sug.push(rep.totalTests ? '目前状态很好，可以挑战更高水平了' : '先做一次测试，这里就会给出针对性建议');
    }
    els.reportSuggest.innerHTML = sug.map(function (s, i) {
      return '<div class="sg-item"><span class="sg-num">' + (i + 1) + '</span><span>' + esc(s) + '</span></div>';
    }).join('');
  }

  /** 成绩趋势图（纯 CSS 条形） */
  function renderTrend(trend) {
    var box = els.reportTrend;
    if (!trend.length) {
      box.innerHTML = '<div class="rw-empty">还没有测试记录</div>';
      return;
    }
    var max = 100;
    box.innerHTML = trend.slice(-12).map(function (t, i, arr) {
      var d = new Date(t.at);
      var label = (d.getMonth() + 1) + '/' + d.getDate();
      var h = Math.max(4, t.accuracy);
      var cls = t.accuracy >= 80 ? 'good' : (t.accuracy >= 60 ? 'mid' : 'low');
      return '<div class="tr-item">' +
        '<div class="tr-bar ' + cls + '" style="height:' + h + '%">' +
          '<span class="tr-val">' + t.accuracy + '%</span>' +
        '</div>' +
        '<span class="tr-label">' + label + '</span>' +
      '</div>';
    }).join('');
  }

  /** 昵称弹窗 */
  function openNameModal(onSaved) {
    els.nameInput.value = Store.identity().name || '';
    els.nameModal.hidden = false;
    els._nameOnSaved = onSaved || null;
    setTimeout(function () { els.nameInput.focus(); }, 100);
  }

  function saveName() {
    var v = els.nameInput.value.trim();
    if (!v) {
      els.nameInput.classList.add('shake');
      setTimeout(function () { els.nameInput.classList.remove('shake'); }, 400);
      return;
    }
    Store.setName(v);
    els.nameModal.hidden = true;
    toast('已记下你的名字：' + v);
    var cb = els._nameOnSaved;
    els._nameOnSaved = null;
    if (cb) cb();
    else if (state.view === 'report') renderReport();
  }

  /* ============ 事件绑定 ============ */

  function bind() {
    // 首页：开始测试
    els.btnStart.addEventListener('click', function () {
      startFusion();
    });

    document.querySelector('[data-special="wrong"]').addEventListener('click', function () {
      var wrong = Store.wrongList(currentWords());
      if (!wrong.length) { toast('还没有错题，先做一次测试吧'); return; }
      startFusion({
        pool: wrong,
        count: Math.min(wrong.length, Store.getSettings().count)
      });
    });

    document.querySelector('[data-special="pronounce"]').addEventListener('click', function () {
      state.pronIndex = 0;
      renderPronounce();
      showView('pronounce');
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
    els.btnSubmitOrder.addEventListener('click', function () {
      if (answered) return;
      var q = Quiz.question();
      if (!q || q.type !== 'order') return;
      if (orderPicked.length !== q.chunks.length) {
        toast('请把所有片段都排好');
        return;
      }
      submitAnswer(orderPicked.map(function (i) { return q.chunks[i]; }), null);
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
      var s = Quiz.current;
      if (!s) { showView('home'); renderHome(); return; }
      startFusion({
        count: s.questions.length,
        level: s.difficulty.level,
        pool: s.pool,
        forceSpell: s.forceSpell
      });
    });
    els.btnReviewWrong.addEventListener('click', function () {
      if (!state.lastWrongIds.length) { toast('没有错题可复习'); return; }
      var ids = {};
      state.lastWrongIds.forEach(function (id) { ids[id] = true; });
      var pool = currentWords().filter(function (w) { return ids[w.id]; });
      startFusion({ pool: pool, count: pool.length, forceSpell: ids });
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

    // 阶段报告
    els.btnReport.addEventListener('click', function () {
      if (!Store.hasIdentity()) {
        // 还没填昵称 —— 先问，报告要用它标识
        openNameModal(function () { renderReport(); showView('report'); });
        return;
      }
      renderReport();
      showView('report');
    });
    els.btnCloseReport.addEventListener('click', function () {
      showView('home'); renderHome();
    });
    els.btnExportProfile.addEventListener('click', function () {
      var text = Store.exportProfile();
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var nm = (Store.identity().name || 'student').replace(/[^\w一-龥-]/g, '');
      a.href = url;
      a.download = 'learning-profile-' + nm + '-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('学习档案已下载，发给老师即可');
    });
    els.btnCopyProfile.addEventListener('click', function () {
      var text = Store.exportProfile();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast('已复制到剪贴板');
        }).catch(function () { toast('复制失败，请用下载方式'); });
      } else {
        toast('当前浏览器不支持复制，请用下载方式');
      }
    });

    // 昵称
    els.nameSave.addEventListener('click', saveName);
    els.nameSkip.addEventListener('click', function () {
      els.nameModal.hidden = true;
      els._nameOnSaved = null;
    });
    els.nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveName(); }
    });
    els.btnNameBar.addEventListener('click', function () {
      openNameModal(function () { renderNameBar(); });
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
      var words = currentWords();
      state.pronIndex = (state.pronIndex - 1 + words.length) % words.length;
      renderPronounce();
    });
    els.btnPronNext.addEventListener('click', function () {
      var words = currentWords();
      state.pronIndex = (state.pronIndex + 1) % words.length;
      renderPronounce();
    });

    // 教师模式
    els.btnTeacher.addEventListener('click', function () {
      showView('teacher');
      renderTeacher();
    });
    els.btnCloseTeacher.addEventListener('click', function () {
      showView('home'); renderHome();
    });
    bindTeacher();
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
      courseList: $('course-list'),
      courseHint: $('course-hint'),
      levelGrid: $('level-grid'),
      segCount: $('seg-count'),
      countDesc: $('count-desc'),
      btnStart: $('btn-start'),
      wordlistNote: $('wordlist-note'),
      orderBox: $('order-box'),
      orderSlots: $('order-slots'),
      orderChunks: $('order-chunks'),
      btnSubmitOrder: $('btn-submit-order'),
      btnTeacher: $('btn-teacher'),
      btnCloseTeacher: $('btn-close-teacher'),
      teacherStep1: $('teacher-step-1'),
      teacherStep2: $('teacher-step-2'),
      teacherStep3: $('teacher-step-3'),
      dropZone: $('drop-zone'),
      filePdf: $('file-pdf'),
      teacherText: $('teacher-text'),
      btnParse: $('btn-parse'),
      teacherStatus: $('teacher-status'),
      teacherSummary: $('teacher-summary'),
      teacherLevels: $('teacher-levels'),
      teacherWordlist: $('teacher-wordlist'),
      btnTeacherBack: $('btn-teacher-back'),
      btnTeacherExport: $('btn-teacher-export'),
      btnTeacherDownload: $('btn-teacher-download'),
      btnTeacherCopy: $('btn-teacher-copy'),
      btnTeacherPreview: $('btn-teacher-preview'),
      exportBox: $('export-box'),
      heroStats: $('hero-stats'),
      heroVerse: $('hero-verse'),
      heroVerseEn: $('hero-verse-en'),
      heroEyebrow: $('hero-eyebrow'),
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
      btnReport: $('btn-report'),
      btnCloseReport: $('btn-close-report'),
      reportIdentity: $('report-identity'),
      reportHero: $('report-hero'),
      reportComment: $('report-comment'),
      reportTrend: $('report-trend'),
      reportMastery: $('report-mastery'),
      reportWeak: $('report-weak'),
      reportWeakHint: $('report-weak-hint'),
      reportSuggest: $('report-suggest'),
      btnExportProfile: $('btn-export-profile'),
      btnCopyProfile: $('btn-copy-profile'),
      nameModal: $('name-modal'),
      nameInput: $('name-input'),
      nameSave: $('name-save'),
      nameSkip: $('name-skip'),
      nameBar: $('name-bar'),
      nameBarText: $('name-bar-text'),
      btnNameBar: $('btn-name-bar'),
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
    showView('home');

    // 加载课程库（异步，首屏先用内置 17 词兜底）
    // 兜底课程按人工分好的难度分层，保证「入门词数 > 进阶 > 挑战」成立
    var TIERS = [
      ['god', 'form', 'life', 'move', 'earth', 'water', 'create', 'spirit'],
      ['barren', 'moving', 'ocean', 'darkness', 'heaven'],
      ['beginning', 'created', 'roaring', 'heavens']
    ];
    var tierOf = {};
    TIERS.forEach(function (list, lv) {
      list.forEach(function (w) { tierOf[w] = lv; });
    });

    var fallbackCourse = {
      id: 'genesis-1-1-2',
      title: '创世记 1:1–2',
      subtitle: 'CEV · Genesis 1:1-2',
      reference: 'Genesis 1:1-2 (CEV)',
      quote: '「起初，神创造了诸天和大地。大地空荒，毫无生命的形态；是被咆哮的海洋覆盖着的黑暗。但神的灵在水面上运行。」',
      quoteEn: 'In the beginning God created the heavens and the earth. The earth was barren, with no form of life; it was under a roaring ocean covered with darkness. But the Spirit of God was moving over the water.',
      words: VOCAB.map(function (w) {
        return {
          id: w.id, word: w.word, phonetic: w.phonetic, meaning: w.meaning,
          pos: w.pos, level: tierOf[w.word] != null ? tierOf[w.word] : 0, score: 0,
          distractors: w.enDistractors || [], cnDistractors: w.cnDistractors || [],
          example: w.example, exampleZh: w.exampleZh, tip: w.tip, note: w.note,
          syllables: w.syllables || []
        };
      }),
      sentences: []
    };
    window.Course.saveLocal(fallbackCourse);

    window.Course.loadLibrary().then(function () {
      renderHome();
    }).catch(function () {
      // 没有 courses/index.json 时用内置课程，不报错
      els.courseHint.textContent = '内置课程';
      renderHome();
    });

    renderHome();

    // 昵称不主动打断：只在学生打开「学习报告」时若还没设置，才提示一次。
    // 理由：首次进入就弹窗会挡住页面，用户还没做任何事就被要求填名字，体验差。
    // 想主动填昵称的，首页顶部有一条轻提示可点。
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
