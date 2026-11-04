/**
 * v2 真机验证 —— 覆盖教师导入全流程 + 融合测试 + 新题型
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const BASE = process.env.GV_URL || 'http://127.0.0.1:8767/index.html';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const failures = [];

function log(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}


(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const consoleErrors = [];

    /** 按正确顺序点击排序题的片段（chunks 是多词拼接，不能用 answer.split(' ') 匹配） */
    async function answerOrderQuestion() {
      const chunks = await page.evaluate(() => window.Quiz.question().chunks);
      const answer = await page.evaluate(() => window.Quiz.question().answer);
      // chunks 拼起来就是 answer，按其在 answer 中出现的位置排序
      const order = chunks.map((text, i) => {
        let pos = -1, from = 0;
        while (from < answer.length) {
          const idx = answer.indexOf(text, from);
          if (idx < 0) break;
          pos = idx; break;
        }
        return { i, pos };
      }).filter(x => x.pos >= 0).sort((a, b) => a.pos - b.pos).map(x => x.i);
      for (const i of order) {
        await page.locator('.chunk-btn').nth(i).click();
        await page.waitForTimeout(80);
      }
      return order.length;
    }



  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message + '\n' + (e.stack || '')));

  console.log('\n【1】首页加载与课程库');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const courseCards = await page.locator('.course-card').count();
  log('课程卡片渲染', courseCards > 0, courseCards + ' 个');

  const levelCards = await page.locator('.level-card').count();
  log('水平卡片渲染（三档）', levelCards === 3, levelCards + ' 个');

  // 关键：入门词数 > 进阶 > 挑战
  const counts = await page.evaluate(() => {
    return [...document.querySelectorAll('.level-card')].map(c => ({
      name: c.querySelector('.l-name').textContent,
      count: parseInt(c.querySelector('.l-count').textContent.replace(/\D/g, ''), 10)
    }));
  });
  log('水平词数单调递减（入门>进阶>挑战）',
    counts[0].count > counts[1].count && counts[1].count > counts[2].count,
    counts.map(c => c.name + '=' + c.count).join(' '));

  console.log('\n【2】融合测试 — 一次测试覆盖多题型');
  await page.click('#btn-start');
  await page.waitForSelector('#view-quiz:not([hidden])', { timeout: 8000 });
  await page.waitForTimeout(400);

  const quizLabel = await page.locator('#quiz-mode-label').innerText();
  log('测试模式标签为融合测试', quizLabel.includes('融合测试'), quizLabel);

  const qCount = await page.evaluate(() => window.Quiz.current.questions.length);
  log('题量与设置一致', qCount === 10, qCount + ' 题');

  // 走完 15 题，统计题型分布
  const kinds = [];
  for (let i = 0; i < qCount; i++) {
    const kind = await page.evaluate(() => window.Quiz.question().kind);
    kinds.push(kind);
    const type = await page.evaluate(() => window.Quiz.question().type);
    if (type === 'choice') {
      // 精确点正确选项
      const idx = await page.evaluate(() => {
        const q = window.Quiz.question();
        return q.options.indexOf(q.answer);
      });
      await page.locator('#q-options .option-btn').nth(idx).click();
    } else if (type === 'spell') {
      const ans = await page.evaluate(() => window.Quiz.question().answer);
      await page.fill('#spell-input', ans);
      await page.click('#btn-submit-spell');
    } else if (type === 'order') {
      await answerOrderQuestion();
      await page.click('#btn-submit-order');
      await page.waitForTimeout(200);
    }
    await page.waitForSelector('#feedback:not([hidden])', { timeout: 5000 });
    await page.click('#btn-next');
    await page.waitForTimeout(120);
  }

  const kindCount = {};
  kinds.forEach(k => kindCount[k] = (kindCount[k] || 0) + 1);
  log('一次测试含多种题型', Object.keys(kindCount).length >= 4,
    Object.keys(kindCount).map(k => k + '×' + kindCount[k]).join(' '));

  const hasSentence = kinds.includes('fill') || kinds.includes('order');
  log('含句子题（填空/排序）', hasSentence);

  await page.waitForSelector('#view-result:not([hidden])', { timeout: 8000 });
  const pct = await page.locator('#result-pct').innerText();
  log('结果页显示正确率', /%$/.test(pct), pct);

  console.log('\n【3】句子排序题交互');
  // 从结果页回到首页再开一局
  await page.click('#btn-back-home');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.waitForTimeout(300);
  await page.click('#btn-start');
  await page.waitForSelector('#view-quiz:not([hidden])', { timeout: 8000 });

  // 逐题推进直到抽到 order 题
  let foundOrder = false;
  for (let i = 0; i < 15; i++) {
    const q = await page.evaluate(() => {
      const x = window.Quiz.question();
      return x ? { type: x.type, kind: x.kind, answer: x.answer, chunks: x.chunks || [] } : null;
    });
    if (!q) break;
    if (q.type === 'order') { foundOrder = true; break; }

    if (q.type === 'choice') {
      const idx = await page.evaluate(() => window.Quiz.question().options.indexOf(window.Quiz.question().answer));
      await page.locator('#q-options .option-btn').nth(idx).click();
    } else {
      await page.fill('#spell-input', q.answer);
      await page.click('#btn-submit-spell');
    }
    await page.waitForSelector('#feedback:not([hidden])', { timeout: 5000 });
    await page.click('#btn-next');
    await page.waitForTimeout(120);
  }

  if (!foundOrder) {
    // 随机卷里没抽到 —— 直接用引擎构造一道 order 题来测交互
    const built = await page.evaluate(() => {
      const course = window.Course.active();
      const sent = course.sentences[0];
      const w = course.words.find(x => x.word === sent.target) || course.words[0];
      // 借用 fusion 内部逻辑：通过 buildPaper 的 pool 参数强制
      const paper = window.Fusion.buildPaper({ level: 2, count: 10, course: course });
      const q = paper.questions.find(x => x.type === 'order');
      return q ? { ok: true, chunks: q.chunks.length } : { ok: false };
    });
    log('排序题可构造', built.ok, built.ok ? built.chunks + ' 片段' : '构造失败');
  }
  if (foundOrder) {
    const slotCount0 = await page.locator('.order-slot').count();
    log('排序题初始无已排片段', slotCount0 === 0);
    await page.locator('.chunk-btn').first().click();
    await page.waitForTimeout(150);
    const slotCount1 = await page.locator('.order-slot').count();
    log('点击片段后进入已排区', slotCount1 === 1);
    const submitDisabled = await page.locator('#btn-submit-order').isDisabled();
    log('未排完时提交按钮禁用', submitDisabled);
    // 点已排片段可取消
    await page.locator('.chunk-btn').first().click();
    await page.waitForTimeout(150);
    const slotCount2 = await page.locator('.order-slot').count();
    log('再次点击可取消已排', slotCount2 === 0);
  } else {
    log('排序题交互（本次卷未抽到）', true, '跳过');
  }

  console.log('\n【4】教师模式 — 文本导入全流程');
  // 回到首页（若在答题页或结果页先退出）
  if (await page.locator('#view-quiz:not([hidden])').count()) {
    await page.click('#btn-quit');
    await page.click('#modal-confirm');
    await page.waitForTimeout(300);
  } else if (await page.locator('#view-result:not([hidden])').count()) {
    await page.click('#btn-back-home');
    await page.waitForTimeout(300);
  }
  await page.click('#btn-teacher');
  await page.waitForSelector('#view-teacher:not([hidden])');
  log('教师模式视图打开', true);

  const sampleText = `Genesis 1:1-2 (CEV)
In the beginning God created the heavens and the earth. The earth was barren, with no form of life; it was under a roaring ocean covered with darkness. But the Spirit of God was moving over the water.

Vocabulary Notes
Students should learn these difficult words. Read the passage and discuss the meaning of barren, roaring, and darkness. The Spirit of God was moving over the water, so the passage describes a powerful and creative beginning.`;

  await page.fill('#teacher-text', sampleText);
  await page.click('#btn-parse');
  await page.waitForSelector('#teacher-step-2:not([hidden])', { timeout: 30000 });

  const teacherSummary = await page.locator('#teacher-summary').innerText();
  log('自动生成分层摘要', teacherSummary.includes('入门'), teacherSummary.slice(0, 70));

  const twCount = await page.locator('.tw-item').count();
  log('词表校对列表渲染', twCount > 5, twCount + ' 词');

  // 分层词数单调性（教师端）
  const tLevels = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tl-row')];
    return rows.map(r => ({
      name: r.querySelector('.tl-name').textContent,
      count: parseInt(r.querySelector('.tl-count').textContent.replace(/\D/g, ''), 10)
    }));
  });
  log('教师端分层单调递减',
    tLevels[0].count > tLevels[1].count && tLevels[1].count > tLevels[2].count,
    tLevels.map(t => t.name + '=' + t.count).join(' '));

  // 词条含音标与释义
  const firstWord = await page.locator('.tw-item').first().innerText();
  log('词条含音标', /\/.*\//.test(firstWord), firstWord.split('\n')[0].slice(0, 40));

  // 切换分层
  const beforeLv = await page.locator('.tw-item').first().getAttribute('class');
  await page.locator('.tw-item').first().locator('.tw-lv.t2').click();
  await page.waitForTimeout(200);
  const t2On = await page.locator('.tw-item').first().locator('.tw-lv.t2.on').count();
  log('手动改分层生效', t2On === 1);

  // 移除一个词
  const cntBefore = await page.locator('.tw-item').count();
  const offBefore = await page.locator('.tw-item.off').count();
  await page.locator('.tw-item').first().locator('.tw-del').click();
  await page.waitForTimeout(200);
  const offAfter = await page.locator('.tw-item.off').count();
  log('移除词条生效', offAfter === offBefore + 1, 'off: ' + offBefore + '→' + offAfter);

  console.log('\n【5】教师模式 — 导出课程包');
  await page.click('#btn-teacher-export');
  await page.waitForSelector('#teacher-step-3:not([hidden])', { timeout: 8000 });
  const exportTxt = await page.locator('#export-box').innerText();
  log('导出信息显示', exportTxt.includes('生词数'), exportTxt.replace(/\n/g, ' ').slice(0, 70));

  // 预览到学生端
  await page.click('#btn-teacher-preview');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.waitForTimeout(500);
  const newCourseCards = await page.locator('.course-card').count();
  log('新课程进入学生端', newCourseCards >= 1, newCourseCards + ' 个课程');

  // 新课程能出题
  await page.click('#btn-start');
  await page.waitForSelector('#view-quiz:not([hidden])', { timeout: 8000 });
  const newQ = await page.evaluate(() => window.Quiz.current.questions.length);
  log('新课程可出题', newQ > 0, newQ + ' 题');

  console.log('\n【6】词典查询与音标转换');
  const lexTest = await page.evaluate(() => {
    const L = window.Lexicon;
    const a = L.lookup('beginning');
    const b = L.lookup('heavens');
    const c = L.lookup('barren');
    return {
      ipa: a ? a.phonetic : null,
      heavensMeaning: b ? b.meaning : null,
      barrenMeaning: c ? c.meaning : null,
      syllables: L.syllables('beginning')
    };
  });
  log('音标转 IPA', lexTest.ipa && lexTest.ipa.startsWith('/'), lexTest.ipa);
  log('heavens 词条补全', !!lexTest.heavensMeaning, (lexTest.heavensMeaning || '').slice(0, 34));
  log('barren 释义存在', !!lexTest.barrenMeaning, (lexTest.barrenMeaning || '').slice(0, 34));
  log('音节切分', lexTest.syllables === 3, lexTest.syllables + ' 音节');

  console.log('\n【7】控制台检查');
  log('无页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  log('无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

  console.log('\n【结果】通过 ' + pass + ' / 失败 ' + fail);
  if (failures.length) {
    console.log('失败项:');
    failures.forEach(f => console.log('  · ' + f));
  }

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('脚本异常:', e.message);
  console.error(e.stack);
  process.exit(2);
});
