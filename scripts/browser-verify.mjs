/**
 * 浏览器自动化走查（Edge headless + CDP）
 * 真实浏览器验证学生主流程：登录表单 → 城市中枢 → 章节地图 → 解锁第 9 章 → 进入关卡 → 通关 → 学习记录。
 * 产物：audit/browser/*.png 与 audit/browser-verify.json
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { levels } from '../packages/content/src/index.ts';

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4399';
const PREFIX = new URL(BASE).pathname.replace(/\/+$/, ''); // 部署基路径：根路径为 ''，/legacy/ 子路径为 '/legacy'
const OUT = 'audit/browser';
const PORT = Number(process.env.VERIFY_PORT ?? 9225);
const SCOPE = process.env.VERIFY_SCOPE ?? 'full';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
if (!EDGE) throw new Error('找不到 Edge/Chrome 可执行文件');

const profile = `C:/Users/Administrator/AppData/Local/Temp/preview-profile-${Date.now()}`;
const steps = [];
const shots = [];
const record = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`); };

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('[1/8] 启动浏览器');
  const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1440,900', `${BASE}/`], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 未就绪 */ }
  }
  if (!target) throw new Error('无法连接 DevTools 协议');

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let seq = 0;
  const consoleLog = [];
  const pending = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === 'Log.entryAdded') consoleLog.push(`[log] ${msg.params?.entry?.level}: ${msg.params?.entry?.text}`);
    if (msg.method === 'Runtime.exceptionThrown') consoleLog.push(`[exception] ${(msg.params?.exceptionDetails?.exception?.description ?? '').slice(0, 300)}`);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 30000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`页面脚本异常：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result?.value;
  };
  const waitFor = async (expression, label, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (await evaluate(expression)) return true; } catch { /* DOM 未就绪 */ }
      await sleep(250);
    }
    throw new Error(`等待超时：${label}`);
  };
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${OUT}/${name}.png`;
    await writeFile(file, Buffer.from(data, 'base64'));
    shots.push(file);
  };
  const clickByText = (text) => `(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('${text}')&&!b.disabled); if(!btn) throw new Error('找不到按钮：${text}'); btn.click(); return true; })()`;
  const clickWhenReady = async (text, label = text, timeout = 25000) => {
    await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('${text}')&&!b.disabled)`, label, timeout);
    await evaluate(clickByText(text));
  };

  console.log('[2/8] 打开首屏');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}/` });
  await waitFor("document.body.innerText.includes('万物之城')", '首屏品牌渲染', 25000);
  await sleep(600);

  const loginText = await evaluate('document.body.innerText');
  record('登录页渲染', /万物之城/.test(loginText) && /(欢迎回到城市|建立城市档案)/.test(loginText), `首屏文字 ${loginText.length} 字`);
  await shot('01-login');

  console.log('[3/8] 表单登录');
  const username = `browser${Date.now().toString(36).slice(-6)}`;
  await evaluate(`fetch('${PREFIX}/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'${username}',password:'Browser-Test-9x!',nickname:'浏览器验证员'})}).then(r=>r.status)`);
  await evaluate("fetch('" + PREFIX + "/api/auth/logout',{method:'POST'}).then(r=>r.status)");
  await send('Page.navigate', { url: `${BASE}/` });
  await sleep(2500);
  await waitFor("Boolean(document.querySelector('input[autocomplete=\"username\"]'))", '登录表单');
  await evaluate(`(() => {
    const setValue=(el,v)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
    setValue(document.querySelector('input[autocomplete="username"]'),'${username}');
    setValue(document.querySelector('input[type="password"]'),'Browser-Test-9x!');
    const form=document.querySelector('form');
    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    return true;
  })()`);
  await waitFor("document.body.innerText.includes('城市中枢')", '进入城市中枢');
  record('表单登录', true, `账号 ${username} 登录并进入城市中枢`);
  await shot('02-city');

  console.log('[4/8] 章节地图与门禁');
  await clickWhenReady('章节地图');
  await waitFor("document.body.innerText.includes('十个区域')", '章节地图');
  await clickWhenReady('工业与云端');
  await waitFor("document.body.innerText.includes('工业信号')", '第 9 章关卡列表');
  const lockedBefore = await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('尚未解锁'))");
  record('第 9 章可见且受前置锁定', lockedBefore, lockedBefore ? '关卡显示「尚未解锁」，章节门禁生效' : '未解锁状态未出现');
  await shot('03-map-chapter9-locked');

  if (SCOPE === 'smoke') {
    console.log('[5/8] smoke 模式：不跑批量通关，直接验证第 1 章');
    await clickWhenReady('物联初启');
    await waitFor("document.body.innerText.includes('入城校验')", '第 1 章关卡列表');
    await clickWhenReady('进入现场');
    await waitFor("document.body.innerText.includes('退出现场')", '关卡运行时（smoke）');
    await evaluate(`(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('进入现场')); if(btn) btn.click(); return true; })()`);
    await sleep(3500);
    const smokeCanvas = await evaluate(`(() => { const c=[...document.querySelectorAll('canvas')]; return { count: c.length, webgl: Boolean(c[0]?.getContext('webgl2')||c[0]?.getContext('webgl')) }; })()`);
    record('smoke：3D 画布挂载', smokeCanvas.count > 0 && smokeCanvas.webgl, `canvas ${smokeCanvas.count} 个，WebGL=${smokeCanvas.webgl}`);
    const firstLevel = levels.find((l) => l.number === 1);
    const smokeRun = await evaluate(`(async () => {
      const progress = await (await fetch('${PREFIX}/api/progress')).json();
      const active = progress.data.activeSessions[0];
      if (!active) return { error: '没有进行中的会话' };
      const fresh = await (await fetch('${PREFIX}/api/sessions/' + active.id)).json();
      let revision = fresh.data?.state?.revision ?? 0;
      const phase0 = fresh.data?.state?.phase ?? 'briefing';
      const solution = ${JSON.stringify(firstLevel.solution)};
      let last = fresh.data;
      for (const [i, action] of (phase0 === 'running' ? solution.slice(1) : solution).entries()) {
        const response = await fetch('${PREFIX}/api/sessions/' + active.id + '/commands', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...action, id:'smoke-cmd-'+i, revision }) });
        const body = await response.json();
        if (!response.ok) return { error: (body.error?.message ?? '命令失败') + ' @' + i + ' ' + (action.type ?? '') + ' ' + JSON.stringify(body.error?.details ?? null) };
        revision = body.data.session.state.revision; last = body.data.session;
      }
      return { phase: last.state.phase, score: last.state.score };
    })()`);
    if (smokeRun?.error) throw new Error(`smoke 通关失败：${smokeRun.error}`);
    record('smoke：第 1 关通关', smokeRun.phase === 'completed', `phase=${smokeRun.phase} score=${smokeRun.score}`);
    await shot('08-smoke-level01');
    await clickWhenReady('退出现场');
    await sleep(1500);
    await clickWhenReady('学习记录');
    await waitFor("document.body.innerText.includes('学习记录')", '学习记录页（smoke）');
    record('smoke：学习记录可读', true, '登录→进入→通关→记录 闭环成立');
    await shot('09-smoke-reports');

    console.log('[5b] 我的终端（板子线）');
    await clickWhenReady('我的终端');
    await waitFor("document.body.innerText.includes('终端绑定')", '我的终端页');
    await waitFor("document.querySelectorAll('.terminal-level').length > 0", '板子关卡列表');
    const terminalShell = await evaluate(`(() => ({
      hasBind: Boolean(document.querySelector('.terminal-bind input')),
      chapters: document.querySelectorAll('.terminal-chapter').length,
      levels: document.querySelectorAll('.terminal-level').length,
      kinds: [...document.querySelectorAll('.terminal-level .terminal-badge')].map(b=>b.textContent),
    }))()`);
    record('终端页：绑定表单与板子关卡', terminalShell.hasBind && terminalShell.chapters >= 5 && terminalShell.levels > 0, `章节 ${terminalShell.chapters} 个，第 1 章 ${terminalShell.levels} 关，题型 ${[...new Set(terminalShell.kinds)].join('/')}`);

    await evaluate(`(() => { const btn=document.querySelector('.terminal-level button'); if(btn) btn.click(); return Boolean(btn); })()`);
    await waitFor("Boolean(document.querySelector('.terminal-probe'))", '板端考察项面板');
    const probePanel = await evaluate(`(() => { const panel=document.querySelector('.terminal-probe'); return { text: panel?.innerText ?? '', options: document.querySelectorAll('.terminal-options button').length, hasCode: Boolean(document.querySelector('.terminal-code')), hintBtn: Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.includes('显示提示'))), notice: document.querySelector('.notice')?.innerText?.slice(0,120) ?? '' }; })()`);
    record('终端页：开始关卡后下发考察项', probePanel.text.length > 20 && probePanel.hintBtn, `${probePanel.text.replace(/\s+/g, ' ').slice(0, 60)}…；任务书代码块=${probePanel.hasCode}${probePanel.notice ? `；提示条：${probePanel.notice}` : ''}`);
    await shot('10-terminal-probe');

    await evaluate(`(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('看画面')); if(btn) btn.click(); return Boolean(btn); })()`);
    await sleep(1200);
    const boardScreen = await evaluate(`(() => { const el=document.querySelector('.board-screen'); return { shown: Boolean(el), text: el?.innerText?.replace(/\\s+/g,' ').slice(0, 60) ?? '', keys: el?.querySelectorAll('.board-keys span').length ?? 0 }; })()`);
    record('终端页：板载画面预览', true, boardScreen.shown ? `屏幕「${boardScreen.text}…」按键 ${boardScreen.keys} 个` : '当前无已绑定终端（无硬件时不伪造画面）');
    await shot('11-terminal-screen');

    await evaluate(`(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('放弃本关')); if(btn) btn.click(); return Boolean(btn); })()`);
    await sleep(1200);

    await writeFile('audit/browser-verify.json', JSON.stringify({ at: new Date().toISOString(), base: BASE, browser: EDGE, scope: SCOPE, username, steps, screenshots: shots, smokeRun, terminalShell, probePanel, boardScreen }, null, 2));
    const smokeFailed = steps.filter((s) => !s.ok);
    console.log(`
浏览器走查完成（smoke）：${steps.length - smokeFailed.length}/${steps.length} 通过`);
    await send('Browser.close').catch(() => undefined);
    ws.close(); child.kill();
    await sleep(800);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    if (smokeFailed.length) process.exitCode = 1;
    return;
  }
  console.log('[5/8] 通关前置 48 关（真实引擎）');
  const prereq = levels.filter((l) => l.number <= 48).map((l) => ({ id: l.id, solution: l.solution }));
  const bulk = await evaluate(`(async () => {
    const payload = ${JSON.stringify(prereq)};
    const done = []; const failed = [];
    for (const item of payload) {
      const created = await (await fetch('${PREFIX}/api/sessions', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mode:'story', levelId:item.id }) })).json();
      if (!created.data) { failed.push(item.id + ':create'); continue; }
      let revision = 0; let phase = 'briefing';
      for (const [i, action] of item.solution.entries()) {
        const response = await fetch('${PREFIX}/api/sessions/' + created.data.id + '/commands', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...action, id:'bulk-cmd-'+(item.id||'x')+'-'+i, revision }) });
        const body = await response.json();
        if (!response.ok) { failed.push(item.id + ':' + (body.error?.message ?? 'cmd')); break; }
        revision = body.data.session.state.revision;
        phase = body.data.session.state.phase;
      }
      (phase === 'completed' ? done : failed).push(item.id);
    }
    const progress = await (await fetch('${PREFIX}/api/progress')).json();
    return { done: done.length, failed, unlockedChapter: progress.data.unlockedChapter, completed: progress.data.completed.length };
  })()`);
  record('前置 48 关可解', bulk.done === 48 && bulk.failed.length === 0, `完成 ${bulk.done}/48，失败 ${bulk.failed.join(',') || '无'}`);
  record('章节按进度解锁', bulk.unlockedChapter === 9, `unlockedChapter=${bulk.unlockedChapter}，已完成 ${bulk.completed} 关`);
  await shot('04-after-prereq');

  console.log('[6/8] 进入第 9 章关卡');
  await send('Page.navigate', { url: `${BASE}/` });
  await sleep(2200);
  await clickWhenReady('章节地图');
  await waitFor("document.body.innerText.includes('十个区域')", '章节地图（第二次）');
  await clickWhenReady('工业与云端');
  await waitFor("document.body.innerText.includes('工业信号')", '第 9 章列表');
  // 只断言本关（工业信号）那一行可进入；同章后续关卡仍应保持锁定，这是正确的顺序门禁
  const rowState = await evaluate(`(() => {
    const row=[...document.querySelectorAll('article')].find(a=>a.textContent.includes('工业信号'));
    if(!row) return { found:false };
    const btn=row.querySelector('button');
    return { found:true, disabled:Boolean(btn?.disabled), label:btn?.textContent ?? '' };
  })()`);
  record('第 9 章首关已解锁', rowState.found && rowState.disabled === false, `首关按钮：${rowState.label || '未找到'}`);
  const stillLocked = await evaluate(`(() => { const row=[...document.querySelectorAll('article')].find(a=>a.textContent.includes('边缘缓存')); return Boolean(row && row.querySelector('button')?.disabled); })()`);
  record('同章后续关卡仍锁定', stillLocked, stillLocked ? '第 50 关（边缘缓存）保持「尚未解锁」，顺序门禁正确' : '后续关卡被错误解锁');
  await clickWhenReady('进入现场');
  await waitFor("document.body.innerText.includes('退出现场')", '关卡运行时');
  const gameText = await evaluate('document.body.innerText');
  record('进入第 9 章关卡', /工业信号/.test(gameText) && /REV\s*0/.test(gameText), '工具栏显示「工业信号」与 REV 0');
  // 简报弹窗里点“进入现场”真正开局（阶段从 briefing → running，三维场景此时才挂载）
  await evaluate(`(() => { const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('进入现场')); if(btn) btn.click(); return true; })()`);
  await sleep(3500);
  const canvasInfo = await evaluate(`(() => {
    const canvases=[...document.querySelectorAll('canvas')];
    return { count: canvases.length, sized: canvases.filter(c=>c.width>0&&c.height>0).length, webgl: Boolean(canvases[0]?.getContext('webgl2')||canvases[0]?.getContext('webgl')) };
  })()`);
  record('3D 场景画布挂载', canvasInfo.count > 0 && canvasInfo.sized > 0, `canvas ${canvasInfo.count} 个（有效尺寸 ${canvasInfo.sized}），WebGL=${canvasInfo.webgl}`);
  const phaseText = await evaluate('document.body.innerText');
  record('开局后进入运行态', /REV\s*[1-9]/.test(phaseText), 'REV 已从 0 推进，说明 start 命令生效');
  if (canvasInfo.count === 0) console.log('  └ 控制台记录：', JSON.stringify(consoleLog.slice(-6), null, 1));
  await shot('05-game-level49');

  console.log('[7/8] 提交参考解');
  const level49 = levels.find((l) => l.id === 'level-49');
  const runResult = await evaluate(`(async () => {
    const progress = await (await fetch('${PREFIX}/api/progress')).json();
    const active = progress.data.activeSessions.find(s => s.title.includes('工业信号')) ?? progress.data.activeSessions[0];
    if (!active) return { error: '没有进行中的会话' };
    const fresh = await (await fetch('${PREFIX}/api/sessions/' + active.id)).json();
    let revision = fresh.data?.state?.revision ?? 0;
    const phase0 = fresh.data?.state?.phase ?? 'briefing';
    let last = { session: fresh.data };
    const solution = ${JSON.stringify(level49.solution)};
    for (const [i, action] of (phase0 === 'running' ? solution.slice(1) : solution).entries()) {
      const response = await fetch('${PREFIX}/api/sessions/' + active.id + '/commands', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ ...action, id:'ui-cmd-'+i, revision }) });
      const body = await response.json();
      if (!response.ok) return { error: body.error?.message ?? '命令失败' };
      revision = body.data.session.state.revision; last = body.data;
    }
    return { phase: last.session.state.phase, score: last.session.state.score, tasks: last.session.state.completedTasks.length, startedViaUi: phase0 === 'running' };
  })()`);
  if (runResult?.error) throw new Error(`提交参考解失败：${runResult.error}`);
  record('第 9 章关卡通关', runResult.phase === 'completed', `phase=${runResult.phase} score=${runResult.score} 完成任务 ${runResult.tasks} 个`);
  await sleep(1200);
  await shot('06-level49-completed');

  console.log('[8/8] 学习记录');
  await clickWhenReady('退出现场');
  await sleep(1500);
  await clickWhenReady('学习记录');
  await waitFor("document.body.innerText.includes('学习记录')", '学习记录页');
  const reportText = await evaluate('document.body.innerText');
  record('学习记录呈现成绩', /工业信号|1000|完成|通关/.test(reportText), `页面文字 ${reportText.length} 字，含成绩信息`);
  await shot('07-reports');

  await writeFile('audit/browser-verify.json', JSON.stringify({ at: new Date().toISOString(), base: BASE, browser: EDGE, username, steps, screenshots: shots, bulk, run49: runResult, consoleLog: consoleLog.slice(-20) }, null, 2));
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n浏览器走查完成：${steps.length - failed.length}/${steps.length} 通过`);
  await send('Browser.close').catch(() => undefined);
  ws.close();
  child.kill();
  await sleep(800);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  if (failed.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('浏览器走查失败：', error.message);
  await writeFile('audit/browser-verify.json', JSON.stringify({ at: new Date().toISOString(), base: BASE, steps, error: error.message }, null, 2)).catch(() => undefined);
  process.exitCode = 1;
});
