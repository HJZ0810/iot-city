import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bluetooth, Check, ChevronRight, Cpu, Gauge, Info, KeyRound, Link2, ListChecks, MonitorSmartphone, Plug, RefreshCw, RotateCcw, ShieldAlert, Star, Unplug, WifiOff, X, Zap } from 'lucide-react';
import type { BoardRunView, ChapterView, HudScreen, HudWidget, HwDeviceView, PublicBoardLevel, UserView } from '../../../../packages/shared/src/index';
import { apiClient, type BoardResultRow } from '../api';
import { EmptyState } from '../components/EmptyState';
import { errorText } from '../utils/errorText';
import '../styles/terminal.css';

const KIND_LABEL: Record<PublicBoardLevel['kind'], string> = { firmware: '功能验收', quiz: '屏上答题', debug: '代码排障' };
const STATUS_LABEL: Record<BoardRunView['status'], string> = { running: '进行中', passed: '已通过', failed: '未通过', abandoned: '已放弃' };

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '从未上线');

function Widget({ w }: { w: HudWidget }) {
  if (w.t === 'text') return <p className={`hv-text hv-${w.size ?? 'm'} hv-${w.align ?? 'l'}`}>{w.v}</p>;
  if (w.t === 'kv') return <div className="hv-kv"><span>{w.k}</span><b className={w.tone ? `hv-tone-${w.tone}` : ''}>{w.v}</b></div>;
  if (w.t === 'list') return <div className="hv-list">{w.label && <span className="hv-list-label">{w.label}</span>}{w.items.map((item, index) => <div className={`hv-item hv-${item.st ?? 'todo'}`} key={index}><i />{item.st === 'done' ? <Check size={11} /> : null}<span>{item.k}</span>{item.v && <em>{item.v}</em>}</div>)}</div>;
  if (w.t === 'gauge') return <div className="hv-gauge"><div className="hv-gauge-head"><span>{w.label}</span><b>{w.v}{w.unit ?? ''}</b></div><div className="hv-gauge-track"><span style={{ width: `${Math.max(0, Math.min(100, ((w.v - w.min) / Math.max(1e-6, w.max - w.min)) * 100))}%` }} /></div><small>{w.min} — {w.max}{w.unit ?? ''}</small></div>;
  if (w.t === 'bar') return <div className="hv-bar"><div className="hv-gauge-head"><span>{w.label}</span><b>{w.v}/{w.max}</b></div><div className="hv-bar-track"><span style={{ width: `${Math.max(0, Math.min(100, (w.v / Math.max(1, w.max)) * 100))}%` }} /></div></div>;
  if (w.t === 'spark') { const max = Math.max(...w.pts, 1); const min = Math.min(...w.pts, 0); const span = Math.max(1e-6, max - min); return <div className="hv-spark">{w.label && <span>{w.label}</span>}<div className="hv-spark-track">{w.pts.map((point, index) => <i key={index} style={{ height: `${8 + ((point - min) / span) * 92}%` }} />)}</div></div>; }
  return <div className={`hv-alert hv-alert-${w.level}`}><ShieldAlert size={12} />{w.v}</div>;
}

function BoardScreen({ screen }: { screen: HudScreen }) {
  return <div className="board-screen" aria-label="板载屏幕预览">
    <div className="board-screen-bezel">
      <div className="board-screen-bar"><span>{screen.id.toUpperCase()}</span><span>REV {screen.rev}</span></div>
      <h4>{screen.title}</h4>
      {screen.subtitle && <p className="board-screen-sub">{screen.subtitle}</p>}
      <div className="board-screen-body">{screen.widgets.map((widget, index) => <Widget w={widget} key={index} />)}</div>
      <div className="board-screen-foot"><span>SCORE {screen.score}</span><span>{Math.floor(screen.elapsed / 60)}:{String(screen.elapsed % 60).padStart(2, '0')}</span><span className={`board-dot ${screen.online ? 'on' : 'off'}`} /></div>
      <div className="board-keys">{screen.km.map((key) => <span className={key.tone === 'warn' ? 'warn' : ''} key={key.k}><b>{key.k}</b>{key.lb}</span>)}</div>
    </div>
  </div>;
}

