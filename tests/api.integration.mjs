import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:3220').replace(/\/$/, '');
const publicOrigin = process.env.PUBLIC_ORIGIN ?? new URL(baseUrl).origin;
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const reportPath = resolve(process.env.REPORT_PATH ?? 'audit/api-integration.json');
const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;
const prefix = `it${suffix}`.slice(0, 24);
const passwords = {
  a: process.env.TEST_STUDENT_A_PASSWORD ?? `A-${randomUUID()}-9x!`,
  b: process.env.TEST_STUDENT_B_PASSWORD ?? `B-${randomUUID()}-9x!`,
  teacher: process.env.TEST_TEACHER_PASSWORD ?? `T-${randomUUID()}-9x!`,
};
const report = { startedAt: new Date().toISOString(), baseUrl: new URL(baseUrl).origin, checks: [], limitations: ['This script covers API and WebSocket behavior only; it does not replace real multi-browser acceptance.'] };

class ApiFailure extends Error {
  constructor(endpoint, expected, actual) {
    super(`${endpoint}: expected ${expected}; received ${JSON.stringify(actual)}`);
    this.endpoint = endpoint;
    this.expected = expected;
    this.actual = actual;
  }
}

class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); }
  async request(method, path, body, { expected = [200], raw = false } = {}) {
    const endpoint = `${method} ${path}`;
    const headers = { origin: publicOrigin, 'content-type': 'application/json' };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new ApiFailure(endpoint, expected, { transportError: error?.name ?? 'network error' });
    }
    for (const item of response.headers.getSetCookie?.() ?? []) {
      const pair = item.split(';', 1)[0]; const at = pair.indexOf('=');
      if (at > 0) { const key = pair.slice(0, at), value = pair.slice(at + 1); if (value) this.cookies.set(key, value); else this.cookies.delete(key); }
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!expected.includes(response.status)) {
      const actual = raw ? { status: response.status } : { status: response.status, code: data?.error?.code ?? null };
      throw new ApiFailure(endpoint, expected.join('|'), actual);
    }
    return { status: response.status, data, headers: response.headers };
  }
  async json(method, path, body, options) {
    const result = await this.request(method, path, body, options);
    return result.data?.data ?? result.data;
  }
}

