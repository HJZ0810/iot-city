import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react';
import { withBase } from '../utils/basePath';
import type { GameState, GameCommand, PublicLevel } from '../../../../packages/shared/src/index';

const WorldScene = lazy(() => import('../WorldScene'));

type ReplayEvent = {
  id: string;
  sequence: number;
  command: GameCommand;
  accepted: boolean;
  message: string;
  createdAt: string;
  state?: GameState;
};
type ReplayResponse = { initial: GameState; final?: GameState; events: ReplayEvent[]; level?: PublicLevel };
type ReplayFrame = { state: GameState; event?: ReplayEvent; kind: 'initial' | 'event' | 'final' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGameState(value: unknown): value is GameState {
  return isRecord(value) && typeof value.levelId === 'string' && isRecord(value.devices) && Array.isArray(value.links);
}

function parseReplay(value: unknown): ReplayResponse {
  if (!isRecord(value) || !isGameState(value.initial) || !Array.isArray(value.events)) {
    throw new Error('回放数据格式不完整，无法读取起始场景和操作记录。');
  }
  if (!value.level || !isRecord(value.level) || !Array.isArray(value.level.devices)) {
    throw new Error('此回放缺少关卡快照，无法重建场景。请使用包含关卡信息的回放记录。');
  }
  return {
    initial: value.initial,
    final: isGameState(value.final) ? value.final : undefined,
    level: value.level as PublicLevel,
    events: value.events.filter((event): event is ReplayEvent => isRecord(event)
      && typeof event.id === 'string'
      && typeof event.sequence === 'number'
      && isRecord(event.command)
      && typeof event.accepted === 'boolean'
      && typeof event.message === 'string'
      && typeof event.createdAt === 'string'),
  };
}

function commandLabel(command: GameCommand | undefined) {
  if (!command) return '起始快照';
  const labels: Partial<Record<GameCommand['type'], string>> = {
    start: '开始任务', pause: '暂停', resume: '恢复', inspect: '检查设备', dialog: '对话', collect: '收集', use: '使用物资',
    install: '安装设备', remove: '拆卸设备', connect: '建立连接', disconnect: '断开连接', configure: '配置参数', move: '移动',
    rule: '添加规则', 'remove-rule': '移除规则', simulate: '运行仿真', hint: '查看提示', answer: '提交答案',
  };
  return labels[command.type] ?? command.type;
}

export function ReplayPlayer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedDevice, setSelectedDevice] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setReplay(null);
    setFrameIndex(0);
    setPlaying(false);
    setLoading(true);
    setError('');
    fetch(withBase(`/api/sessions/${encodeURIComponent(sessionId)}/events`), { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string'
            ? body.error.message
            : `读取回放失败 (${response.status})`;
          throw new Error(message);
        }
        const data = isRecord(body) && 'data' in body ? body.data : body;
        setReplay(parseReplay(data));
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取回放失败，请稍后重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId]);

  const frames = useMemo<ReplayFrame[]>(() => {
    if (!replay) return [];
    let current = replay.initial;
    const result: ReplayFrame[] = [{ state: current, kind: 'initial' }, ...replay.events.map(event => {
      if (isGameState(event.state)) current = event.state;
      return { state: current, event, kind: 'event' as const };
    })];
    if (replay.final && JSON.stringify(replay.final) !== JSON.stringify(current)) result.push({ state: replay.final, kind: 'final' });
    return result;
  }, [replay]);
  const frame = frames[frameIndex];
  const currentState = frame?.state;
  const currentEvent = frame?.event;
  const isFinalFrame = frame?.kind === 'final';
  const lastIndex = Math.max(0, frames.length - 1);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex(index => Math.min(frames.length - 1, index + 1));
    }, 900 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, frames.length]);

  useEffect(() => {
    if (playing && frameIndex >= lastIndex) setPlaying(false);
  }, [playing, frameIndex, lastIndex]);

  const goTo = (index: number) => {
    setFrameIndex(Math.min(lastIndex, Math.max(0, index)));
    setPlaying(false);
  };

  const deviceLabel = (id: string) => replay?.level?.devices.find(device => device.id === id)?.label ?? id;

  return <div className="replay-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="replay-player" role="dialog" aria-modal="true" aria-labelledby="replay-title">
      <header className="replay-header">
        <div><span className="eyebrow">READ ONLY / SESSION REPLAY</span><h2 id="replay-title">工程过程回放</h2></div>
        <button className="icon-btn replay-close" onClick={onClose} aria-label="关闭回放"><X size={18}/></button>
      </header>
      {loading ? <div className="replay-state"><span className="spin"><RotateCw/></span><b>正在读取服务端快照与操作事件…</b></div>
        : error ? <div className="replay-state replay-error"><CircleAlert size={24}/><b>无法播放此回放</b><p>{error}</p><button className="button button-outline" onClick={onClose}>返回</button></div>
        : replay && currentState ? <>
          <div className="replay-main">
            <div className="replay-scene">
              <Suspense fallback={<div className="replay-scene-loading">正在载入场景…</div>}>
                <WorldScene level={replay.level!} state={currentState.devices} links={currentState.links} onSelect={setSelectedDevice} selected={selectedDevice} lowFx />
              </Suspense>
            </div>
            <aside className="replay-inspector">
              <div className="replay-inspector-heading"><span className="eyebrow">SNAPSHOT</span><b>{replay.level?.title}</b></div>
              <div className="replay-stats"><span><small>场景时间</small><b>{currentState.tick} 秒</b></span><span><small>服务端积分</small><b>{currentState.score} pts</b></span><span><small>设备</small><b>{Object.keys(currentState.devices).length}</b></span></div>
              <section className="replay-links"><div className="replay-section-title"><b>设备链路</b><span>{currentState.links.length}</span></div>
                {currentState.links.length ? currentState.links.map((link,index)=><div className="replay-link" key={`${link.from}-${link.to}-${index}`}><span className="replay-link-node">{deviceLabel(link.from)}</span><i aria-hidden="true"/><span className="replay-link-node">{deviceLabel(link.to)}</span><small>{link.kind} · {Math.round(link.quality*100)}%</small></div>) : <p className="replay-muted">当前帧没有已建立的设备链路。</p>}
              </section>
              <section className="replay-event-detail"><div className="replay-section-title"><b>{isFinalFrame?'最终状态':currentEvent ? `事件 ${String(currentEvent.sequence).padStart(3,'0')}` : '初始状态'}</b>{currentEvent&&<span className={currentEvent.accepted?'replay-accepted':'replay-rejected'}>{currentEvent.accepted?<Check size={12}/>:<X size={12}/>} {currentEvent.accepted?'已接受':'未接受'}</span>}</div>
                <strong>{isFinalFrame?'服务端最终快照':commandLabel(currentEvent?.command)}</strong>
                <p>{isFinalFrame?'此帧来自服务端最终会话状态，可能包含结算或超时后的更新。':currentEvent?.message ?? '这是服务端提供的任务起始快照。'}</p>
                {currentEvent&&<time>{new Date(currentEvent.createdAt).toLocaleString('zh-CN',{hour12:false})}</time>}
                {currentEvent&&!isGameState(currentEvent.state)&&<small className="replay-muted">此事件未保存独立场景快照，画面沿用最近一次服务端状态。</small>}
              </section>
            </aside>
          </div>
          <footer className="replay-controls">
            <div className="replay-control-row">
              <button className="button button-outline replay-icon-button" onClick={()=>goTo(0)} disabled={frameIndex===0} aria-label="回到起始状态" title="回到起始状态"><RotateCcw size={15}/><span>起点</span></button>
              <button className="icon-btn" onClick={()=>goTo(frameIndex-1)} disabled={frameIndex===0} aria-label="上一帧" title="上一帧"><ArrowLeft size={17}/></button>
              <button className="button button-primary replay-play" onClick={()=>{if(frameIndex>=lastIndex)goTo(0);setPlaying(value=>!value)}} disabled={frames.length<2}>{playing?<><Pause size={15}/>暂停</>:<><Play size={15}/>播放</>}</button>
              <button className="icon-btn" onClick={()=>goTo(frameIndex+1)} disabled={frameIndex>=lastIndex} aria-label="下一帧" title="下一帧"><ArrowRight size={17}/></button>
              <button className="button button-outline replay-icon-button" onClick={()=>goTo(lastIndex)} disabled={frameIndex>=lastIndex} aria-label="跳到最终状态" title="跳到最终状态"><span>终点</span><RotateCw size={15}/></button>
              <label className="replay-speed">速度<select value={speed} onChange={event=>setSpeed(Number(event.target.value))}>{[0.5,1,2,4].map(value=><option value={value} key={value}>{value}×</option>)}</select></label>
            </div>
            <div className="replay-timeline"><span>{frame?.kind==='initial'?'起始状态':isFinalFrame?'最终状态':`事件 ${currentEvent?.sequence??frameIndex}`}</span><input type="range" min={0} max={lastIndex} value={frameIndex} onChange={event=>goTo(Number(event.target.value))} aria-label="回放进度"/><span>{frames.length} 帧</span></div>
          </footer>
        </> : <div className="replay-state replay-error"><CircleAlert size={24}/><b>没有可播放的事件</b><p>服务端未返回有效的起始场景快照。</p><button className="button button-outline" onClick={onClose}>返回</button></div>}
    </section>
  </div>;
}
