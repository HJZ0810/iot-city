import type { HudKey, HudScreen, HudWidget } from '../../../../packages/shared/src/hardware.ts';
import type { BoardLevel } from '../../../../packages/shared/src/board.ts';
import type { BoardRunState } from './runner.ts';
import { viewOf } from './runner.ts';

/**
 * 板端关卡的屏幕投影：把“题目 + 探针进度 + 结果”变成一块 320×240 屏能显示的画面。
 * 复用 HCP 的 HUD 语义控件，因此固件不需要为板端关卡单独写渲染代码。
 */

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`);

const keyIds = ['K1', 'K2', 'K3', 'K4'] as const;

export function boardScreen(level: BoardLevel, run: BoardRunState): HudScreen {
  const view = viewOf(level, run);
  const widgets: HudWidget[] = [];

  if (level.kind === 'quiz' && level.screenQuiz) {
    widgets.push({ t: 'text', v: clip(level.screenQuiz.prompt, 600), size: 'm' });
    widgets.push({ t: 'list', label: '选项', items: level.screenQuiz.options.map((option) => ({ k: `${option.id} ${clip(option.label, 40)}` })) });
    const keys: HudKey[] = level.screenQuiz.options.slice(0, keyIds.length).map((option, index) => ({ k: keyIds[index]!, lb: `选 ${option.id}`, cmd: 'answer', pl: { option: option.id }, tone: index === 0 ? 'primary' : undefined }));
    const answer = run.quizAnswer;
    if (answer) widgets.push({ t: 'alert', level: answer.correct ? 'info' : 'warn', v: clip(level.screenQuiz.explanation, 150) });
    return {
      id: 'console',
      rev: 0,
      title: clip(`${level.number}. ${level.title}`, 60),
      subtitle: run.status === 'running' ? '屏上答题 · 按 K1–K4 选择' : run.status === 'passed' ? '答对了' : '答错了',
      widgets: widgets.slice(0, 12),
      km: run.status === 'running' ? keys : [],
      elapsed: 0,
      score: view.score,
      online: true,
    };
  }

  widgets.push({ t: 'text', v: clip(level.brief, 700), size: 's' });
  widgets.push({
    t: 'list',
    label: `验收项 ${Math.min(run.currentProbeIndex + 1, Math.max(level.probes.length, 1))}/${level.probes.length}`,
    items: level.probes.map((probe, index) => {
      const done = run.results.find((result) => result.probeId === probe.id && result.passed);
      return { k: clip(probe.title, 40), st: done ? 'done' : index === run.currentProbeIndex && run.status === 'running' ? 'focus' : 'todo' } as const;
    }),
  });
  if (run.status === 'running') {
    const current = level.probes[run.currentProbeIndex];
    if (current) widgets.push({ t: 'alert', level: 'info', v: clip(`当前考察：${current.description}`, 150) });
  }
  const last = run.results.at(-1);
  if (last) widgets.push({ t: 'alert', level: last.passed ? 'info' : 'warn', v: clip(last.feedback, 150) });
  if (run.status === 'passed') widgets.push({ t: 'kv', k: '得分', v: String(view.score), tone: 'ok' });
  if (run.status === 'failed') widgets.push({ t: 'kv', k: '结果', v: '未通过', tone: 'bad' });

  const running = run.status === 'running';
  const actions: Array<Omit<HudKey, 'k'>> = [];
  if (running) {
    actions.push({ lb: '提示', cmd: 'hint', tg: 'board', tone: 'primary' });
    actions.push({ lb: '刷新', nav: 'refresh' });
  }

  return {
    id: 'console',
    rev: 0,
    title: clip(`${level.number}. ${level.title}`, 60),
    subtitle: `${level.kind === 'debug' ? '排障' : '验收'} · ${run.status === 'passed' ? '通过' : run.status === 'failed' ? '未通过' : `第 ${run.currentProbeIndex + 1} 项`}`,
    widgets: widgets.slice(0, 12),
    km: actions.map((action, index) => ({ k: keyIds[index]!, ...action })),
    elapsed: 0,
    score: view.score,
    online: true,
  };
}