function check(name, fn) {
  return fn().then(actual => report.checks.push({ name, status: 'passed', actual }), error => {
    report.checks.push({ name, status: 'failed', endpoint: error.endpoint ?? 'local assertion', expected: error.expected ?? 'success', actual: error.actual ?? { error: error?.name ?? 'Error' } });
    throw error;
  });
}
function assert(condition, endpoint, expected, actual) { if (!condition) throw new ApiFailure(endpoint, expected, actual); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function command(action, revision) { return { id: randomUUID(), revision, ...action, payload: action.payload ?? {} }; }
async function applySolution(client, sessionId, solution) {
  let view = await client.json('GET', `/api/sessions/${sessionId}`);
  let resultRecord = null;
  for (const action of solution) {
    const response = await client.json('POST', `/api/sessions/${sessionId}/commands`, command(action, view.state.revision));
    view = response.session; resultRecord = response.resultRecord;
    if (view.state.phase === 'completed') break;
  }
  return { view, resultRecord };
}
function wsMessage(socket, predicate, timeoutMs = 6000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket response timeout')), timeoutMs);
    const onMessage = raw => { let value; try { value = JSON.parse(raw.toString()); } catch { return; } if (predicate(value)) { clearTimeout(timer); socket.off('message', onMessage); resolvePromise(value); } };
    socket.on('message', onMessage);
  });
}
function sendAndWait(socket, value, predicate) {
  const pending = wsMessage(socket, predicate);
  socket.send(JSON.stringify(value));
  return pending;
}
async function connectWs(client) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws`, { headers: { cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '), origin: publicOrigin } });
  await new Promise((resolvePromise, reject) => { socket.once('open', resolvePromise); socket.once('error', reject); setTimeout(() => reject(new Error('WebSocket connect timeout')), 6000); });
  return socket;
}

async function run() {
  if (!adminUsername || !adminPassword) throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required.');
  const admin = new Client('admin');
  await check('admin login', async () => {
    const value = await admin.json('POST', '/api/auth/login', { username: adminUsername, password: adminPassword });
    assert(value.role === 'admin', 'POST /api/auth/login', 'admin role', value.role); return { role: value.role };
  });
  const me = new Client('anonymous');
  await check('cookie session isolation and anonymous rejection', async () => {
    const result = await me.request('GET', '/api/auth/me', undefined, { expected: [401] });
    const adminMe = await admin.json('GET', '/api/auth/me');
    assert(adminMe.role === 'admin', 'GET /api/auth/me', 'authenticated admin', adminMe.role);
    return { anonymousStatus: result.status, adminRole: adminMe.role };
  });

  const studentA = new Client('student-a'), studentB = new Client('student-b');
  for (const [client, suffixPart] of [[studentA, 'a'], [studentB, 'b']]) {
    await check(`register ${suffixPart}`, async () => {
      const user = await client.json('POST', '/api/auth/register', { username: `${prefix}${suffixPart}`.slice(0, 32), password: passwords[suffixPart] });
      assert(user.role === 'student', 'POST /api/auth/register', 'student role', user.role); return { role: user.role };
    });
  }
  const teacherSeed = new Client('teacher-seed');
  const teacher = new Client('teacher');
  const teacherName = `${prefix}t`.slice(0, 32);
  const teacherFixture = await teacherSeed.json('POST', '/api/auth/register', { username: teacherName, password: passwords.teacher });
  await check('promote isolated fixture to teacher', async () => {
    const promoted = await admin.json('PATCH', `/api/admin/users/${teacherFixture.id}`, { role: 'teacher' });
    assert(promoted.role === 'teacher', 'PATCH /api/admin/users/:id', 'teacher role', promoted.role); return { role: promoted.role };
  });

  const adminContent = await admin.json('GET', '/api/content');
  const official = adminContent.find(row => row.id === 'level-01') ?? adminContent.find(row => /^level-\d+$/.test(row.id));
  assert(official, 'GET /api/content', 'an official seed level', null);
  const fullLevel = await admin.json('GET', `/api/content/${official.id}`);
  const solution = fullLevel.level.solution;
  assert(Array.isArray(solution) && solution.length >= 3, 'GET /api/content/:id', 'official solution for admin-only use', 'missing/short solution');

  let originalSession;
  await check('complete official level with server-computed result and idempotent retry', async () => {
    originalSession = await studentA.json('POST', '/api/sessions', { levelId: official.id, mode: 'story' });
    assert(!('solution' in originalSession.level) && !('failureCase' in originalSession.level), 'POST /api/sessions', 'student session hides solution and failure case', Object.keys(originalSession.level));
    const firstAction = solution[0];
    const firstCommand = command(firstAction, originalSession.state.revision);
    const first = await studentA.json('POST', `/api/sessions/${originalSession.id}/commands`, firstCommand);
    const repeated = await studentA.json('POST', `/api/sessions/${originalSession.id}/commands`, firstCommand);
    assert(repeated.result.state.revision === first.result.state.revision, 'POST /api/sessions/:id/commands', 'same event revision on exact retry', repeated.result.state.revision);
    let view = first.session, resultRecord = first.resultRecord;
    for (const action of solution.slice(1)) {
      const next = await studentA.json('POST', `/api/sessions/${originalSession.id}/commands`, command(action, view.state.revision));
      view = next.session; resultRecord = next.resultRecord;
      if (view.state.phase === 'completed') break;
    }
    assert(view.state.phase === 'completed' && resultRecord, 'POST /api/sessions/:id/commands', 'completed session with server result record', { phase: view.state.phase, hasResult: !!resultRecord });
    return { phase: view.state.phase, score: resultRecord.score, stars: resultRecord.stars };
  });

  await check('revision conflict, cross-user session isolation, pause/resume and restore after login', async () => {
    const session = await studentA.json('POST', '/api/sessions', { levelId: official.id, mode: 'story' });
    const start = command(solution[0], session.state.revision);
    await studentA.json('POST', `/api/sessions/${session.id}/commands`, start);
    await studentA.request('POST', `/api/sessions/${session.id}/commands`, command(solution[1], session.state.revision), { expected: [409] });
    await studentB.request('GET', `/api/sessions/${session.id}`, undefined, { expected: [404] });
    const saved = await studentA.json('GET', `/api/sessions/${session.id}`);
    const paused = await studentA.json('POST', `/api/sessions/${session.id}/commands`, command({ type: 'pause' }, saved.state.revision));
    const resumed = await studentA.json('POST', `/api/sessions/${session.id}/commands`, command({ type: 'resume' }, paused.session.state.revision));
    await studentA.json('POST', '/api/auth/logout', {});
    const relogin = new Client('student-a-relogin');
    await relogin.json('POST', '/api/auth/login', { username: `${prefix}a`.slice(0, 32), password: passwords.a });
    const restored = await relogin.json('GET', `/api/sessions/${session.id}`);
    assert(restored.state.revision === resumed.session.state.revision, 'GET /api/sessions/:id', 'session restored after fresh login', restored.state.revision);
    return { conflict: 409, isolation: 404, paused: paused.session.state.phase, resumed: resumed.session.state.phase, restoredRevision: restored.state.revision };
  });

  await check('class ownership, memberships, password reset, last-admin guard, sandbox challenge and leaderboard', async () => {
    const teacherUser = (await admin.json('GET', '/api/admin/users')).find(u => u.username === teacherName);
    await teacher.json('POST', '/api/auth/login', { username: teacherName, password: passwords.teacher });
    const cls = await teacher.json('POST', '/api/classes', { name: `${prefix} class` });
    await studentA.json('POST', '/api/auth/login', { username: `${prefix}a`.slice(0, 32), password: passwords.a });
    await studentA.json('POST', '/api/classes/join', { code: cls.code });
    await studentB.request('GET', `/api/classes/${cls.id}/members`, undefined, { expected: [403] });
    const members = await teacher.json('GET', `/api/classes/${cls.id}/members`);
    assert(members.some(m => m.username === `${prefix}a`.slice(0, 32)), 'GET /api/classes/:id/members', 'own class roster', members.length);
    const teacherLevel = (await teacher.json('GET', '/api/content')).find(row => row.id === official.id);
    assert(teacherLevel, 'GET /api/content', 'published official level visible to teacher', null);
    const custom = await teacher.json('POST', '/api/content', { level: fullLevel.level });
    await teacher.json('POST', `/api/content/${custom.id}/publish`, { classId: cls.id });
    await teacher.json('POST', `/api/classes/${cls.id}/assignments`, { levelId: custom.id, title: `${prefix} assignment`, mode: 'story' });
    const pinned = await studentA.json('POST', '/api/sessions', { levelId: custom.id, mode: 'story' });
    const definition = (await teacher.json('GET', `/api/content/${custom.id}`)).level;
    await teacher.json('PUT', `/api/content/${custom.id}`, { level: { ...definition, title: `${definition.title} v2` } });
    await teacher.json('POST', `/api/content/${custom.id}/publish`, { classId: cls.id });
    const completedPinned = await applySolution(studentA, pinned.id, fullLevel.level.solution);
    assert(completedPinned.view.state.phase === 'completed', 'POST /api/sessions/:id/commands', 'complete pinned old-version session', completedPinned.view.state.phase);
    const pinnedReload = await studentA.json('GET', `/api/sessions/${pinned.id}`);
    assert(pinnedReload.level.version === 1, 'GET /api/sessions/:id', 'old session remains pinned to content version 1', pinnedReload.level.version);
    const events = await studentA.json('GET', `/api/sessions/${pinned.id}/events`);
    assert(Array.isArray(events.events), 'GET /api/sessions/:id/events', 'event replay list', typeof events.events);
    const finalSnapshot = [...events.events].reverse().find(event => event.state)?.state;
    assert(finalSnapshot && JSON.stringify(stable(finalSnapshot)) === JSON.stringify(stable(pinnedReload.state)), 'GET /api/sessions/:id/events', 'replay final snapshot matches saved state', finalSnapshot?.revision);
    const adminUsers = await admin.json('GET', '/api/admin/users');
    const activeAdmins = adminUsers.filter(u => u.role === 'admin' && !u.disabled);
    if (activeAdmins.length === 1) await admin.request('PATCH', `/api/admin/users/${activeAdmins[0].id}`, { disabled: true }, { expected: [409] });
    const newPassword = `R-${randomUUID()}-8z!`;
    await admin.json('POST', `/api/admin/users/${teacherUser.id}/reset-password`, { password: newPassword });
    await teacher.request('GET', '/api/auth/me', undefined, { expected: [401] });
    await teacher.json('POST', '/api/auth/login', { username: teacherName, password: newPassword });
    const freeSandbox = await studentA.json('POST', '/api/sessions', { mode: 'sandbox' });
    const standardSandbox = await studentA.json('POST', '/api/sessions', { mode: 'sandbox', challenge: true });
    assert(!freeSandbox.state.flags.includes('standard-sandbox') && standardSandbox.state.flags.includes('standard-sandbox'), 'POST /api/sessions', 'free sandbox excluded and standard challenge flagged', [freeSandbox.state.flags, standardSandbox.state.flags]);
    const board = await studentA.json('GET', '/api/leaderboards?mode=overall&scope=individual&season=all');
    assert(Array.isArray(board), 'GET /api/leaderboards', 'array', typeof board);
    return { classRosterCount: members.length, oldTeacherCookieRejected: true, pinnedVersion: pinnedReload.level.version, replayEvents: events.events.length, replayStateMatches: true, freeSandboxExcluded: true, standardChallengeFlagged: true, leaderboardEntries: board.length };
  });

  await check('WebSocket room authorization, coop and PvP authority / capacity', async () => {
    const host = new Client('room-host'), guest = new Client('room-guest');
    await host.json('POST', '/api/auth/login', { username: `${prefix}a`.slice(0, 32), password: passwords.a });
    await guest.json('POST', '/api/auth/login', { username: `${prefix}b`.slice(0, 32), password: passwords.b });
    const coopLevel = await admin.json('GET', '/api/content/level-06');
    const room = await host.json('POST', '/api/rooms', { mode: 'coop', levelId: 'level-06', maxPlayers: 2 });
    const socketA = await connectWs(host), socketB = await connectWs(guest);
    try {
      await sendAndWait(socketA, { type: 'join', roomId: room.id }, m => m.type === 'room');
      await guest.json('POST', '/api/rooms/join', { code: room.code });
      await teacher.request('POST', '/api/rooms/join', { code: room.code }, { expected: [409] });
      await sendAndWait(socketB, { type: 'join', roomId: room.id }, m => m.type === 'room');
      await host.json('POST', `/api/rooms/${room.id}/ready`, { ready: true, engineerRole: 'debug' });
      await guest.json('POST', `/api/rooms/${room.id}/ready`, { ready: true, engineerRole: 'debug' });
      await host.json('POST', `/api/rooms/${room.id}/start`, {});
      const pong = await sendAndWait(socketA, { type: 'ping' }, m => m.type === 'pong');
      let latest = (await host.json('GET', `/api/rooms/${room.id}`)).states['0'];
      let applied = 0;
      for (let i = 0; i < coopLevel.level.solution.length; i++) {
        const actor = i % 2 === 0 ? socketA : socketB;
        const action = coopLevel.level.solution[i];
        if (action.type === 'start') continue; // Room start already started the authoritative engine.
        const sent = command(action, latest.revision);
        const ack = await sendAndWait(actor, { type: 'command', roomId: room.id, command: sent }, m => m.type === 'ack' && m.commandId === sent.id);
        assert(ack.accepted, 'WS /ws command', 'accepted solution action', ack.accepted);
        latest = ack.room.states['0']; applied++;
        if (ack.room.status === 'finished') break;
      }
      assert(latest.phase === 'completed', 'WS /ws command', 'coop level completed', latest.phase);
      const pvp = await host.json('POST', '/api/rooms', { mode: 'pvp', levelId: 'level-01', maxPlayers: 2 });
      await guest.json('POST', '/api/rooms/join', { code: pvp.code });
      const pvpA = await connectWs(host), pvpB = await connectWs(guest);
      try {
        await sendAndWait(pvpA, { type: 'join', roomId: pvp.id }, m => m.type === 'room');
        await sendAndWait(pvpB, { type: 'join', roomId: pvp.id }, m => m.type === 'room');
        await host.json('POST', `/api/rooms/${pvp.id}/ready`, { ready: true, engineerRole: 'debug' });
        await guest.json('POST', `/api/rooms/${pvp.id}/ready`, { ready: true, engineerRole: 'debug' });
        await host.json('POST', `/api/rooms/${pvp.id}/start`, {});
        const attemptPvpPause = command({ type: 'pause' }, 0);
        const forbiddenPause = await sendAndWait(pvpA, { type: 'command', roomId: pvp.id, command: attemptPvpPause }, m => m.type === 'error');
        assert(forbiddenPause.code === 'PVP_CANNOT_PAUSE', 'WS /ws command', 'PvP pause rejected', forbiddenPause.code);
        let state0 = (await host.json('GET', `/api/rooms/${pvp.id}`)).states['0'];
        for (const action of fullLevel.level.solution) {
          if (action.type === 'start') continue;
          const c = command(action, state0.revision);
          const ack = await sendAndWait(pvpA, { type: 'command', roomId: pvp.id, command: c }, m => m.type === 'ack' && m.commandId === c.id);
          assert(ack.accepted, 'WS /ws command', 'accepted PvP solution action', ack.accepted);
          state0 = ack.room.states['0']; if (ack.room.status === 'finished') break;
        }
        const finalRoom = await host.json('GET', `/api/rooms/${pvp.id}`);
        assert(finalRoom.status === 'finished', 'GET /api/rooms/:id', 'PvP server settlement after completion', finalRoom.status);
        return { coopStarted: true, coopSolutionCommands: applied, coopPhase: latest.phase, pvpFinished: finalRoom.status, pvpPauseRejected: forbiddenPause.code, authenticatedWebSocket: true, ping: pong.type, browserAutomation: 'not covered by this script' };
      } finally { pvpA.close(); pvpB.close(); }
    } finally { socketA.close(); socketB.close(); }
  });
}

try { await run(); }
catch (error) {
  report.failure = error instanceof ApiFailure ? { endpoint: error.endpoint, expected: error.expected, actual: error.actual } : { endpoint: 'test setup', expected: 'successful acceptance run', actual: { error: error?.name ?? 'Error' } };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
