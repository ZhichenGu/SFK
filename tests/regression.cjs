// Run with Playwright available in NODE_PATH. All API calls use an isolated mock.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const token = '10000000-0000-4000-8000-000000000001';
const teacher = { id: '20000000-0000-4000-8000-000000000001', name: '测试导师' };
const blank = () => ({ mode: 'text', text: '', image: null, strokes: [], loading: false, revision: 0 });
const record = name => ({ schemaVersion: 1, courseName: '项目课', lessonDate: '2026-10-18', lessonNumber: '', checkIn: '10:00', checkOut: '11:00', content: '测试内容', homework: '', previousHomework: null, teacherName: '', signatures: { student: blank(), mentor: blank() }, studentName: name });

(async () => {
  const server = http.createServer(async (req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await fs.readFile(filename);
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.woff2': 'font/woff2' };
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream'); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    async function fixture() {
      const context = await browser.newContext();
      const db = new Map(), saves = [], publishes = [], errors = [], external = [];
      const api = { failNames: new Set(), dropNames: new Set(), failPublish: false, saveGate: null, detailGate: null, winner: '', failShared: 0, submits: 0, ocrCalls: 0, ocrWords: null, feedbackCalls: [], feedbackFailure: false };
      const row = (id, rec, revision = 1) => ({ id, record: clone(rec), revision, signed_at: null, share_token: null, share_expires_at: null });
      const meta = r => ({ id: r.id, revision: r.revision, student_name: r.record.studentName, teacher_name: r.record.teacherName, lesson_date: r.record.lessonDate, check_in: r.record.checkIn, course_name: r.record.courseName, signed_at: r.signed_at });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { external.push(url.href); await route.abort(); return; }
        const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
        if (url.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.SFK_CONFIG={supabaseUrl:${JSON.stringify(origin)},supabasePublishableKey:'isolated-test',siteUrl:'https://example.test/'};` });
        if (url.pathname === '/rest/v1/teachers') return reply([teacher]);
        if (url.pathname === '/rest/v1/lesson_records') {
          const id = url.searchParams.get('id')?.slice(3);
          if (id) { if (api.detailGate) { const gate = api.detailGate; api.detailGate = null; gate.started.resolve(); await gate.release.promise; } return reply(db.has(id) ? [db.get(id)] : []); }
          return reply([...db.values()].map(meta));
        }
        if (url.pathname === '/functions/v1/generate-feedback') {
          api.feedbackCalls.push(route.request().postDataJSON());
          return api.feedbackFailure ? reply({error:'模拟余额不足'},502) : reply({text:'🔸课程内容：AI测试反馈',usage:{inputTokens:400,outputTokens:50}});
        }
        if (url.pathname === '/functions/v1/ocr-schedule') { api.ocrCalls++; return reply({ words: api.ocrWords || [
          { text: '测试学生', x: 0, y: 0, h: 20 }, { text: '2026-10-18', x: 100, y: 0, h: 20 }, { text: '10:00-11:00', x: 250, y: 0, h: 20 }
        ] }); }
        if (url.pathname.startsWith('/rest/v1/rpc/')) {
          const body = route.request().postDataJSON(), name = url.pathname.split('/').pop();
          if (name === 'save_lesson') {
            saves.push(clone(body));
            if (api.saveGate) { const gate = api.saveGate; api.saveGate = null; gate.started.resolve(); await gate.release.promise; }
            if (api.failNames.has(body.p_record.studentName)) return reply({ message: '模拟保存失败' }, 500);
            const old = db.get(body.p_id);
            if ((old?.revision || 0) !== body.p_expected_revision) return reply({ message: '记录已被更新' }, 409);
            const saved = row(body.p_id, body.p_record, body.p_expected_revision + 1); saved.teacher_id = body.p_teacher_id; db.set(saved.id, saved);
            if (api.dropNames.delete(body.p_record.studentName)) return route.abort('failed');
            return reply(saved);
          }
          if (name === 'publish_lesson') {
            publishes.push(body.p_id);
            if (api.failPublish) return reply({ message: '模拟发布失败' }, 500);
            const saved = db.get(body.p_id); saved.share_token = token; saved.share_expires_at = '2099-01-01T00:00:00Z';
            return reply({ token, expires_at: saved.share_expires_at });
          }
          if (name === 'get_shared_lesson') {
            if (api.failShared > 0) { api.failShared--; return route.abort('failed'); }
            const saved = [...db.values()].find(r => r.share_token === body.p_token);
            return saved ? reply({ record: saved.record, signed_at: saved.signed_at }) : reply({ message: '链接失效' }, 404);
          }
          if (name === 'submit_lesson_signature') {
            api.submits++;
            const saved = [...db.values()].find(r => r.share_token === body.p_token);
            saved.record.signatures.student = api.winner ? { ...blank(), text: api.winner } : body.p_signature;
            saved.signed_at = '2026-10-18T02:00:00Z'; saved.revision++;
            if (api.failAfterSubmit) api.failShared = 2;
            return reply({ signed_at: saved.signed_at });
          }
          throw Error('Unexpected RPC: ' + name);
        }
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      async function home() { await page.goto(origin); await page.locator('#us-guest').click(); await page.locator('#dashboard').waitFor({ state: 'visible' }); }
      async function close() { assert.deepEqual(errors, []); assert.deepEqual(external, []); await context.close(); }
      return { page, context, db, saves, publishes, api, row, home, close };
    }
    async function test(name, run) { await run(); console.log('PASS', name); }

    await test('修复：单份保存丢响应可回读恢复，重试不重复写入',async()=>{
      const f=await fixture(),{page,api}=f;await f.home();await page.locator('#new-record').click();await page.locator('#studentName').fill('单份丢响应');
      api.dropNames.add('单份丢响应');await page.locator('#save-record').click();await page.waitForFunction(()=>document.getElementById('share-status').textContent.includes('fetch'));
      assert.equal(f.db.size,1);await page.locator('#save-record').click();await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('已保存'));
      assert.equal(f.saves.length,1);await page.locator('#home-link').click();await page.locator('#dashboard').waitFor({state:'visible'});assert.equal(f.db.size,1);await f.close();
    });
    await test('修复：保存丢响应后保留新输入，不覆盖真正的并发更新',async()=>{
      const f=await fixture(),{page,api}=f;await f.home();await page.locator('#new-record').click();await page.locator('#studentName').fill('丢响应后继续');
      api.dropNames.add('丢响应后继续');await page.locator('#save-record').click();await page.waitForFunction(()=>document.getElementById('share-status').textContent.includes('fetch'));
      await page.locator('#content').fill('响应丢失后新增');await page.locator('#save-record').click();await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('已保存'));
      assert.equal(f.saves.length,2);assert.equal(f.db.values().next().value.record.content,'响应丢失后新增');
      api.dropNames.add('丢响应后继续');await page.locator('#content').fill('另一次保存');await page.locator('#save-record').click();await page.waitForFunction(()=>document.getElementById('share-status').textContent.includes('fetch'));
      const saved=f.db.values().next().value;saved.revision++;saved.record.content='其他设备的新内容';const before=f.saves.length;
      await page.locator('#save-record').click();await page.waitForFunction(()=>document.getElementById('share-status').textContent.includes('不能覆盖重试'));
      assert.equal(f.saves.length,before);assert.equal(saved.record.content,'其他设备的新内容');assert.equal(await page.locator('#content').inputValue(),'另一次保存');await f.close();
    });
    await test('修复：OCR生成后编辑原记录，清除旧链接并重新保存，不新建重复项',async()=>{
      const f=await fixture(),{page}=f;await f.home();await page.locator('#ocr-new').click();
      await page.locator('#ocr-file').setInputFiles(path.join(root,'assets/ocr-guide/timetable-reference.png'));await page.locator('#ocr-recognize').click();await page.locator('#ocr-next').click();
      await page.locator('#ocr-content-rows textarea').first().fill('修改前');await page.locator('#ocr-generate').click();await page.waitForFunction(()=>!SFKOCR.isBusy());
      const id=f.db.keys().next().value;await page.locator('#ocr-content-rows textarea').first().fill('修改后');
      assert.equal(await page.locator('#ocr-content-rows a').count(),0);assert.equal(await page.locator('#ocr-results a').count(),0);
      await page.locator('#ocr-generate').click();await page.waitForFunction(()=>!SFKOCR.isBusy());
      assert.equal(f.db.size,1);assert.equal(f.db.get(id).record.content,'修改后');assert.equal(f.saves.length,2);assert.equal(f.publishes.length,2);
      await page.locator('#ocr-generate').click();assert.equal(f.saves.length,2);await f.close();
    });
    await test('修复：批量两种复制均失败时不标记成功',async()=>{
      const f=await fixture(),{page}=f;await f.home();await page.locator('#batch-new').click();await page.locator('.batch-row input[list]').fill('复制学生');
      await page.locator('#batch-generate').click();await page.waitForFunction(()=>!SFKBatch.isBusy());
      await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});document.execCommand=()=>false;});
      const copy=page.locator('.row-link button');await copy.click();assert.equal(await copy.textContent(),'复制链接');assert.ok((await page.locator('#batch-status').textContent()).includes('复制失败'));assert.equal(await page.evaluate(()=>localStorage.getItem('sfk-copied-v1')),null);await f.close();
    });
    await test('修复：同一学生多份反馈复用结果，手动再生成才新增API调用',async()=>{
      const f=await fixture(),{page,api}=f;f.db.set('a',f.row('a',{...record('合并学生'),content:'课程A',homework:'最新作业'}));f.db.set('b',f.row('b',{...record('合并学生'),content:'课程B',lessonDate:'2026-10-17'}));
      await f.home();await page.locator('#record-list .record-card').nth(1).waitFor();await page.locator('#select-all').check();await page.locator('#generate-feedback').click();await page.locator('#feedback-dialog').waitFor({state:'visible'});
      assert.equal(await page.locator('#feedback-homework').inputValue(),'最新作业');await page.locator('#feedback-generate').click();await page.locator('#feedback-result').waitFor({state:'visible'});
      assert.equal(api.feedbackCalls.length,1);assert.deepEqual(api.feedbackCalls[0].lessons.map(r=>r.content),['课程B','课程A']);
      await page.locator('#feedback-text').fill('保留手动修改');await page.locator('#feedback-back').click();await page.locator('#feedback-generate').click();await page.locator('#feedback-result').waitFor({state:'visible'});
      assert.equal(api.feedbackCalls.length,1);assert.equal(await page.locator('#feedback-text').inputValue(),'保留手动修改');
      await page.locator('#feedback-back').click();await page.setViewportSize({width:320,height:900});assert.ok(await page.locator('#feedback-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.locator('#feedback-regenerate').click();await page.locator('#feedback-result').waitFor({state:'visible'});assert.equal(api.feedbackCalls.length,2);
      await page.locator('#feedback-back').click();await page.locator('#feedback-progress').fill('50');await page.locator('#feedback-generate').click();await page.locator('#feedback-result').waitFor({state:'visible'});assert.equal(api.feedbackCalls.length,3);await f.close();
    });
    await test('修复：超过20份在读取详情和付费前阻止',async()=>{
      const f=await fixture(),{page,api}=f;for(let i=0;i<21;i++)f.db.set('r'+i,f.row('r'+i,record('大批学生')));
      await f.home();await page.locator('#record-list .record-card').nth(20).waitFor();await page.locator('#select-all').check();
      let reads=0;page.on('request',request=>{if(new URL(request.url()).searchParams.has('id'))reads++;});await page.locator('#generate-feedback').click();await page.waitForFunction(()=>document.getElementById('workspace-status').textContent.includes('最多选择20份'));
      assert.equal(reads,0);assert.equal(api.feedbackCalls.length,0);assert.equal(await page.locator('#feedback-dialog').isVisible(),false);await f.close();
    });

    await test('反馈仅使用所选学生的课程原文，排序、编辑、复制和手机布局正常', async () => {
      const f = await fixture(), { page } = f;
      const later = { ...record('反馈学生'), content: '制作模型', homework: '补充草图', lessonDate: '2026-10-18' };
      const earlier = { ...record('反馈学生'), content: '<b>色彩练习</b>', lessonDate: '2026-10-17' };
      f.db.set('later', f.row('later', later)); f.db.set('earlier', f.row('earlier', earlier));
      f.db.set('other', f.row('other', record('另一学生')));
      await f.home(); assert.equal(await page.locator('#generate-feedback').isDisabled(), true);
      await page.locator('#record-search').fill('反馈学生'); await page.locator('#select-all').check();
      await page.locator('#generate-feedback').click(); await page.locator('#feedback-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#feedback-result').isVisible(), false);
      assert.equal(await page.locator('#feedback-homework').inputValue(), '补充草图');
      await page.locator('#feedback-teacher').fill('导师甲');
      await page.locator('#feedback-progress').fill('35');
      await page.locator('#feedback-pronoun').selectOption('她');
      await page.locator('#feedback-project').fill('项目一 · 对视');
      await page.locator('#feedback-observation').fill('能根据测试结果调整结构。');
      await page.locator('#feedback-advice').fill('先梳理问题，再逐项测试。');
      for (const width of [320, 375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.locator('#feedback-dialog').evaluate(e => e.scrollWidth <= e.clientWidth));
      }
      await page.locator('#feedback-template').click();
      const value = await page.locator('#feedback-text').inputValue();
      assert.ok(value.includes('制作模型') && value.includes('补充草图') && value.includes('🔸最新进度百分比：35%'));
      assert.ok(value.indexOf('色彩练习') < value.indexOf('制作模型'));
      assert.ok(!value.includes('2026-10-') && !value.includes('10:00') && !value.includes('您好'));
      assert.ok(value.includes('导师甲') && value.includes('项目一 · 对视') && value.includes('建议她'));
      assert.ok(value.includes('能根据测试结果调整结构。'));
      await page.locator('#feedback-back').click();
      assert.equal(await page.locator('#feedback-progress').inputValue(), '35');
      await page.locator('#feedback-progress').fill('0');
      await page.locator('#feedback-template').click();
      assert.ok((await page.locator('#feedback-text').inputValue()).includes('0%'));
      const blankLatest = await page.evaluate(() => {
        const input = SFKFeedback.prepare([{id:'old',record:{studentName:'学生',lessonDate:'2026-10-17',homework:'旧作业'}},{id:'new',record:{studentName:'学生',lessonDate:'2026-10-18',homework:''}}]);
        return SFKFeedback.draft(input);
      });
      for(const title of ['当前项目','当前导师','最新进度百分比','课程内容','最新作业','学生表现','学习建议'])assert.ok(blankLatest.includes('🔸'+title+'：'));
      assert.ok(!blankLatest.includes('旧作业') && blankLatest.includes('🔸最新作业：\n'));
      assert.ok(blankLatest.includes('🔸最新进度百分比：\n') && blankLatest.includes('🔸学生表现：\n'));
      assert.ok(!value.includes('另一学生')); assert.equal(await page.locator('#feedback-dialog b').count(), 0);
      for (const width of [320, 375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.ok(await page.locator('#feedback-dialog').evaluate(e => e.scrollWidth <= e.clientWidth));
      }
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedFeedback = value; } } }));
      await page.locator('#feedback-text').fill('老师编辑后的反馈'); await page.locator('#feedback-copy').click();
      await page.waitForFunction(() => document.getElementById('feedback-status').textContent.includes('已复制'));
      assert.equal(await page.evaluate(() => window.copiedFeedback), '老师编辑后的反馈');
      assert.equal(f.saves.length, 0); assert.equal(f.publishes.length, 0); await f.close();
    });

    await test('AI反馈只提交必要文字，失败保留输入，不自动重试或写回签单', async () => {
      const f = await fixture(), {page,api} = f;
      f.db.set('a',f.row('a',record('AI学生')));await f.home();
      await page.locator('#select-all').check();await page.locator('#generate-feedback').click();
      await page.locator('#feedback-progress').fill('40');api.feedbackFailure=true;
      await page.locator('#feedback-generate').click();
      await page.waitForFunction(()=>document.getElementById('feedback-status').textContent.includes('模拟余额不足'));
      assert.equal(await page.locator('#feedback-progress').inputValue(),'40');assert.equal(api.feedbackCalls.length,1);
      const request=api.feedbackCalls[0];assert.equal(request.options.progress,'40');
      assert.deepEqual(Object.keys(request.lessons[0]).sort(),['content','courseName','studentName']);
      api.feedbackFailure=false;await page.locator('#feedback-generate').click();
      await page.locator('#feedback-result').waitFor({state:'visible'});
      assert.equal(await page.locator('#feedback-text').inputValue(),'🔸课程内容：AI测试反馈');
      assert.equal(api.feedbackCalls.length,2);assert.equal(f.saves.length,0);await f.close();
    });

    await test('反馈拒绝混选学生，读取缺失记录时不静默漏课且可重试', async () => {
      const f = await fixture(), { page } = f;
      f.db.set('a', f.row('a', record('学生甲'))); f.db.set('b', f.row('b', record('学生乙')));
      await f.home(); await page.locator('#record-list .record-card').nth(1).waitFor();
      await page.locator('#select-all').check(); await page.locator('#generate-feedback').click();
      await page.waitForFunction(() => document.getElementById('workspace-status').textContent.includes('同一位学生'));
      assert.equal(await page.locator('#feedback-dialog').isVisible(), false);
      await page.locator('#record-search').fill('学生甲'); await page.locator('#select-all').check();
      const saved = f.db.get('a'); f.db.delete('a'); await page.locator('#generate-feedback').click();
      await page.waitForFunction(() => document.getElementById('workspace-status').textContent.includes('反馈生成失败'));
      assert.equal(await page.locator('#feedback-dialog').isVisible(), false);
      f.db.set('a', saved); await page.locator('#generate-feedback').click();
      await page.locator('#feedback-dialog').waitFor({ state: 'visible' }); await f.close();
    });

    await test('首页教程入口可用，四类页面在手机和桌面无横向溢出，批量详情按需展开', async () => {
      const f = await fixture(), { page } = f; f.db.set('ui-record', f.row('ui-record', record('Alexandra Samantha Montgomery'))); await f.home();
      async function checkWidths() {
        for (const width of [320, 375, 900, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width);
        }
      }
      await page.locator('#record-list .record-card').waitFor(); await checkWidths();
      assert.equal(await page.locator('#dashboard .workspace-guide').count(), 0);
      assert.equal(await page.locator('#quickstart-view').isVisible(), false);
      await page.setViewportSize({ width: 375, height: 812 });
      assert.equal(await page.locator('header .mobile-preview').isVisible(), false);
      await page.locator('#quickstart-button').click(); await page.locator('#quickstart-view').waitFor({state:'visible'}); await checkWidths();
      await page.setViewportSize({width:375,height:812});
      await page.locator('#guide-new-record').click(); await page.locator('main.layout').waitFor({ state: 'visible' });
      assert.equal(await page.locator('header .mobile-preview').isVisible(), true); await checkWidths();
      await page.locator('#home-link').click(); await page.locator('#quickstart-button').click(); await page.locator('#guide-batch-new').click(); await page.locator('#batch-view').waitFor({ state: 'visible' });
      const more = page.locator('.batch-row .ops').getByRole('button', { name: '更多', exact: true });
      assert.equal(await page.locator('.batch-row .batch-sub').isVisible(), false);
      await more.click(); assert.equal(await page.locator('.batch-row .batch-sub').isVisible(), true);
      assert.equal(await page.locator('.batch-row .ops').getByRole('button', { name: '收起', exact: true }).getAttribute('aria-expanded'), 'true'); await checkWidths();
      await page.locator('#home-link').click(); await page.locator('#ocr-new').click();
      await page.locator('#ocr-file').setInputFiles({ name: 'ui.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
      await page.locator('#ocr-recognize').click(); await page.locator('#ocr-next').click();
      await page.locator('.ocr-content-row').waitFor(); await checkWidths();
      assert.ok(await page.locator('.ocr-content-row > .cell').first().evaluate(el => el.getBoundingClientRect().width >= 160));
      await page.locator('#quickstart-button').click(); await page.locator('#quickstart-view').waitFor({state:'visible'});
      await page.reload(); await page.locator('#quickstart-view').waitFor({state:'visible'});
      await page.locator('#guide-back').click(); await page.locator('#dashboard').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>SFKUser.isActive()),true);
      await f.close();
    });

    await test('品牌入口始终可返回首页，保留当前教师与编辑内容，版本号不随页面标题消失', async () => {
      const f = await fixture(), { page } = f;
      await page.goto(origin); assert.equal(await page.locator('#app-version').textContent(), 'v0.8');
      const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(e => new URL(e.src).searchParams.get('v')));
      assert.ok(scripts.length > 0 && scripts.every(v => 'v' + v === 'v0.8'));
      await page.getByRole('link', { name: '返回首页', exact: true }).click(); await page.locator('#dashboard').waitFor({ state: 'visible' });
      await page.locator('#user-chip-btn').click(); await page.getByRole('button', { name: teacher.name, exact: true }).click();
      await page.locator('#new-record').click(); await page.locator('#studentName').fill('首页导航测试');
      await page.locator('#content').fill('返回首页前保存此内容');
      await page.getByRole('link', { name: '返回首页', exact: true }).click(); await page.locator('#dashboard').waitFor({ state: 'visible' });
      assert.equal(f.db.size, 1); assert.equal(f.db.values().next().value.record.content, '返回首页前保存此内容');
      assert.ok((await page.locator('#user-chip-btn').textContent()).includes(teacher.name));
      for (const entry of ['batch-new', 'ocr-new']) {
        await page.locator('#' + entry).click(); await page.getByRole('link', { name: '返回首页', exact: true }).click();
        await page.locator('#dashboard').waitFor({ state: 'visible' }); assert.equal(await page.locator('#app-version').textContent(), 'v0.8');
      }
      await page.screenshot({ path: '/tmp/sfk-home-v0.8-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('#app-version').isVisible(), true);
      await page.screenshot({ path: '/tmp/sfk-home-v0.8-mobile.png', fullPage: true });
      const shared = f.row('home-student', record('学生首页测试')); shared.share_token = token; f.db.set(shared.id, shared);
      await page.goto(origin + '/#request=' + token); await page.reload(); await page.locator('main.layout').waitFor({ state: 'visible' });
      await page.getByRole('link', { name: '返回首页', exact: true }).click(); await page.locator('#user-select').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).hash, ''); assert.equal(await page.locator('#app-version').textContent(), 'v0.8');
      await f.close();
    });

    await test('自动保存期间切换老师：等待保存并保留后来输入，手动保存不并发', async () => {
      const f = await fixture(), { page, api } = f; await f.home();
      await page.locator('#user-chip-btn').click(); await page.getByRole('button', { name: teacher.name, exact: true }).click();
      await page.locator('#new-record').click();
      api.saveGate = { started: deferred(), release: deferred() }; const gate = api.saveGate;
      await page.locator('#studentName').fill('保存测试'); await gate.started.promise;
      await page.locator('#content').fill('保存期间的新输入');
      await page.locator('#save-record').click(); // joins the existing save
      await page.locator('#user-chip-btn').click(); // busy action must keep the editor visible
      assert.equal(await page.locator('main.layout').isVisible(), true);
      gate.release.resolve();
      await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('已保存 ·'));
      assert.equal(f.saves.length, 2); assert.deepEqual(f.saves.map(r => r.p_expected_revision), [0, 1]);
      assert.ok(f.saves.every(r => r.p_teacher_id === teacher.id));
      assert.equal(f.db.values().next().value.record.content, '保存期间的新输入');
      await page.locator('#user-chip-btn').click(); await page.locator('#user-select').waitFor({ state: 'visible' });
      await f.close();
    });

    await test('切换身份等待自动保存完成；保存失败时保留编辑器', async () => {
      const f = await fixture(), { page, api } = f; await f.home(); await page.locator('#new-record').click();
      api.saveGate = { started: deferred(), release: deferred() }; const gate = api.saveGate;
      await page.locator('#studentName').fill('导航测试'); await gate.started.promise;
      await page.locator('#user-chip-btn').click(); assert.equal(await page.locator('main.layout').isVisible(), true);
      gate.release.resolve(); await page.locator('#user-select').waitFor({ state: 'visible' });
      await page.locator('#us-guest').click(); await page.getByRole('button', { name: '继续填写', exact: true }).click();
      api.failNames.add('导航测试'); await page.locator('#content').fill('失败时仍保留');
      await page.locator('#user-chip-btn').click(); await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('暂未切换'));
      assert.equal(await page.locator('#content').inputValue(), '失败时仍保留'); assert.equal(await page.locator('main.layout').isVisible(), true);
      await f.close();
    });

    await test('迟到的轮询详情不能覆盖刚输入的内容', async () => {
      const f = await fixture(), { page, api } = f; f.db.set('poll', f.row('poll', record('轮询学生'))); await f.home();
      await page.getByRole('button', { name: '继续填写', exact: true }).click();
      f.db.get('poll').revision++;
      api.detailGate = { started: deferred(), release: deferred() }; const gate = api.detailGate;
      await page.evaluate(() => document.getElementById('refresh-list').click()); await gate.started.promise;
      await page.locator('#content').fill('不能被覆盖'); gate.release.resolve();
      await page.waitForTimeout(150); assert.equal(await page.locator('#content').inputValue(), '不能被覆盖');
      await f.close();
    });

    await test('打开记录的请求晚到时，不抢回身份选择页', async () => {
      const f = await fixture(), { page, api } = f; f.db.set('late', f.row('late', record('晚到学生'))); await f.home();
      api.detailGate = { started: deferred(), release: deferred() }; const gate = api.detailGate;
      await page.getByRole('button', { name: '继续填写', exact: true }).click(); await gate.started.promise;
      await page.locator('#user-chip-btn').click(); await page.locator('#user-select').waitFor({ state: 'visible' });
      gate.release.resolve(); await page.waitForTimeout(150);
      assert.equal(await page.locator('main.layout').isVisible(), false); assert.equal(await page.locator('#user-select').isVisible(), true);
      await f.close();
    });

    await test('批量部分失败刷新后恢复 ID，发布重试不重复保存成功记录', async () => {
      const f = await fixture(), { page, api } = f; await f.home(); await page.locator('#batch-new').click();
      await page.locator('.batch-row input[list]').fill('批量甲'); await page.locator('#batch-add').click();
      await page.locator('.batch-row input[list]').nth(1).fill('批量乙'); api.failNames.add('批量乙');
      await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('sfk-batch-draft-v1')));
      assert.equal(draft.rows.length, 2); assert.ok(draft.rows.every(r => r.id)); assert.equal(f.db.size, 1);
      await page.reload(); await page.locator('#us-guest').click(); await page.locator('#batch-new').click();
      api.failNames.clear(); await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      assert.equal(f.db.size, 2); assert.equal(f.saves.filter(r => r.p_record.studentName === '批量甲').length, 1);
      assert.equal(f.saves.at(-1).p_id, draft.rows[1].id);
      assert.equal(await page.evaluate(() => localStorage.getItem('sfk-batch-draft-v1')), null);
      await f.close();
    });

    await test('批量保存响应丢失：刷新后读取已保存结果，不重复创建或覆盖', async () => {
      const f = await fixture(), { page, api } = f; await f.home(); await page.locator('#batch-new').click();
      await page.locator('.batch-row input[list]').fill('丢响应学生'); api.dropNames.add('丢响应学生');
      await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      assert.equal(f.db.size, 1); assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('sfk-batch-draft-v1')).rows[0].pending));
      await page.reload(); await page.locator('#us-guest').click(); await page.locator('#batch-new').click();
      await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      assert.equal(f.saves.length, 1); assert.equal(f.publishes.length, 1); assert.equal(f.db.size, 1);
      await f.close();
    });

    await test('OCR 全失败可重试，发布失败重试复用保存结果', async () => {
      const f = await fixture(), { page, api } = f; await f.home(); await page.locator('#ocr-new').click();
      await page.locator('#ocr-file').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
      await page.locator('#ocr-recognize').click(); await page.locator('#ocr-next').click();
      api.failNames.add('测试学生'); await page.locator('#ocr-generate').click(); await page.waitForFunction(() => !SFKOCR.isBusy());
      assert.equal(await page.locator('#ocr-retry').isVisible(), true); assert.equal(await page.locator('#ocr-generate').isEnabled(), true);
      api.failNames.clear(); api.failPublish = true; await page.locator('#ocr-retry').click(); await page.waitForFunction(() => !SFKOCR.isBusy());
      const saves = f.saves.length; api.failPublish = false; await page.locator('#ocr-retry').click(); await page.waitForFunction(() => !SFKOCR.isBusy());
      assert.equal(f.saves.length, saves); assert.equal(f.db.size, 1); assert.equal(await page.locator('#ocr-copyall').isVisible(), true);
      await f.close();
    });

    await test('示例卡片仅一节课，原课程可见，重复识别复用结果且生成类型有效', async () => {
      const f = await fixture(), { page, api } = f;
      const word = (text, x, y, w = 80) => ({ text, x, y, w, h: 22 });
      api.ocrWords = [word('基础课+项目', 168, 40, 155), word('1V1授课', 362, 33, 90), word('13:30', 42, 60, 65),
        word('学生名称:', 168, 85, 108), word('Michael', 288, 85, 84), word('Zhicheng', 384, 85, 96), word('Fan', 492, 85, 36),
        word('14:30', 42, 106, 65), word('教室名称:', 168, 128, 108)];
      await f.home(); await page.locator('#ocr-new').click();
      await page.locator('#ocr-file').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
      await page.locator('#ocr-recognize').click(); await page.locator('#ocr-next').waitFor();
      assert.equal(await page.locator('#ocr-rows > .ocr-row').count(), 1);
      const cells = page.locator('#ocr-rows > .ocr-row .cell');
      assert.equal(await cells.nth(1).locator('input').inputValue(), 'Michael Zhicheng Fan');
      assert.equal(await cells.nth(2).locator('select').inputValue(), '项目课');
      assert.ok((await cells.nth(2).textContent()).includes('基础课+项目'));
      assert.equal(await cells.nth(3).locator('input').inputValue(), '');
      assert.equal(await cells.nth(4).locator('input').inputValue(), '13:30');
      assert.equal(await cells.nth(5).locator('input').inputValue(), '14:30');
      assert.equal(await cells.nth(6).locator('input').inputValue(), '');
      await page.screenshot({ path: '/tmp/sfk-ocr-card-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: '/tmp/sfk-ocr-card-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.locator('#ocr-upload-again').click(); await page.locator('#ocr-recognize').click(); await page.locator('#ocr-next').waitFor();
      assert.equal(api.ocrCalls, 1); assert.ok((await page.locator('#ocr-status').textContent()).includes('未再次请求'));
      await page.locator('#ocr-next').click(); await page.locator('#ocr-generate').click(); await page.waitForFunction(() => !SFKOCR.isBusy());
      assert.equal(f.saves.length, 1); assert.equal(f.saves[0].p_record.studentName, 'Michael Zhicheng Fan');
      assert.equal(f.saves[0].p_record.courseName, '项目课'); assert.equal(f.saves[0].p_record.lessonDate, '');
      await f.close();
    });

    await test('批量不确定保存遇到版本冲突：保留草稿，不覆盖重试', async () => {
      const f = await fixture(), { page, api } = f; await f.home(); await page.locator('#batch-new').click();
      await page.locator('.batch-row input[list]').fill('冲突学生'); api.dropNames.add('冲突学生');
      await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      const saved = f.db.values().next().value; saved.revision++; saved.record.content = '其他设备的新内容';
      await page.reload(); await page.locator('#us-guest').click(); await page.locator('#batch-new').click();
      await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      assert.equal(f.saves.length, 1); assert.equal(f.publishes.length, 0); assert.equal(saved.record.content, '其他设备的新内容');
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('sfk-batch-draft-v1')));
      assert.equal(draft.rows[0].id, saved.id); assert.ok(draft.rows[0].error.includes('记录已被更新'));
      await f.close();
    });

    await test('批量草稿不能持久化时，不开始外部保存', async () => {
      const f = await fixture(), { page } = f; await f.home(); await page.locator('#batch-new').click();
      await page.locator('.batch-row input[list]').fill('存储失败学生');
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) { if (key === 'sfk-batch-draft-v1') throw Error('模拟存储已满'); return original.call(this, key, value); };
      });
      await page.locator('#batch-generate').click(); await page.waitForFunction(() => !SFKBatch.isBusy());
      assert.equal(f.saves.length, 0); assert.equal(await page.locator('.batch-row input[list]').inputValue(), '存储失败学生');
      assert.equal(await page.locator('#batch-generate').isEnabled(), true); await f.close();
    });

    for (const lostRead of [false, true]) await test(`学生提交显示服务端胜出签名${lostRead ? '，回读失败后重试只查询' : ''}`, async () => {
      const f = await fixture(), { page, api } = f;
      const saved = f.row('student', record('签名学生')); saved.share_token = token; f.db.set(saved.id, saved);
      api.winner = '服务端签名'; api.failAfterSubmit = lostRead;
      await page.goto(origin + '/#request=' + token); await page.locator('main.layout').waitFor({ state: 'visible' });
      await page.locator('#student-name').locator('xpath=ancestor::fieldset').getByRole('button', { name: '输入姓名', exact: true }).click();
      await page.locator('#student-name').fill('本地签名'); await page.locator('#generate-share').click();
      if (lostRead) { await page.waitForFunction(() => document.getElementById('share-status').textContent.includes('提交未确认')); await page.locator('#generate-share').click(); }
      await page.waitForFunction(() => document.getElementById('generate-share').textContent === '签名已提交');
      assert.equal(await page.locator('#student-name').inputValue(), '服务端签名'); assert.equal(api.submits, 1);
      assert.equal(await page.locator('#student-name').isDisabled(), true);
      await f.close();
    });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
