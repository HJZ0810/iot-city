import { useMemo, useState } from 'react';
import { AlertTriangle, Boxes, Check, Cpu, Search, ShieldCheck, Wrench, X } from 'lucide-react';
import type { DeviceDefinition, GameCommand, SessionView } from '../../../../packages/shared/src/index';
import '../styles/sandbox.css';

type FaultKind = 'hardware' | 'offline' | 'noise' | 'uncalibrated' | 'interference';
type SandboxCommandType = GameCommand['type'] | 'fault';

const faultOptions: Array<{ id: FaultKind; label: string; detail: string }> = [
  { id: 'hardware', label: '硬件损坏', detail: '模拟器件或执行部件损坏' },
  { id: 'offline', label: '离线中断', detail: '模拟设备失联或供电中断' },
  { id: 'noise', label: '采样噪声', detail: '模拟测量读数受到噪声干扰' },
  { id: 'uncalibrated', label: '未校准', detail: '模拟传感器偏移未校正' },
  { id: 'interference', label: '无线干扰', detail: '模拟无线链路受到干扰' },
];

const categories: Array<{ id: string; label: string; kinds?: DeviceDefinition['kind'][] }> = [
  { id: 'all', label: '全部设备' },
  { id: 'sensing', label: '感知识别', kinds: ['sensor', 'rfid'] },
  { id: 'control', label: '控制执行', kinds: ['controller', 'actuator'] },
  { id: 'network', label: '通信网络', kinds: ['radio', 'gateway', 'router', 'cloud'] },
  { id: 'terminal', label: '终端供电', kinds: ['terminal', 'power'] },
];

const kindName: Record<DeviceDefinition['kind'], string> = {
  sensor: '传感器', actuator: '执行器', controller: '控制器', gateway: '网关', radio: '无线电台',
  cloud: '云平台', power: '电源', rfid: 'RFID', router: '路由器', terminal: '终端',
};
const faultName = (id: string) => faultOptions.find(option => option.id === id)?.label ?? id;

