/**
 * WebSocket 实时通道验收（P4 多人联机的可复跑最小闭环）
 * 双真实用户 → 建房/加入 → WS 鉴权 → ping/pong → join 同步 → ready → start → WS 命令 → ack 与广播。
 * 用法：BASE_URL=https://iot.luo-jin-ai.com/legacy node scripts/ws-verify.mjs
 * 产物：audit/ws-verify.json（steps + 关键房间状态）。
 */
import WebSocket from 'ws';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:3220').replace(/\/$/, '');
const endpoint = new URL(base);
const wsUrl = `${endpoint.protocol === 'https:' ? 'wss' : 'ws'}://${endpoint.host}${endpoint.pathname.replace(/\/+$/, '')}/ws`;
const origin = endpoint.origin;
const suffix = Date.now().toString(36).slice(-6);
const steps = [];
const record = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`); };

class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); }
  async request(method, path, body, expected = [200]) {
    const headers = { origin, 'content-type': 'application/json' };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const [k, v] of response.headers.entries()) if (k === 'set-cookie') { const [pair] = v.split(';'); const [ck, cv] = pair.split('='); this.cookies.set(ck, cv); }
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!expected.includes(response.status)) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
    return json?.data ?? json;
  }
}

const connect = (client) => new Promise((resolve, reject) => {
  const cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const socket = new WebSocket(wsUrl, { headers: { origin, cookie } });
  const inbox = [];
  socket.on('message', (raw) => { try { inbox.push(JSON.parse(raw.toString())); } catch { /* 忽略 */ } });
  socket.on('open', () => resolve({ socket, inbox }));
  socket.on('error', reject);
  socket.on('close', (code) => { if (!socket.__resolved) reject(new Error(`WS 提前关闭 code=${code}`)); });
});
const send = (socket, data) => socket.send(JSON.stringify(data));
const waitFor = async (inbox, predicate, label, timeout = 15000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等待超时：${label}`);
};

async function main() {
  console.log(`WS 验收目标：${wsUrl}`);
  const a = new Client('A'), b = new Client('B');
  const userA = `wsa${suffix}`, userB = `wsb${suffix}`;
  await a.request('POST', '/api/auth/register', { username: userA, password: 'Ws-Verify-9x!', nickname: '联机验收A' });
  await b.request('POST', '/api/auth/register', { username: userB, password: 'Ws-Verify-9x!', nickname: '联机验收B' });
  record('双用户注册', true, `${userA} / ${userB}`);

  const levels = await a.request('GET', '/api/levels');
  const levelId = levels[0]?.id;
  record('获取关卡', Boolean(levelId), `首关 ${levelId}`);

  const room = await a.request('POST', '/api/rooms', { mode: 'coop', maxPlayers: 2, levelId });
  record('创建协作房间', Boolean(room?.code), `code=${room.code} status=${room.status}`);
  const joined = await b.request('POST', '/api/rooms/join', { code: room.code });
  record('邀请码加入', joined.players.length === 2, `玩家 ${joined.players.map((p) => `${p.nickname}/${p.engineerRole}`).join(' + ')}`);

  const ca = await connect(a), cb = await connect(b);
  record('WS 鉴权连接', ca.socket.readyState === 1 && cb.socket.readyState === 1, '双用户 WS 均通过 Cookie 鉴权打开');
  send(ca.socket, { type: 'ping' }); send(cb.socket, { type: 'ping' });
  const pongA = await waitFor(ca.inbox, (m) => m.type === 'pong', 'A pong');
  const pongB = await waitFor(cb.inbox, (m) => m.type === 'pong', 'B pong');
  record('ping/pong', Boolean(pongA && pongB), `serverTime A=${pongA.serverTime} B=${pongB.serverTime}`);

  send(ca.socket, { type: 'join', roomId: room.id }); send(cb.socket, { type: 'join', roomId: room.id });
  const roomA = await waitFor(ca.inbox, (m) => m.type === 'room' && m.room.id === room.id, 'A 房间视图');
  const roomB = await waitFor(cb.inbox, (m) => m.type === 'room' && m.room.id === room.id, 'B 房间视图');
  const onlineA = roomA.room.players.filter((p) => p.online).length;
  const onlineB = roomB.room.players.filter((p) => p.online).length;
  record('join 在线同步', onlineA === 2 && onlineB === 2, `A 视野在线 ${onlineA} 人，B 视野在线 ${onlineB} 人`);

  await a.request('POST', `/api/rooms/${room.id}/ready`, { ready: true, engineerRole: 'network' });
  await b.request('POST', `/api/rooms/${room.id}/ready`, { ready: true, engineerRole: 'sensor' });
  record('双方准备', true, 'A=network B=sensor');
  const started = await a.request('POST', `/api/rooms/${room.id}/start`, {});
  record('队长开始', started.status === 'playing' && Boolean(started.states['0']), `status=${started.status} 共享会话=${Boolean(started.states['0'])}`);
  await waitFor(cb.inbox, (m) => m.type === 'room' && m.room.status === 'playing', 'B 收到开始广播');

  const deviceId = Object.keys(started.states['0'].devices)[0];
  const command = { id: `ws-cmd-${randomUUID().slice(0, 8)}`, revision: started.states['0'].revision ?? 0, type: 'inspect', target: deviceId, payload: {} };
  send(ca.socket, { type: 'command', roomId: room.id, command });
  const ack = await waitFor(ca.inbox, (m) => m.type === 'ack' && m.commandId === command.id, '命令 ack').catch((error) => {
    const recent = ca.inbox.slice(-4).map((m) => m.type + (m.code ? `:${m.code}` : '') + (m.message ? ` ${m.message}` : '')).join(' | ');
    throw new Error(`${error.message}；近期消息：${recent || '无'}`);
  });
  record('WS 命令执行', ack.accepted === true, `${command.type} ${deviceId} -> accepted=${ack.accepted} ${ack.message ?? ''}`);
  const broadcastB = await waitFor(cb.inbox, (m) => m.type === 'room' && m.room.revision > started.revision, 'B 收到状态广播');
  record('状态广播到达队友', Boolean(broadcastB), `revision ${started.revision} -> ${broadcastB.room.revision}`);

  await a.request('POST', `/api/rooms/${room.id}/leave`).catch(() => undefined);
  await b.request('POST', `/api/rooms/${room.id}/leave`).catch(() => undefined);
  ca.socket.close(); cb.socket.close();

  await mkdir('audit', { recursive: true });
  await writeFile('audit/ws-verify.json', JSON.stringify({ at: new Date().toISOString(), base, wsUrl, users: [userA, userB], roomId: room.id, steps }, null, 2));
  const failed = steps.filter((s) => !s.ok);
  console.log(`\nWS 验收完成：${steps.length - failed.length}/${steps.length} 通过`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => { console.error(`WS 验收失败：${error.message}`); process.exitCode = 1; });
