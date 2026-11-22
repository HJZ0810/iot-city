import { hcpLimits, type HudKey, type HudScreen, type HudWidget, type HwKeyId } from '../../../../packages/shared/src/hardware.ts';
import type { DeviceState, GameState, LevelDefinition, SessionView } from '../../../../packages/shared/src/index.ts';

/**
 * 把服务端权威的会话状态投影成一块小屏幕能显示的 HUD。
 * 本模块是纯函数：输入会话状态 + 焦点 + 设备可用按键，输出 HUD 帧与按键映射。
 * 任何解法、答案、失败条件都不会出现在输出中。
 */
/** 引擎只需要 HUD 用得到的那部分关卡字段，解法与失败条件永远不进入显示层。 */
type HudLevel = Omit<LevelDefinition, 'solution' | 'failureCase' | 'questions'>;

export interface HudBuildInput {
  session: Pick<SessionView, 'mode' | 'level' | 'state' | 'elapsedSeconds'>;
  focusIndex: number;
  keys: readonly HwKeyId[];
}
export interface HudBuildResult {
  screen: HudScreen;
  focusIndex: number;
}

const phaseText: Record<GameState['phase'], string> = { briefing: '待开始', running: '进行中', paused: '已暂停', completed: '已完成', failed: '已失败' };
const statusText: Record<DeviceState['status'], string> = { online: '在线', offline: '离线', fault: '故障' };
const metricUnit: Record<string, string> = { temperature: '°C', humidity: '%', moisture: '%', light: 'lx', pressure: 'kPa', air: 'ppm', power: 'W', traffic: '辆', vibration: 'mm/s' };

