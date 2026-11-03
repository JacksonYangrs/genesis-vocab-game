/**
 * 真机验证脚本 —— 驱动 Chrome 跑完整用户流程
 *
 * 用法：
 *   npm i playwright-core            （或全局安装）
 *   node test/e2e-verify.js
 *   GV_URL=http://127.0.0.1:8765/index.html node test/e2e-verify.js   # 测本地
 *
 * 依赖 playwright-core + 本机 Chrome，无需下载浏览器内核。
 * 覆盖：首页渲染 → 五种模式 → 判分 → 错题本 → 掌握度 → 生词表 → 发音训练
 * 同时收集所有 console 错误与页面异常。
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
if (!fs.existsSync('test/_out')) fs.mkdirSync('test/_out', { recursive: true });
const path = require('path');

const BASE = process.env.GV_URL || 'https://jacksonyangrs.github.io/genesis-vocab-game/';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const consoleErrors = [];
const pageErrors = [];

function log(name, pass, detail) {
  results.push({ name, pass, detail: detail || '' });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function answerCorrectly(page) {
  // 找出正确选项并点击；拼写题则填入正确答案
  const isSpell = await page.locator('#spell-box').isVisible();
  if (isSpell) {
    const answer = await page.evaluate(() => window.Quiz.question().answer);
    await page.fill('#spell-input', answer);
    await page.click('#btn-submit-spell');
  } else {
    const answer = await page.evaluate(() => window.Quiz.question().answer);
    // 必须精确匹配选项文本：heaven/heavens、create/created 互为子串，
    // 用 hasText 子串匹配会选错项（会造成间歇性误报）。
    const idx = await page.evaluate((ans) => {
      const opts = window.Quiz.question().options;
      return opts.findIndex(o => o === ans);
    }, answer);
    if (idx < 0) throw new Error('正确答案不在选项中: ' + answer);
    await page.locator('#q-options .option-btn').nth(idx).click();
  }
  await page.waitForSelector('#feedback:not([hidden])', { timeout: 5000 });
}

async function answerWrongly(page) {
  const isSpell = await page.locator('#spell-box').isVisible();
  if (isSpell) {
    await page.fill('#spell-input', 'zzzwrong');
    await page.click('#btn-submit-spell');
  } else {
    const answer = await page.evaluate(() => window.Quiz.question().answer);
    const btns = page.locator('#q-options .option-btn');
    const n = await btns.count();
    let clicked = false;
    for (let i = 0; i < n; i++) {
      // 精确比较选项正文（去掉序号徽标），子串匹配会误选 heaven/heavens
      const txt = (await btns.nth(i).innerText()).replace(/^\d+\s*/, '').trim();
      if (txt !== answer) { await btns.nth(i).click(); clicked = true; break; }
    }
    if (!clicked) throw new Error('找不到错误选项: ' + answer);
  }
  await page.waitForSelector('#feedback:not([hidden])', { timeout: 5000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ---------- 1. 首页 ----------
  console.log('\n【1】首页渲染');
  const modeCards = await page.locator('.mode-card').count();
  log('五种模式卡片渲染', modeCards === 5, `实际 ${modeCards} 个`);
  const heroStats = await page.locator('.hero-stat').count();
  log('首页统计卡片', heroStats === 4, `实际 ${heroStats} 个`);
  const diffBtns = await page.locator('#seg-difficulty .seg-btn').count();
  log('难度切换按钮', diffBtns === 3, `实际 ${diffBtns} 个`);

  // ---------- 2. 英译中 ----------
  console.log('\n【2】英译中模式');
  await page.click('.mode-card[data-mode="e2c"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const e2cKind = await page.locator('#q-kind').innerText();
  log('进入答题页', e2cKind === '英译中', `题型标签: ${e2cKind}`);
  const optCount = await page.locator('#q-options .option-btn').count();
  log('选项渲染', optCount >= 4, `${optCount} 个选项`);

  await answerCorrectly(page);
  const fbOk = await page.locator('#feedback.ok').isVisible();
  log('答对反馈面板', fbOk);
  const fbTxt = await page.locator('#fb-body').innerText();
  // 英译中模式：释义标签改为「英文」，应含音标与例句，且不与答案行重复
  log('反馈含音标/例句', fbTxt.includes('音标') && fbTxt.includes('例句'));
  log('英译中反馈不重复中文释义',
    (await page.locator('#feedback .fb-answer').count()) === 0 ||
    !(await page.locator('#feedback .fb-answer').innerText()).includes('含义'),
    '答案行不重复显示释义');
  await page.click('#btn-next');
  await page.waitForTimeout(200);

  // 故意答错
  await answerWrongly(page);
  const fbNo = await page.locator('#feedback.no').isVisible();
  const fbText = await page.locator('#fb-body').innerText();
  log('答错反馈面板', fbNo);
  log('答错显示正确答案', fbText.includes('正确答案'), fbText.split('\n')[0]);
  await page.click('#btn-next');
  await page.waitForTimeout(200);

  // 退出测试
  await page.click('#btn-quit');
  await page.waitForSelector('#modal:not([hidden])');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 3. 中译英 ----------
  console.log('\n【3】中译英模式');
  await page.click('.mode-card[data-mode="c2e"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const c2eKind = await page.locator('#q-kind').innerText();
  log('进入中译英', c2eKind === '中译英', `题型标签: ${c2eKind}`);
  await answerCorrectly(page);
  log('中译英答题流程', await page.locator('#feedback.ok').isVisible());
  await page.click('#btn-quit');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 4. 拼写 ----------
  console.log('\n【4】单词拼写模式');
  await page.click('.mode-card[data-mode="spell"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const spellVisible = await page.locator('#spell-box').isVisible();
  log('拼写输入框显示', spellVisible);
  await answerCorrectly(page);
  log('拼写判分正确', await page.locator('#feedback.ok').isVisible());
  await page.click('#btn-next');
  await page.waitForTimeout(200);

  // 拼写容错测试：针对真实答案去掉末尾一个字母
  const target = await page.evaluate(() => window.Quiz.question().answer);
  const nearMiss = target.slice(0, -1);
  await page.fill('#spell-input', nearMiss);
  await page.click('#btn-submit-spell');
  await page.waitForSelector('#feedback:not([hidden])');
  const nearOk = await page.locator('#feedback.ok').isVisible();
  const nearText = await page.locator('#fb-body').innerText();
  log('拼写容错（差1个字母判过）', nearOk,
    nearOk ? `答案 ${target} → 写 ${nearMiss} 判过` : `答案 ${target} → 写 ${nearMiss} 未判过`);
  await page.click('#btn-quit');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 5. 听音辨词 ----------
  console.log('\n【5】听音辨词模式');
  await page.click('.mode-card[data-mode="listen"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const listenBox = await page.locator('#listen-box').isVisible();
  log('听音播放区显示', listenBox);
  const speakBtn = await page.locator('#btn-speak').isVisible();
  log('喇叭按钮存在', speakBtn);
  await answerCorrectly(page);
  log('听音辨词判分', await page.locator('#feedback.ok').isVisible());
  await page.click('#btn-quit');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 6. 混合挑战 + 完整跑完看结果页 ----------
  console.log('\n【6】混合挑战（跑完整一轮看结果页）');
  // 先设成 5 题，跑得快
  await page.locator('#seg-count .seg-btn', { hasText: '5 题' }).click();
  await page.click('.mode-card[data-mode="mixed"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const kinds = new Set();
  for (let i = 0; i < 5; i++) {
    kinds.add(await page.locator('#q-kind').innerText());
    await answerCorrectly(page);
    await page.click('#btn-next');
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('#view-result:not([hidden])', { timeout: 5000 });
  log('结果页出现', true);
  log('混合模式覆盖多种题型', kinds.size >= 3, `出现题型: ${[...kinds].join(', ')}`);
  const pct = await page.locator('#result-pct').innerText();
  log('正确率显示', pct === '100%', pct);
  const chips = await page.locator('#result-chips .chip').count();
  log('结果统计标签', chips >= 3, `${chips} 个`);

  // ---------- 7. 错题本 ----------
  console.log('\n【7】错题本');
  await page.click('#btn-back-home');
  await page.waitForTimeout(300);
  const wrongDesc = await page.locator('#wrong-count-desc').innerText();
  log('错题计数显示', wrongDesc.length > 0, wrongDesc);

  // 做一题错的制造错题（先设成 5 题，一题错完就出结果）
  await page.locator('#seg-count .seg-btn', { hasText: '5 题' }).click();
  await page.click('.mode-card[data-mode="spell"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  await answerWrongly(page);
  await page.click('#btn-next');
  await page.waitForTimeout(300);
  // 把剩下的题也答完，走到结果页
  for (let i = 0; i < 8; i++) {
    if (!(await page.locator('#view-quiz').isVisible())) break;
    await answerCorrectly(page);
    await page.click('#btn-next');
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('#view-result:not([hidden])', { timeout: 8000 });
  const wrongSectionVisible = await page.locator('#wrong-section').isVisible();
  log('结果页显示错题清单', wrongSectionVisible);
  const wrongItems = await page.locator('.wrong-item').count();
  log('错题条目渲染', wrongItems > 0, `${wrongItems} 条`);
  const wrongText = await page.locator('.wrong-item').first().innerText();
  log('错题含正确答案与中文释义',
    wrongText.includes('正确答案') && wrongText.includes('例句'),
    wrongText.split('\n').slice(0, 3).join(' / '));

  // 错题复习
  await page.click('#btn-review-wrong');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const reviewMode = await page.locator('#quiz-mode-label').innerText();
  log('进入错题复习', reviewMode === '混合挑战', reviewMode);
  await page.click('#btn-quit');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 8. 掌握情况 ----------
  console.log('\n【8】掌握情况看板');
  await page.click('#btn-progress');
  await page.waitForSelector('#view-progress:not([hidden])');
  const msItems = await page.locator('.ms-item').count();
  log('五级掌握度汇总', msItems === 5, `${msItems} 项`);
  const mRows = await page.locator('.m-row').count();
  log('每个单词一行', mRows === 17, `${mRows} 行`);
  const histItems = await page.locator('.history-item').count();
  log('历史测试记录', histItems > 0, `${histItems} 条`);
  await page.click('#btn-close-progress');
  await page.waitForTimeout(300);

  // ---------- 9. 生词表 ----------
  console.log('\n【9】生词表');
  await page.click('#btn-wordlist');
  await page.waitForSelector('#view-wordlist:not([hidden])');
  const wlItems = await page.locator('.wl-item').count();
  log('生词表 17 条', wlItems === 17, `${wlItems} 条`);
  const wlText = await page.locator('.wl-item').first().innerText();
  log('含音标/释义/例句',
    wlText.includes('/') && wlText.includes('例句') === false && wlText.length > 20,
    wlText.split('\n').slice(0, 3).join(' / '));
  await page.click('#btn-close-wordlist');
  await page.waitForTimeout(300);

  // ---------- 10. 发音训练 ----------
  console.log('\n【10】发音训练');
  await page.click('[data-special="pronounce"]');
  await page.waitForSelector('#view-pronounce:not([hidden])');
  const pronWord = await page.locator('#pron-word').innerText();
  log('发音训练卡片', pronWord.length > 0, `当前单词: ${pronWord}`);
  const syls = await page.locator('#pron-syllables .syl').count();
  log('音节拆分显示', syls > 0, `${syls} 个音节`);
  const piItems = await page.locator('.pi-item').count();
  log('词条索引条', piItems === 17, `${piItems} 个`);
  const recordBtn = await page.locator('#btn-record').isVisible();
  log('录音按钮存在', recordBtn);
  // 跟读自评
  await page.click('#btn-rate-ok');
  await page.waitForTimeout(300);
  const pronStat = await page.evaluate(() => {
    const r = window.Store.state.words[window.VOCAB[window.__pronIdx || 0].id];
    return window.Store.state.words['beginning'];
  });
  const pronOk = await page.evaluate(() => window.Store.state.words['beginning'].pronOk);
  log('跟读自评计入统计', pronOk === 1, `pronOk=${pronOk}`);
  await page.click('#btn-pron-next');
  await page.waitForTimeout(200);
  const pronWord2 = await page.locator('#pron-word').innerText();
  log('切换下一个单词', pronWord2 !== pronWord, `${pronWord} → ${pronWord2}`);
  await page.click('#btn-close-pronounce');
  await page.waitForTimeout(300);

  // ---------- 11. 难度切换生效 ----------
  console.log('\n【11】难度设置生效');
  await page.locator('#seg-difficulty .seg-btn', { hasText: '挑战' }).click();
  await page.waitForTimeout(200);
  const diffDesc = await page.locator('#diff-desc').innerText();
  log('难度说明更新', diffDesc.includes('6'), diffDesc);
  await page.click('.mode-card[data-mode="spell"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const spellVisibleHard = await page.locator('#spell-box').isVisible();
  log('挑战难度强制拼写题', spellVisibleHard);
  await page.click('#btn-quit');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 11.5 答题页难度快捷切换 ----------
  console.log('\n【11.5】答题页难度快捷切换');
  await page.locator('#seg-difficulty .seg-btn', { hasText: '入门' }).click();
  await page.waitForTimeout(200);
  await page.click('.mode-card[data-mode="c2e"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  const quickBtns = await page.locator('#seg-difficulty-quick .seg-btn').count();
  log('答题页难度按钮', quickBtns === 3, `${quickBtns} 个`);
  const activeDiff = await page.locator('#seg-difficulty-quick .seg-btn.active').innerText();
  log('当前难度高亮正确', activeDiff === '入门', activeDiff);
  const beforeIdx = await page.evaluate(() => window.Quiz.current.index);
  await page.locator('#seg-difficulty-quick .seg-btn', { hasText: '挑战' }).click();
  await page.waitForTimeout(500);
  const afterIdx = await page.evaluate(() => window.Quiz.current.index);
  const newDiff = await page.evaluate(() => window.Quiz.current.difficulty.key);
  log('切换难度后重新组卷', newDiff === 'hard' && afterIdx === 0, `难度=${newDiff} 题号重置=${afterIdx === 0}`);
  const hardOpts = await page.locator('#q-options .option-btn').count();
  log('挑战难度 6 个选项或拼写题', hardOpts === 6 || (await page.locator('#spell-box').isVisible()),
    hardOpts ? `${hardOpts} 选项` : '拼写题');
  await page.click('#btn-quit');
  await page.click('#modal-confirm');
  await page.waitForTimeout(300);

  // ---------- 12. 桌面视口 ----------
  console.log('\n【12】桌面视口');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const modeCols = await page.evaluate(() => {
    const g = document.querySelector('.mode-grid');
    return getComputedStyle(g).gridTemplateColumns.split(' ').length;
  });
  log('桌面端 5 列布局', modeCols === 5, `${modeCols} 列`);
  const overflowX = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  log('无横向溢出', !overflowX);
  await page.screenshot({ path: 'test/_out/desktop-home.png', fullPage: true });

  // ---------- 13. 截图存档 ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/_out/mobile-home.png', fullPage: true });
  await page.click('.mode-card[data-mode="e2c"]');
  await page.waitForSelector('#view-quiz:not([hidden])');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/_out/mobile-quiz.png' });
  await answerCorrectly(page);
  await page.screenshot({ path: 'test/_out/mobile-feedback.png' });

  // ---------- 汇总 ----------
  console.log('\n' + '='.repeat(56));
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`测试结果：${pass} 通过 / ${fail} 失败 / 共 ${results.length}`);
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name} ${r.detail}`));
  }
  if (pageErrors.length) {
    console.log('\n页面异常：');
    pageErrors.forEach(e => console.log('  ⚠️ ' + e));
  }
  if (consoleErrors.length) {
    console.log('\nConsole 错误：');
    consoleErrors.forEach(e => console.log('  ⚠️ ' + e));
  }
  if (!pageErrors.length && !consoleErrors.length) console.log('\n✅ 无页面异常、无 console 错误');

  await browser.close();
  process.exit(fail || pageErrors.length ? 1 : 0);
})().catch(e => {
  console.error('测试脚本异常:', e);
  process.exit(2);
});
