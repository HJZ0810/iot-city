/**
 * P6 性能实测探针（CDP + Edge headless）
 * 指标：首屏 FCP/load、3D 场景挂载耗时、5s 采样 FPS、JS 堆内存。
 * 用法：BASE_URL=https://iot.luo-jin-ai.com/legacy node perf-probe.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const BASE = (process.env.BASE_URL ?? 'https://iot.luo-jin-ai.com/legacy').replace(/\/$/, '');
const PREFIX = new URL(BASE).pathname.replace(/\/+$/, '');
const PORT = Number(process.env.VERIFY_PORT ?? 9227);
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p));
if (!EDGE) throw new Error('找不到 Edge/Chrome');
const profile = `C:/Users/Administrator/AppData/Local/Temp/perf-profile-${Date.now()}`;

async function main() {
  const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1440,900', `${BASE}/`], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* 未就绪 */ }
  }
  if (!target) { child.kill(); throw new Error('无法连接 DevTools'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  let seq = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (!m.id || !pending.has(m.id)) return; const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 30000); pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
  const waitFor = async (expression, label, timeout = 25000) => { const t = Date.now(); while (Date.now() - t < timeout) { try { if (await evaluate(expression)) return true; } catch { /* DOM 未就绪 */ } await sleep(250); } throw new Error(`等待超时：${label}`); };
  const clickByText = (text) => `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('${text}')&&!x.disabled); if(!b) throw new Error('找不到按钮：${text}'); b.click(); return true; })()`;

  const result = { at: new Date().toISOString(), base: BASE, metrics: {}, notes: [] };
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${BASE}/` });
    await waitFor("document.body.innerText.includes('万物之城')", '首屏品牌渲染');
    const nav = await evaluate(`(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint').find(x=>x.name==='first-contentful-paint'); return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: p ? Math.round(p.startTime) : null, transfer: Math.round(n.transferSize), resources: performance.getEntriesByType('resource').length }; })()`);
    result.metrics.firstScreen = nav;

    // 登录（注册测试账号，与 smoke 同口径）
    const username = `perf${Date.now().toString(36).slice(-6)}`;
    await evaluate(`fetch('${PREFIX}/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'${username}',password:'Perf-Test-9x!',nickname:'性能探针'})}).then(r=>r.status)`);
    await evaluate(`fetch('${PREFIX}/api/auth/logout',{method:'POST'})`);
    await send('Page.navigate', { url: `${BASE}/` });
    await sleep(2500);
    await evaluate(`(() => { const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}; set(document.querySelector('input[autocomplete="username"]'),'${username}'); set(document.querySelector('input[type="password"]'),'Perf-Test-9x!'); const f=document.querySelector('form'); f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
    await waitFor("document.body.innerText.includes('城市中枢')", '进入城市中枢');

    // 进入第 1 章第 1 关，测量 3D 场景挂载耗时
    await evaluate(clickByText('章节地图'));
    await waitFor("document.body.innerText.includes('十个区域')", '章节地图');
    await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('物联初启'))", '第 1 章卡片');
    await evaluate(clickByText('物联初启'));
    await waitFor("document.body.innerText.includes('入城校验')", '关卡列表');
    const sceneStart = Date.now();
    await evaluate(clickByText('进入现场'));
    await waitFor("document.body.innerText.includes('退出现场')", '关卡运行时');
    await evaluate(clickByText('进入现场')); // 第二击：真正载入 3D 场景
    await waitFor("Boolean(document.querySelector('canvas'))", '3D 画布挂载').catch(async (error) => {
      const diag = await evaluate(`(() => ({ text: document.body.innerText.slice(0, 300), canvases: document.querySelectorAll('canvas').length, buttons: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0, 25) }))()`);
      throw new Error(`${error.message}；诊断：${JSON.stringify(diag).slice(0, 500)}`);
    });
    result.metrics.sceneMountMs = Date.now() - sceneStart;
    await sleep(2500); // 等贴图与场景稳定

    // FPS 5s 采样 + 堆内存
    const fps = await evaluate(`new Promise((resolve) => { let frames = 0; const t0 = performance.now(); const tick = () => { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else resolve({ fps: Math.round(frames / ((performance.now() - t0) / 1000)), frames }); }; requestAnimationFrame(tick); })`);
    result.metrics.fps = fps;
    result.metrics.memory = await evaluate(`(() => { const m = performance.memory; return m ? { usedJSHeapMB: Math.round(m.usedJSHeapSize / 1048576), totalJSHeapMB: Math.round(m.totalJSHeapSize / 1048576) } : null; })()`);
    const canvasInfo = await evaluate(`(() => { const c = document.querySelector('canvas'); return c ? { width: c.width, height: c.height, webgl: Boolean(c.getContext('webgl2') || c.getContext('webgl')) } : null; })()`);
    result.metrics.canvas = canvasInfo;
  } catch (error) {
    result.error = error.message;
  } finally {
    try { await send('Browser.close'); } catch { /* 忽略 */ }
    ws.close(); child.kill();
    await new Promise((r) => setTimeout(r, 500));
    const { rm } = await import('node:fs/promises');
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.error) process.exitCode = 1;
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
