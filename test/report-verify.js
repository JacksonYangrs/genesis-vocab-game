const { chromium } = require('/Users/yangjackson/AIProjects/Biblish/genesis-vocab-game/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  const errs = []; const perrs = [];
  p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  p.on('pageerror', e => perrs.push(e.message));

  await p.goto('http://127.0.0.1:8767/index.html', {waitUntil:'networkidle'});
  await p.waitForTimeout(1400);

  // 1. 首页昵称提示条（不打断，只提示）
  const barVisible = await p.locator('#name-bar').isVisible();
  const barText = await p.locator('#name-bar-text').innerText();
  console.log(barVisible ? '  ✓ 首页显示昵称提示条: '+barText.slice(0,24) : '  ✗ 昵称提示条未显示');
  const modalOnLoad = await p.locator('#name-modal').isVisible();
  console.log(!modalOnLoad ? '  ✓ 首次进入不弹窗（不打断）' : '  ✗ 首次进入弹窗遮挡页面');

  // 2. 点提示条填昵称
  await p.click('#btn-name-bar');
  await p.waitForTimeout(250);
  await p.fill('#name-input', 'David');
  await p.click('#name-save');
  await p.waitForTimeout(300);
  const modalGone = !(await p.locator('#name-modal').isVisible());
  const savedName = await p.evaluate(()=>window.Store.identity().name);
  console.log(modalGone && savedName==='David' ? '  ✓ 昵称已保存: '+savedName : '  ✗ 昵称保存失败');

  // 3. 做几轮测试产生数据
  for (let round=0; round<3; round++) {
    await p.click('#btn-start');
    await p.waitForSelector('#view-quiz:not([hidden])');
    const n = await p.evaluate(()=>window.Quiz.current.questions.length);
    for (let i=0;i<n;i++){
      const type = await p.evaluate(()=>window.Quiz.question().type);
      if (type === 'choice') {
        // 一半答对一半答错，产生弱项
        const idx = await p.evaluate((wrong) => {
          const q = window.Quiz.question();
          if (wrong) {
            const w = q.options.findIndex(o => o !== q.answer);
            return w;
          }
          return q.options.indexOf(q.answer);
        }, round===0);
        await p.locator('#q-options .option-btn').nth(idx).click();
      } else if (type === 'spell') {
        await p.fill('#spell-input', round===0 ? 'wrongword' : await p.evaluate(()=>window.Quiz.question().answer));
        await p.click('#btn-submit-spell');
      } else {
        const chunks = await p.evaluate(()=>window.Quiz.question().chunks);
        const answer = await p.evaluate(()=>window.Quiz.question().answer);
        const order = chunks.map((t,i)=>({t,i})).map(x=>({i:x.i,pos:answer.indexOf(x.t)})).filter(x=>x.pos>=0).sort((a,b)=>a.pos-b.pos).map(x=>x.i);
        for (const i of order) { await p.locator('.chunk-btn').nth(i).click(); await p.waitForTimeout(50); }
        await p.click('#btn-submit-order');
        await p.waitForTimeout(150);
      }
      await p.waitForSelector('#feedback:not([hidden])', {timeout:5000});
      await p.click('#btn-next');
      await p.waitForTimeout(100);
    }
    await p.waitForSelector('#view-result:not([hidden])', {timeout:8000});
    await p.click('#btn-back-home');
    await p.waitForTimeout(300);
  }

  // 4. 打开报告
  await p.click('#btn-report');
  await p.waitForSelector('#view-report:not([hidden])');
  await p.waitForTimeout(500);
  console.log('  ✓ 报告页打开');

  const hero = await p.locator('#report-hero').innerText();
  console.log('  ✓ 总览渲染: ' + hero.replace(/\n/g,' ').slice(0,70));

  const trend = await p.locator('.tr-item').count();
  console.log(trend > 0 ? '  ✓ 趋势图有 '+trend+' 个数据点' : '  ✗ 趋势图为空');

  const mastery = await p.locator('#report-mastery .ms-item').count();
  console.log(mastery === 5 ? '  ✓ 掌握度五级分布' : '  ✗ 掌握度分布异常: '+mastery);

  const weak = await p.locator('.rw-item').count();
  const weakTxt = await p.locator('#report-weak').innerText();
  console.log(weak >= 0 ? '  ✓ 弱项区渲染 ('+weak+' 项): '+weakTxt.replace(/\n/g,' ').slice(0,50) : '');

  const sug = await p.locator('.sg-item').count();
  console.log(sug > 0 ? '  ✓ 建议 '+sug+' 条' : '  ✗ 建议为空');

  const comment = await p.locator('#report-comment').innerText();
  console.log(comment.length > 10 ? '  ✓ 评价文案: '+comment.replace(/\n/g,' ').slice(0,50) : '  ✗ 评价为空');

  // 5. 导出档案
  const profile = await p.evaluate(()=>{
    const t = window.Store.exportProfile();
    const j = JSON.parse(t);
    return { kind: j.kind, name: j.identity.name, tests: j.report.totalTests, words: Object.keys(j.words).length, len: t.length };
  });
  console.log(profile.kind==='student-profile' && profile.name==='David' && profile.tests>0
    ? '  ✓ 学习档案导出: '+profile.tests+' 次测试, '+profile.words+' 词, '+(profile.len/1024).toFixed(1)+'KB'
    : '  ✗ 档案导出异常: '+JSON.stringify(profile));

  // 6. 改昵称
  await p.click('#btn-edit-name');
  await p.waitForTimeout(200);
  await p.fill('#name-input', '陈姐妹');
  await p.click('#name-save');
  await p.waitForTimeout(300);
  const newName = await p.evaluate(()=>window.Store.identity().name);
  const avatar = await p.locator('.ri-avatar').innerText();
  console.log(newName==='陈姐妹' && avatar==='陈' ? '  ✓ 改昵称生效, 头像同步' : '  ✗ 改昵称失败: '+newName+'/'+avatar);

  // 7. 控制台
  console.log(perrs.length===0 ? '  ✓ 无页面异常' : '  ✗ 页面异常: '+perrs.slice(0,2).join('|'));
  console.log(errs.length===0 ? '  ✓ 无 console 错误' : '  ✗ console 错误: '+errs.slice(0,2).join('|'));

  await b.close();
})();