export function SandboxTools({ session, selected, busy, send }: {
  session: SessionView;
  selected: string;
  busy: boolean;
  send: (type: SandboxCommandType, target?: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [fault, setFault] = useState<FaultKind>('hardware');
  const freeSandbox = session.mode === 'sandbox' && session.state.flags.includes('sandbox-free');
  const categoryKinds = categories.find(item => item.id === category)?.kinds;
  const devices = useMemo(() => session.level.devices.filter(device => {
    const matchesCategory = !categoryKinds || categoryKinds.includes(device.kind);
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || [device.label, device.model, device.kind, device.description].some(value => value.toLocaleLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  }), [categoryKinds, search, session.level.devices]);
  const installedCount = Object.values(session.state.devices).filter(device => device.installed).length;
  const selectedDefinition = session.level.devices.find(device => device.id === selected);
  const selectedState = selected ? session.state.devices[selected] : undefined;
  const activeFaults = selectedState?.faults ?? selectedDefinition?.faults ?? [];
  const selectedInstalled = selectedState?.installed ?? selectedDefinition?.installed ?? false;

  if (!freeSandbox) {
    return <section className="sandbox-tools sandbox-tools-locked">
      <div className="sandbox-tools-title"><ShieldCheck size={15} /><div><b>自由工程工具</b><small>故障注入仅对自由沙盒开放</small></div></div>
      <p>标准挑战使用独立的规则与计分流程，此处不会修改设备状态。</p>
    </section>;
  }

  return <section className="sandbox-tools" aria-label="自由沙盒工具">
    <header className="sandbox-tools-title">
      <span className="sandbox-tools-mark"><Wrench size={15} /></span>
      <div><b>自由工程工具</b><small>安装设备，注入故障，验证你的方案</small></div>
      <span className="sandbox-tools-count">{installedCount}<small> / {session.level.devices.length}</small></span>
    </header>

    <section className="sandbox-library">
      <div className="sandbox-tools-section-head"><div><Boxes size={14} /><b>设备库</b></div><span>{devices.length} 种</span></div>
      <label className="sandbox-device-search"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称、型号或说明" aria-label="搜索设备库" /><button type="button" onClick={() => setSearch('')} disabled={!search} aria-label="清除搜索"><X size={13} /></button></label>
      <div className="sandbox-device-categories" role="tablist" aria-label="设备分类">
        {categories.map(item => <button type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </div>
      {devices.length ? <div className="sandbox-device-list">
        {devices.map(device => {
          const live = session.state.devices[device.id];
          const installed = live?.installed ?? device.installed;
          const faults = live?.faults ?? device.faults;
          const stateLabel = faults.length ? '有故障' : installed ? (live?.enabled === false ? '已停用' : '已安装') : '待安装';
          const parameters = Object.entries(live?.parameters ?? {}).slice(0, 2).map(([key, value]) => key + ' ' + String(value));
          return <article className={'sandbox-device-card ' + (selected === device.id ? 'selected' : '')} key={device.id}>
            <div className="sandbox-device-summary" aria-label={device.label + '，' + stateLabel}>
              <span className={'sandbox-device-glyph kind-' + device.kind}><Cpu size={16} /></span>
              <span className="sandbox-device-copy"><b>{device.label}</b><small>{kindName[device.kind]} · {device.model}</small><small className="sandbox-device-state">{stateLabel}{live && Number.isFinite(live.reading) ? ' · 读数 ' + live.reading : ''}</small>{parameters.length > 0 && <small className="sandbox-device-parameters">{parameters.join(' · ')}</small>}</span>
            </div>
            <div className="sandbox-device-actions">
              {installed
                ? <button type="button" className="sandbox-device-action installed" disabled={busy} onClick={() => void send('remove', device.id)}><Check size={12} />已安装 · 拆卸</button>
                : <button type="button" className="sandbox-device-action" disabled={busy} onClick={() => void send('install', device.id)}><Boxes size={12} />安装设备</button>}
              {faults.length > 0 && <span className="sandbox-device-fault"><AlertTriangle size={11} />{faultName(faults[0]!)}</span>}
            </div>
          </article>;
        })}
      </div> : <div className="sandbox-library-empty">没有符合筛选条件的设备。</div>}
    </section>

    <section className="sandbox-fault-panel">
      <div className="sandbox-tools-section-head"><div><AlertTriangle size={14} /><b>故障注入</b></div><span>服务端模拟</span></div>
      {selectedDefinition ? <>
        <div className="sandbox-fault-target"><span className="sandbox-fault-target-led" /><div><small>当前选中设备</small><b>{selectedDefinition.label}</b></div><span>{selectedInstalled ? '已安装' : '未安装'}</span></div>
        <label className="sandbox-fault-select">选择故障
          <select value={fault} onChange={event => setFault(event.target.value as FaultKind)} disabled={busy}>
            {faultOptions.map(option => <option value={option.id} key={option.id}>{option.label} · {option.detail}</option>)}
          </select>
        </label>
        <div className="sandbox-fault-actions">
          <button type="button" className="button button-small button-outline sandbox-fault-apply" disabled={busy || !selectedInstalled || activeFaults.includes(fault)} onClick={() => void send('fault', selected, { fault, active: true })}><AlertTriangle size={13} />注入故障</button>
          <button type="button" className="button button-small button-outline sandbox-fault-clear" disabled={busy || !activeFaults.includes(fault)} onClick={() => void send('fault', selected, { fault, active: false })}><X size={13} />清除该故障</button>
        </div>
        {activeFaults.length ? <div className="sandbox-active-faults"><b>当前故障</b><div>{activeFaults.map(value => <span key={value}>{faultName(value)}</span>)}</div></div> : <p className="sandbox-no-fault">该设备当前没有注入故障。</p>}
      </> : <div className="sandbox-fault-empty"><AlertTriangle size={16} /><p>先从现场设备面板选择一个设备，再在这里注入或清除故障。</p></div>}
    </section>
  </section>;
}
