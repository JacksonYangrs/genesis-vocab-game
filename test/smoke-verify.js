/**
 * 全视图冒烟测试 —— 逐个点开每个视图，确认不抛异常
 *
 * 起因：v2 改造时漏了 #wordlist-note 元素，导致生词表页点开就报错。
 * 这类问题靠"测主要流程"发现不了，必须逐个视图点。
 */
const { chromium } = require('playwright-core');

const BASE = process.env.GV_URL || 'http://127.0.0.1:8769/index.html';

let pass = 0, fail = 0;
const failures = [];
function log(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 先设好昵称 —— 否则点「学习报告」会弹昵称框挡住后续测试
  await page.evaluate(() => window.Store.setName('Tester'));
  await page.waitForTimeout(300);

  console.log('\n【1】逐个视图点开');
  // 注意：view 是 DOM id（不带 #），btn/close 是 CSS 选择器（带 #）
  const views = [
    ['掌握情况', '#btn-progress', 'view-progress', '#btn-close-progress'],
    ['生词表',   '#btn-wordlist', 'view-wordlist', '#btn-close-wordlist'],
    ['学习报告', '#btn-report', 'view-report', '#btn-close-report'],
    ['教师模式', '#btn-teacher', 'view-teacher', '#btn-close-teacher'],
  ];
  for (const [name, btn, view, close] of views) {
    const before = errs.length;
    await page.click(btn);
    await page.waitForTimeout(650);
    const shown = await page.evaluate(v => {
      const el = document.getElementById(v);
      return el ? !el.hidden : null;
    }, view);
    const newErr = errs.length - before;
    log(name + ' 视图可打开', shown === true && newErr === 0,
      shown === null ? '元素不存在' : (newErr ? errs.slice(before).join('|') : '正常'));
    if (shown) {
      await page.click(close).catch(() => {});
      await page.waitForTimeout(250);
    }
  }

  console.log('\n【2】发音训练页');
  {
    const before = errs.length;
    await page.click('[data-special="pronounce"]');
    await page.waitForTimeout(700);
    const shown = await page.evaluate(() => !document.getElementById('view-pronounce').hidden);
    log('发音训练 视图可打开', shown && errs.length === before, errs.slice(before).join('|'));
    await page.click('#btn-close-pronounce');
    await page.waitForTimeout(250);
  }

  console.log('\n【3】答题页与反馈');
  {
    const before = errs.length;
    await page.click('#btn-start');
    await page.waitForSelector('#view-quiz:not([hidden])');
    await page.waitForTimeout(500);
    log('答题页 可打开', errs.length === before, errs.slice(before).join('|'));

    // 提示按钮（内含 SVG 图标）
    await page.click('#btn-hint');
    await page.waitForTimeout(200);
    const hintSvg = await page.locator('#btn-hint svg.ic').count();
    log('提示按钮含 SVG 图标', hintSvg === 1, hintSvg + ' 个');

    // 答一题看反馈
    const type = await page.evaluate(() => window.Quiz.question().type);
    if (type === 'choice') {
      const idx = await page.evaluate(() => window.Quiz.question().options.indexOf(window.Quiz.question().answer));
      await page.locator('#q-options .option-btn').nth(idx).click();
    } else if (type === 'order') {
      // 排序题：按正确顺序点片段
      const chunks = await page.evaluate(() => window.Quiz.question().chunks);
      const answer = await page.evaluate(() => window.Quiz.question().answer);
      const order = chunks
        .map((text, i) => ({ i, pos: answer.indexOf(text) }))
        .filter(x => x.pos >= 0)
        .sort((a, b) => a.pos - b.pos);
      for (const o of order) {
        await page.locator('.chunk-btn').nth(o.i).click();
        await page.waitForTimeout(80);
      }
      await page.click('#btn-submit-order');
      await page.waitForTimeout(200);
    } else {
      await page.fill('#spell-input', await page.evaluate(() => window.Quiz.question().answer));
      await page.click('#btn-submit-spell');
    }
    await page.waitForSelector('#feedback:not([hidden])', { timeout: 6000 });
    await page.waitForTimeout(400);
    log('反馈面板 正常显示', errs.length === before, errs.slice(before).join('|'));
    await page.click('#btn-quit');
    await page.click('#modal-confirm');
    await page.waitForTimeout(300);
  }

  console.log('\n【4】图标替换完整性');
  {
    const state = await page.evaluate(() => ({
      pending: document.querySelectorAll('[data-icon]').length,
      rendered: document.querySelectorAll('svg.ic').length
    }));
    log('动态插入的图标也被替换', state.pending === 0,
      state.rendered + ' 个 SVG，' + state.pending + ' 个待替换');
  }

  console.log('\n【5】昵称持久化');
  {
    await page.evaluate(() => window.Store.setName('David'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const n1 = await page.evaluate(() => window.Store.identity().name);
    log('刷新后昵称保留', n1 === 'David', n1 || '(空)');

    // 主存储被清空（模拟微信清缓存）
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const n2 = await page.evaluate(() => window.Store.identity().name);
    log('主存储被清后靠备份恢复', n2 === 'David', n2 || '(丢失)');
  }

  console.log('\n【6】DOM 引用完整性');
  {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const appSrc = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const htmlIds = new Set([...htmlSrc.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
    const usedIds = new Set([...appSrc.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
    const missing = [...usedIds].filter(i => !htmlIds.has(i));
    log('app.js 引用的 id 全部存在', missing.length === 0,
      missing.length ? missing.join(', ') : usedIds.size + ' 个全部命中');
  }

  console.log('\n【7】控制台');
  log('全程无 console 错误', errs.length === 0, errs.slice(0, 3).join(' | '));

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