export function TerminalView({ user, setNotice }: { user: UserView; setNotice: (message: string) => void }) {
  const [devices, setDevices] = useState<HwDeviceView[] | null>(null);
  const [chapters, setChapters] = useState<ChapterView[]>([]);
  const [levels, setLevels] = useState<PublicBoardLevel[]>([]);
  const [results, setResults] = useState<BoardResultRow[]>([]);
  const [run, setRun] = useState<BoardRunView | null>(null);
  const [detail, setDetail] = useState<PublicBoardLevel | null>(null);
  const [screen, setScreen] = useState<HudScreen | null>(null);
  const [screenDevice, setScreenDevice] = useState<string>('');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [chapter, setChapter] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [deviceList, chapterList, levelList, resultList, current] = await Promise.all([
        apiClient.hwDevices(), apiClient.boardChapters(), apiClient.boardLevels(), apiClient.boardResults(), apiClient.boardCurrent(),
      ]);
      setDevices(deviceList);
      setChapters(chapterList);
      setLevels(levelList);
      setResults(resultList);
      setRun(current);
      if (current) setDetail(await apiClient.boardLevel(current.levelId));
    } catch (error) {
      setDevices(null);
      setFailed(true);
      setNotice(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [setNotice]);

  useEffect(() => { void load(); }, [load]);

  const bestOf = useMemo(() => {
    const map = new Map<string, BoardResultRow>();
    for (const row of results) { const prev = map.get(row.levelId); if (!prev || row.score > prev.score) map.set(row.levelId, row); }
    return map;
  }, [results]);
  const chapterLevels = levels.filter((level) => level.chapter === chapter).sort((a, b) => a.number - b.number);
  const passedCount = results.length;

  const bind = async () => {
    if (code.trim().length < 6) { setNotice('配对码是 8 位字符，请对照板子屏幕输入。'); return; }
    setBusy(true);
    try {
      const device = await apiClient.hwBind(code.trim(), deviceName.trim() || undefined);
      setNotice(`已绑定终端「${device.name}」，现在可以在板子屏幕上选关卡了。`);
      setCode('');
      setDeviceName('');
      await load();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const revoke = async (device: HwDeviceView) => {
    setBusy(true);
    try {
      await apiClient.hwRevoke(device.id);
      setNotice(`已解绑「${device.name}」，该终端的令牌立即失效。`);
      if (screenDevice === device.id) { setScreen(null); setScreenDevice(''); }
      await load();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const peek = async (device: HwDeviceView) => {
    setBusy(true);
    setScreenDevice(device.id);
    try {
      const view = await apiClient.hwScreen(device.id);
      setScreen(view.screen);
      if (!device.online) setNotice('终端当前不在线，画面显示的是离线状态页。');
    } catch (error) { setScreen(null); setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const start = async (level: PublicBoardLevel) => {
    setBusy(true);
    try {
      const [next, levelDetail] = await Promise.all([apiClient.boardStart(level.id), apiClient.boardLevel(level.id)]);
      setRun(next);
      setDetail(levelDetail);
      setNotice(next.status === 'running' ? `第 ${level.number} 关已开始：板子屏幕上会出现「${next.currentProbe?.title ?? '考察题'}」。` : `这一关已经结束，成绩 ${next.score} 分。`);
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const answer = async (optionId: string) => {
    setBusy(true);
    try { const next = await apiClient.boardAnswer(optionId); setRun(next); if (next.status !== 'running') await load(); }
    catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const hint = async () => {
    setBusy(true);
    try { const next = await apiClient.boardHint(); setRun(next); if (next.status !== 'running') await load(); }
    catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  const abandon = async () => {
    setBusy(true);
    try { await apiClient.boardAbandon(); setRun(null); setNotice('已放弃本关，不进成绩榜。'); await load(); }
    catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  };

  return <div className="subpage terminal-page">
    <div className="page-heading">
      <div><span className="eyebrow">DEVICE CONSOLE</span><h1>我的终端</h1><p>把开发板接进城市：板子跑你的程序，屏幕出题、按键作答，读数与判定全部由服务器核对。</p></div>
      <div className="heading-stat"><Cpu size={22} /><span>{devices?.length ?? 0} 台终端 · {passedCount} 关通过</span></div>
    </div>

    <section className="terminal-steps" aria-label="接入流程">
      <article><span>01</span><div><b>板子烧写</b><p>用 HCP SDK 的示例工程编译烧写，串口输入 <code>enroll</code> 获取配对码。</p></div></article>
      <article><span>02</span><div><b>网页绑定</b><p>把屏幕上的 8 位配对码填到右侧，绑定后终端才获得操控权限。</p></div></article>
      <article><span>03</span><div><b>选关开打</b><p>网页开始一关，板子屏幕出现考察项；程序通过后证据自动上报判定。</p></div></article>
    </section>

    {run && run.status === 'running' && <section className="terminal-run" aria-label="当前考察项">
      <div className="terminal-run-head">
        <div>
          <span className="eyebrow"><Zap size={12} /> LIVE PROBE</span>
          <h2>第 {detail?.number ?? '—'} 关 · {run.title}</h2>
          <p>{detail?.subtitle ?? ''}</p>
        </div>
        <div className="terminal-run-meta">
          <span className={`terminal-badge kind-${run.kind}`}>{KIND_LABEL[run.kind]}</span>
          <span className="terminal-progress">{run.currentProbeIndex + 1} / {run.totalProbes}</span>
        </div>
      </div>
      <div className="terminal-run-body">
        <div className="terminal-probe">
          {run.currentProbe ? <>
            <span className="terminal-probe-tag">当前考察项</span>
            <h3>{run.currentProbe.title}</h3>
            <p>{run.currentProbe.description}</p>
            <small>采样窗口 {Math.round(run.currentProbe.windowMs / 1000)} 秒 · 板子在窗口内上报的证据才会被采信</small>
          </> : run.kind === 'quiz' && detail?.screenQuiz ? <>
            <span className="terminal-probe-tag">屏上答题</span>
            <h3>{detail.screenQuiz.prompt}</h3>
            <p>题目与动画显示在板子屏幕上，按板上的 K1–K4 选择，也可以在下面直接作答。</p>
            <div className="terminal-options">{detail.screenQuiz.options.map((option) => <button key={option.id} className="button button-outline button-small" disabled={busy} onClick={() => void answer(option.id)}><b>{option.id}</b>{option.label}</button>)}</div>
          </> : <p className="terminal-muted">服务器正在准备下一考察项…</p>}

          <div className="terminal-probe-actions">
            <button className="button button-outline button-small" onClick={() => void hint()} disabled={busy || run.hintsUsed >= (detail?.hints.length ?? 0)}><Info size={13} />显示提示（−40 分）</button>
            <button className="button button-quiet button-small" onClick={() => void abandon()} disabled={busy}><X size={13} />放弃本关</button>
          </div>
          {run.hintsUsed > 0 && <ul className="terminal-hints">{detail?.hints.slice(0, run.hintsUsed).map((text, index) => <li key={index}>{text}</li>)}</ul>}
        </div>
        <div className="terminal-evidence">
          <span className="terminal-probe-tag">判定记录</span>
          {run.results.length ? <ul>{run.results.map((result) => <li key={result.probeId} className={result.passed ? 'ok' : 'bad'}>{result.passed ? <Check size={13} /> : <X size={13} />}<div><b>{result.title}</b><small>{result.passed ? result.checks.map((check) => check.detail).join(' · ') : result.feedback}</small></div></li>)}</ul>
            : <p className="terminal-muted">还没有提交任何证据。烧写程序后，SDK 会自动采集引脚电平、PWM、ADC 等事实并上报。</p>}
        </div>
      </div>
    </section>}

    {run && run.status !== 'running' && <section className={`terminal-run finished ${run.status}`} aria-label="关卡结算">
      <div>
        <span className="eyebrow">{run.status === 'passed' ? 'PASSED' : 'FAILED'}</span>
        <h2>{run.title} · {STATUS_LABEL[run.status]}</h2>
        <p>得分 {run.score} · {run.stars ? `${'★'.repeat(run.stars)}${'☆'.repeat(3 - run.stars)}` : '未获得星级'} · 使用提示 {run.hintsUsed} 次</p>
      </div>
      <button className="button button-primary button-small" onClick={() => { setRun(null); setDetail(null); void load(); }}>回到关卡列表<ArrowRight size={14} /></button>
    </section>}

    <div className="terminal-grid">
      <section className="terminal-panel" aria-label="终端绑定">
        <div className="section-head">
          <div><span className="eyebrow"><Plug size={12} /> PAIRING</span><h2>终端绑定</h2></div>
          <button className="icon-link" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'terminal-spin' : ''} />刷新</button>
        </div>
        <div className="terminal-bind">
          <label><span>配对码</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如 A7K2-9QX4" maxLength={12} disabled={busy} /></label>
          <label><span>设备名（可选）</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="巡检板 A" maxLength={40} disabled={busy} /></label>
          <button className="button button-primary button-small" onClick={() => void bind()} disabled={busy || code.trim().length < 6}><Link2 size={14} />绑定这台终端</button>
        </div>
        <p className="terminal-hint-line"><KeyRound size={12} />配对码 10 分钟内有效；每个账号最多绑定 4 台终端。</p>

        {loading ? <div className="terminal-loading"><RefreshCw size={15} className="terminal-spin" />正在读取终端…</div>
          : failed || devices === null ? <EmptyState title="终端服务暂不可用" detail="连不上服务时不会用本地假数据代替，稍后再刷新。" />
            : devices.length ? <div className="terminal-devices">{devices.map((device) => <article className="terminal-device" key={device.id}>
              <div className={`terminal-device-icon ${device.online ? 'online' : ''}`}>{device.online ? <Bluetooth size={17} /> : <WifiOff size={17} />}</div>
              <div className="terminal-device-body">
                <b>{device.name}{device.online && <span className="terminal-live" />}</b>
                <small>{device.model} · 固件 {device.firmware} · 屏 {device.caps.w}×{device.caps.h}</small>
                <small>{device.caps.keys.length} 个按键{device.caps.board ? ` · 板型 ${device.caps.board}` : ''}{device.caps.features.length ? ` · ${device.caps.features.join(' / ')}` : ''}</small>
                <small>最近上线 {clock(device.lastSeenAt)}{device.attachedSessionId ? ' · 已挂载关卡会话' : ''}</small>
              </div>
              <div className="terminal-device-actions">
                <button className="button button-outline button-small" onClick={() => void peek(device)} disabled={busy}><MonitorSmartphone size={13} />看画面</button>
                <button className="button button-quiet button-small" onClick={() => void revoke(device)} disabled={busy}><Unplug size={13} />解绑</button>
              </div>
            </article>)}</div>
              : <EmptyState title="还没有绑定终端" detail="在开发板串口里输入 enroll，把屏幕上的配对码填到上面即可。" />}

        {screen && <BoardScreen screen={screen} />}
      </section>

      <section className="terminal-panel" aria-label="板子关卡">
        <div className="section-head">
          <div><span className="eyebrow"><ListChecks size={12} /> BOARD TRACK</span><h2>板子关卡</h2></div>
          <span className="terminal-count">{chapterLevels.length} 关</span>
        </div>
        <div className="terminal-chapters">{chapters.map((item) => <button key={item.id} className={`terminal-chapter ${chapter === item.id ? 'active' : ''}`} onClick={() => setChapter(item.id)} style={chapter === item.id && item.color ? { borderColor: item.color } : undefined}><b>{item.id}</b><span>{item.title}</span><small>{item.subtitle}</small></button>)}</div>
        <div className="terminal-levels">{chapterLevels.map((level) => {
          const best = bestOf.get(level.id);
          return <article className="terminal-level" key={level.id}>
            <div className="terminal-level-no">{String(level.number).padStart(2, '0')}</div>
            <div className="terminal-level-body">
              <b>{level.title}</b>
              <small>{level.subtitle}</small>
              <div className="terminal-level-tags">
                <span className={`terminal-badge kind-${level.kind}`}>{KIND_LABEL[level.kind]}</span>
                <span className="terminal-tag">难度 {'●'.repeat(level.difficulty)}{'○'.repeat(5 - level.difficulty)}</span>
                <span className="terminal-tag">约 {level.estimatedMinutes} 分钟</span>
                <span className="terminal-tag">{level.probeCount} 个考察项</span>
                {best && <span className="terminal-tag best"><Star size={11} />最佳 {best.score}</span>}
              </div>
            </div>
            <button className="button button-outline button-small" onClick={() => void start(level)} disabled={busy}>{run?.levelId === level.id && run.status === 'running' ? '进行中' : best ? '重玩' : '开始'}<ChevronRight size={13} /></button>
          </article>;
        })}</div>
      </section>
    </div>

    <section className="report-section terminal-detail" aria-label="关卡任务书">
      <div className="section-head"><div><span className="eyebrow"><Gauge size={12} /> BRIEF</span><h2>{detail ? `第 ${detail.number} 关 · ${detail.title}` : '关卡任务书'}</h2></div></div>
      {detail ? <div className="terminal-brief">
        <div>
          <h3>板子屏幕上显示的开场</h3>
          <p className="terminal-brief-text">{detail.brief}</p>
          <h3>要完成的事</h3>
          <ol>{detail.objective.map((item, index) => <li key={index}>{item}</li>)}</ol>
          <h3>涉及知识</h3>
          <div className="terminal-knowledge">{detail.knowledge.map((item) => <span key={item}>{item}</span>)}</div>
          {detail.pins?.length ? <><h3>引脚约定</h3><div className="terminal-pins">{detail.pins.map((pin) => <span key={pin.gpio}><b>GPIO {pin.gpio}</b>{pin.label}{pin.note ? ` · ${pin.note}` : ''}</span>)}</div></> : null}
        </div>
        <div>
          <h3>起始代码</h3>
          <pre className="terminal-code"><code>{detail.starterCode}</code></pre>
          {detail.screenQuiz?.animation && <p className="terminal-hint-line"><RotateCcw size={12} />屏幕动画：{detail.screenQuiz.animation}</p>}
          <p className="terminal-hint-line">参考解只保存在服务器，不会下发到浏览器；判定只认板子上报的证据。</p>
        </div>
      </div> : <EmptyState title="选择一关查看任务书" detail="点上方任意关卡开始，或点「进行中」回到当前考察项。" />}
    </section>

    <section className="report-section" aria-label="板端成绩">
      <div className="section-head"><div><span className="eyebrow">BOARD RESULTS</span><h2>板端成绩</h2></div><span className="terminal-count">{results.length} 条</span></div>
      {results.length ? <div className="terminal-results">{results.slice(0, 20).map((row, index) => {
        const level = levels.find((item) => item.id === row.levelId);
        return <article key={`${row.levelId}-${index}`}><span className="terminal-result-no">{level ? String(level.number).padStart(2, '0') : '—'}</span><div><b>{level?.title ?? row.levelId}</b><small>{clock(row.createdAt)}</small></div><span className="terminal-result-score">{row.score}</span><span className="terminal-result-stars">{'★'.repeat(row.stars)}{'☆'.repeat(Math.max(0, 3 - row.stars))}</span></article>;
      })}</div> : <EmptyState title="还没有板端成绩" detail="通过任意一关后，成绩会按关卡幂等入库，可随时回看。" />}
    </section>
  </div>;
}