const clamp = (n: number, total: number) => (total <= 0 ? 0 : Math.max(0, Math.min(total - 1, Math.trunc(n) || 0)));
const firstNumber = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(1, limit - 1))}…`;
}

/** 候选动作按「教学价值」排序，再按设备实际按键数量依次绑定，3 键手持机与 6 键面板共用同一套逻辑。 */
type Action = Omit<HudKey, 'k'>;
function bind(actions: Action[], keys: readonly HwKeyId[]): HudKey[] {
  return actions.slice(0, Math.min(keys.length, hcpLimits.keys)).map((action, index) => ({ k: keys[index]!, ...action }));
}

function nextTask(level: HudLevel, state: GameState) {
  return level.tasks.find((task) => !state.completedTasks.includes(task.id) && task.requires.every((r) => state.completedTasks.includes(r)));
}

function readingUnit(level: HudLevel, deviceId: string): string {
  const def = level.devices.find((d) => d.id === deviceId);
  const metric = def?.parameters.metric?.value;
  const unit = def?.parameters.unit?.value;
  if (typeof unit === 'string' && unit) return unit;
  return typeof metric === 'string' ? (metricUnit[metric] ?? '') : '';
}

function deviceWidgets(level: HudLevel, state: GameState, deviceId: string): HudWidget[] {
  const def = level.devices.find((d) => d.id === deviceId);
  const device = state.devices[deviceId];
  if (!def || !device) return [{ t: 'alert', level: 'warn', v: '场景中没有可显示的设备。' }];
  const widgets: HudWidget[] = [{ t: 'kv', k: '设备', v: clip(def.label, 30), tone: device.status === 'fault' ? 'bad' : device.status === 'offline' ? 'warn' : 'ok' }];
  widgets.push({ t: 'kv', k: '状态', v: statusText[device.status] ?? device.status });
  if (def.kind === 'sensor') {
    widgets.push({ t: 'kv', k: '读数', v: `${Math.round(device.reading * 100) / 100}${readingUnit(level, deviceId)}` });
    const history = state.telemetry?.[deviceId]?.history?.slice(-hcpLimits.sparkPoints) ?? [];
    if (history.length >= 2) widgets.push({ t: 'spark', label: '采样曲线', pts: history.map((v) => Math.round(v * 100) / 100) });
  } else {
    const duty = firstNumber(device.parameters.duty, NaN);
    if (Number.isFinite(duty)) widgets.push({ t: 'bar', label: '输出占空比', v: duty, max: 100 });
    widgets.push({ t: 'kv', k: '使能', v: device.parameters.state === false ? '关闭' : '开启' });
  }
  if (device.faults.length) widgets.push({ t: 'alert', level: 'warn', v: clip(`故障：${device.faults.join('、')}`, 150) });
  return widgets;
}

function consoleScreen(input: HudBuildInput, focusIndex: number): HudBuildResult {
  const { session, keys } = input;
  const level: HudLevel = session.level;
  const state = session.state;
  const devices = level.devices;
  const index = clamp(focusIndex, devices.length);
  const focusId = devices[index]?.id;
  const widgets: HudWidget[] = [
    { t: 'kv', k: '进度', v: `${state.completedTasks.length}/${level.tasks.length} 任务` },
    { t: 'kv', k: '用时', v: `${Math.floor(session.elapsedSeconds / 60)}:${String(session.elapsedSeconds % 60).padStart(2, '0')}` },
  ];
  widgets.push({
    t: 'list',
    label: '任务',
    items: level.tasks.slice(0, 6).map((task) => ({
      k: clip(task.label, 40),
      st: state.completedTasks.includes(task.id) ? 'done' : nextTask(level, state)?.id === task.id ? 'focus' : 'todo',
    })),
  });
  if (focusId) widgets.push(...deviceWidgets(level, state, focusId));
  const feedback = state.feedback.at(-1);
  if (feedback) widgets.push({ t: 'alert', level: state.errors > 0 && !state.feedback.length ? 'warn' : 'info', v: clip(feedback, 150) });

  const task = nextTask(level, state);
  const actions: Action[] = [
    { lb: '检查设备', cmd: 'inspect', tg: focusId, tone: 'primary' },
    { lb: '下一设备', nav: 'focus-next' },
    { lb: '仿真1秒', cmd: 'simulate', pl: { ticks: 1 } },
    ...(task ? [{ lb: '任务提示', cmd: 'hint' as const, tg: task.id }] : []),
    { lb: '暂停', cmd: 'pause' as const, tone: 'warn' as const },
  ];
  return {
    focusIndex: index,
    screen: {
      id: 'console',
      rev: 0,
      title: clip(`${level.number}. ${level.title}`, 60),
      subtitle: `${phaseText[state.phase]} · 得分 ${state.score}`,
      widgets: widgets.slice(0, hcpLimits.widgets),
      km: bind(actions, keys),
      focus: focusId,
      elapsed: Math.max(0, Math.floor(session.elapsedSeconds)),
      score: Math.max(0, Math.trunc(state.score)),
      online: true,
    },
  };
}

function briefingScreen(input: HudBuildInput, focusIndex: number): HudBuildResult {
  const { session, keys } = input;
  const level: HudLevel = session.level;
  const state = session.state;
  const dialogueIndex = state.dialogs.length;
  const task = nextTask(level, state);
  const widgets: HudWidget[] = [
    { t: 'text', v: clip(level.briefing, hcpLimits.hudTextChars), size: 's' },
    { t: 'kv', k: '联络人', v: clip(level.npc.name, 24) },
  ];
  if (session.mode === 'timed' && level.timeLimitSeconds) widgets.push({ t: 'kv', k: '限时', v: `${Math.ceil(level.timeLimitSeconds / 60)} 分钟`, tone: 'warn' });
  const actions: Action[] = [{ lb: '开始任务', cmd: 'start', tone: 'primary' }];
  if (dialogueIndex < level.npc.lines.length) actions.push({ lb: '继续对话', cmd: 'dialog', tg: 'npc', pl: { index: dialogueIndex } });
  if (task) actions.push({ lb: '任务提示', cmd: 'hint', tg: task.id });
  return {
    focusIndex: clamp(focusIndex, level.devices.length),
    screen: {
      id: 'briefing',
      rev: 0,
      title: clip(level.title, 60),
      subtitle: clip(level.subtitle, 120),
      widgets: widgets.slice(0, hcpLimits.widgets),
      km: bind(actions, keys),
      focus: level.devices[focusIndex]?.id,
      elapsed: Math.max(0, Math.floor(session.elapsedSeconds)),
      score: 0,
      online: true,
    },
  };
}

function pausedScreen(input: HudBuildInput, focusIndex: number): HudBuildResult {
  const { session, keys } = input;
  const level: HudLevel = session.level;
  const state = session.state;
  const task = nextTask(level, state);
  const actions: Action[] = [{ lb: '继续任务', cmd: 'resume', tone: 'primary' }];
  if (task) actions.push({ lb: '任务提示', cmd: 'hint', tg: task.id });
  return {
    focusIndex: clamp(focusIndex, level.devices.length),
    screen: {
      id: 'paused',
      rev: 0,
      title: clip(level.title, 60),
      subtitle: '任务已暂停，进度保存在服务器',
      widgets: [
        { t: 'kv', k: '进度', v: `${state.completedTasks.length}/${level.tasks.length} 任务` },
        { t: 'kv', k: '用时', v: `${Math.floor(session.elapsedSeconds / 60)}:${String(session.elapsedSeconds % 60).padStart(2, '0')}` },
      ],
      km: bind(actions, keys),
      elapsed: Math.max(0, Math.floor(session.elapsedSeconds)),
      score: Math.max(0, Math.trunc(state.score)),
      online: true,
    },
  };
}

function finishedScreen(input: HudBuildInput): HudBuildResult {
  const { session, keys } = input;
  const level: HudLevel = session.level;
  const state = session.state;
  const passed = state.phase === 'completed';
  const stars = state.score >= 900 ? 3 : state.score >= 650 ? 2 : 1;
  return {
    focusIndex: 0,
    screen: {
      id: 'finished',
      rev: 0,
      title: passed ? '工程验收通过' : '任务失败',
      subtitle: clip(level.title, 120),
      widgets: [
        { t: 'kv', k: '得分', v: String(Math.max(0, Math.trunc(state.score))), tone: passed ? 'ok' : 'bad' },
        { t: 'kv', k: '星级', v: passed ? '★'.repeat(stars) : '未获得' },
        { t: 'kv', k: '提示', v: `${state.hints.length} 次 · 错误 ${state.errors} 次` },
        { t: 'alert', level: passed ? 'info' : 'warn', v: passed ? '完整结算与知识解析请在网页查看。' : clip(state.feedback.at(-1) ?? '重新进入关卡可再次尝试。', 150) },
      ],
      km: keys.length ? bind([{ lb: '刷新画面', nav: 'refresh' }], keys) : [],
      elapsed: Math.max(0, Math.floor(session.elapsedSeconds)),
      score: Math.max(0, Math.trunc(state.score)),
      online: true,
    },
  };
}

export function buildHud(input: HudBuildInput): HudBuildResult {
  const state = input.session.state;
  if (state.phase === 'completed' || state.phase === 'failed') return finishedScreen(input);
  if (state.phase === 'paused') return pausedScreen(input, input.focusIndex);
  if (state.phase === 'briefing') return briefingScreen(input, input.focusIndex);
  return consoleScreen(input, input.focusIndex);
}

/** 系统级画面：未绑定、无任务、设备离线。rev 由网关维护。 */
export function systemScreen(kind: 'boot' | 'pair' | 'idle' | 'offline', rev: number, options: { pairCode?: string; pairExpiresIn?: number; message?: string } = {}): HudScreen {
  const base = { rev, elapsed: 0, score: 0, online: kind !== 'offline' } as const;
  if (kind === 'pair') {
    return {
      ...base,
      id: 'pair',
      title: '绑定终端',
      subtitle: '在游戏网页输入下面的配对码',
      widgets: [
        { t: 'text', v: options.pairCode ?? '--------', size: 'l', align: 'c' },
        { t: 'kv', k: '有效期', v: `${Math.round((options.pairExpiresIn ?? 0) / 60)} 分钟` },
        { t: 'text', v: '网页 → 我的终端 → 添加终端。绑定后本机即为第二操控屏。', size: 's' },
      ],
      km: [],
    };
  }
  if (kind === 'idle') {
    return { ...base, id: 'idle', title: '终端就绪', subtitle: '等待选择任务', widgets: [{ t: 'text', v: options.message ?? '在网页中选择关卡或模式后，本屏会自动接管操作面板。', size: 's' }], km: [] };
  }
  if (kind === 'offline') {
    return { ...base, id: 'offline', title: '连接中断', subtitle: '正在重连服务器', widgets: [{ t: 'alert', level: 'warn', v: options.message ?? '请检查 Wi-Fi 与服务器地址，终端会自动重试。' }], km: [] };
  }
  return { ...base, id: 'boot', title: '万物之城', subtitle: 'HCP/1 终端', widgets: [{ t: 'text', v: options.message ?? '正在初始化网络与协议栈…', size: 's' }], km: [] };
}
