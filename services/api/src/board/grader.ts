import type { BoardAssertion, BoardCheckResult, BoardCrossSource, BoardFacts, BoardProbe, BoardProbeResult } from '../../../../packages/shared/src/index.ts';

/**
 * 板端判题器：纯函数，不做 I/O。
 * 输入“探针”（服务器想要什么）+ “证据”（设备实际做了什么），输出逐条判定。
 * 所有判定都基于可观测事实，学生上报的数值必须与 SDK 交叉源一致才计分。
 */

const num = (value: number) => Math.round(value * 100) / 100;
const pinOf = (facts: BoardFacts, pin: number) => facts.pins.find((p) => p.pin === pin);
const pwmOf = (facts: BoardFacts, pin: number) => facts.pwm.find((p) => p.pin === pin);
const adcOf = (facts: BoardFacts, pin: number) => facts.adc.find((p) => p.pin === pin);
const withinPct = (actual: number, expected: number, pct: number) => Math.abs(actual - expected) <= Math.abs(expected) * (pct / 100) + 0.0001;

/** 交叉源：把“学生上报值”与“SDK 从硬件解码出的值”对齐，防止直接打印答案 */
function crossValue(facts: BoardFacts, source: BoardCrossSource): number | null {
  switch (source) {
    case 'dht.temperature':
      return facts.dht?.ok && typeof facts.dht.temperature === 'number' ? facts.dht.temperature : null;
    case 'dht.humidity':
      return facts.dht?.ok && typeof facts.dht.humidity === 'number' ? facts.dht.humidity : null;
    case 'adc.mv': {
      const sample = facts.adc[0];
      return typeof sample?.mv === 'number' ? sample.mv : null;
    }
    case 'wifi.rssi':
      return typeof facts.wifi?.rssi === 'number' ? facts.wifi.rssi : null;
    default: {
      if (!source.startsWith('keys.')) return null;
      const key = source.slice(5) as BoardFacts['keys'][number]['key'];
      return facts.keys.find((k) => k.key === key)?.presses ?? null;
    }
  }
}

function check(assertion: BoardAssertion, facts: BoardFacts): BoardCheckResult {
  const type = assertion.type;
  const note = assertion.note ? `（${assertion.note}）` : '';
  switch (assertion.type) {
    case 'pin-level': {
      const sample = pinOf(facts, assertion.pin);
      if (!sample) return { type, passed: false, detail: `GPIO${assertion.pin} 没有采样记录：学生代码从未配置这个引脚。${note}` };
      const passed = sample.level === assertion.value;
      return { type, passed, detail: `GPIO${assertion.pin} 期望电平 ${assertion.value}，实测 ${sample.level}${passed ? '' : '。'}${note}` };
    }
    case 'pin-edges': {
      const sample = pinOf(facts, assertion.pin);
      if (!sample) return { type, passed: false, detail: `GPIO${assertion.pin} 没有采样记录。${note}` };
      const enough = sample.edges >= assertion.min;
      const notTooMany = assertion.max === undefined || sample.edges <= assertion.max;
      const passed = enough && notTooMany;
      const expectation = assertion.max === undefined ? `≥${assertion.min}` : `${assertion.min}–${assertion.max}`;
      return { type, passed, detail: `GPIO${assertion.pin} 期望边沿 ${expectation} 次，实测 ${sample.edges} 次${passed ? '' : '。'}${note}` };
    }
    case 'pwm': {
      const sample = pwmOf(facts, assertion.pin);
      if (!sample) return { type, passed: false, detail: `GPIO${assertion.pin} 没有 PWM 采样：可能仍用 digitalWrite，或未启用 LEDC。${note}` };
      const hzOk = withinPct(sample.hz, assertion.hz, assertion.hzTolerancePct);
      const dutyOk = assertion.duty === undefined || withinPct(sample.duty, assertion.duty, assertion.dutyTolerancePct);
      const parts = [`期望 ${num(assertion.hz)}Hz${assertion.duty === undefined ? '' : ` / ${num(assertion.duty)}%`}，实测 ${num(sample.hz)}Hz / ${num(sample.duty)}%`];
      if (!hzOk) parts.push('频率不符');
      if (!dutyOk) parts.push('占空比不符');
      return { type, passed: hzOk && dutyOk, detail: `GPIO${assertion.pin} ${parts.join('；')}。${note}` };
    }
    case 'adc': {
      const sample = adcOf(facts, assertion.pin);
      if (!sample) return { type, passed: false, detail: `GPIO${assertion.pin} 没有 ADC 采样：确认引脚支持 ADC1 且已调用 analogRead。${note}` };
      const passed = sample.mv >= assertion.min && sample.mv <= assertion.max;
      return { type, passed, detail: `GPIO${assertion.pin} 期望 ${num(assertion.min)}–${num(assertion.max)}mV，实测 ${num(sample.mv)}mV${passed ? '' : '。'}${note}` };
    }
    case 'key': {
      const sample = facts.keys.find((k) => k.key === assertion.key);
      const presses = sample?.presses ?? 0;
      const passed = presses >= assertion.presses;
      return { type, passed, detail: `按键 ${assertion.key} 期望至少 ${assertion.presses} 次有效按下，实测 ${presses} 次${passed ? '' : '。请确认已启用内部上拉与消抖。'}${note}` };
    }
    case 'dht': {
      if (!facts.dht?.ok) return { type, passed: false, detail: 'DHT11 总线上没有解析到合法响应：数据线未接、未上拉、或时序不正确。' + note };
      const value = assertion.field === 'temperature' ? facts.dht.temperature : facts.dht.humidity;
      if (typeof value !== 'number') return { type, passed: false, detail: `DHT11 未解出 ${assertion.field}。${note}` };
      const passed = value >= assertion.min && value <= assertion.max;
      const label = assertion.field === 'temperature' ? '温度' : '湿度';
      return { type, passed, detail: `${label}期望 ${num(assertion.min)}–${num(assertion.max)}，实测 ${num(value)}${passed ? '' : '。'}${note}` };
    }
    case 'strip': {
      if (!facts.strip) return { type, passed: false, detail: '没有 WS2812 发送记录：确认使用 RMT/NeoPixel 驱动并刷新过灯带。' + note };
      if (facts.strip.count !== assertion.count) return { type, passed: false, detail: `灯带像素数期望 ${assertion.count}，实测 ${facts.strip.count}。${note}` };
      const diff = [Math.abs(facts.strip.first.r - assertion.first.r), Math.abs(facts.strip.first.g - assertion.first.g), Math.abs(facts.strip.first.b - assertion.first.b)];
      const passed = diff.every((d) => d <= assertion.tolerance);
      return { type, passed, detail: `首像素期望 rgb(${assertion.first.r},${assertion.first.g},${assertion.first.b})，实测 rgb(${facts.strip.first.r},${facts.strip.first.g},${facts.strip.first.b})${passed ? '' : '。'}${note}` };
    }
    case 'wifi': {
      if (!facts.wifi) return { type, passed: false, detail: '没有 Wi-Fi 状态采样：确认已调用 WiFi.mode/begin。' + note };
      const problems: string[] = [];
      if (assertion.mode && facts.wifi.mode !== assertion.mode) problems.push(`模式期望 ${assertion.mode}，实测 ${facts.wifi.mode}`);
      if (assertion.rssiMin !== undefined && (facts.wifi.rssi ?? -120) < assertion.rssiMin) problems.push(`RSSI 期望 ≥${assertion.rssiMin}，实测 ${facts.wifi.rssi ?? '无'}`);
      if (assertion.ipPrefix && !(facts.wifi.ip ?? '').startsWith(assertion.ipPrefix)) problems.push(`IP 期望以 ${assertion.ipPrefix} 开头，实测 ${facts.wifi.ip ?? '无'}`);
      return { type, passed: problems.length === 0, detail: problems.length ? `${problems.join('；')}。${note}` : `Wi-Fi 模式 ${facts.wifi.mode}，RSSI ${facts.wifi.rssi ?? '—'}，IP ${facts.wifi.ip ?? '—'}。${note}` };
    }
    case 'report': {
      const reports = facts.reports.filter((r) => r.k === assertion.key).sort((a, b) => a.ts - b.ts);
      if (!reports.length) return { type, passed: false, detail: `没有收到键为 ${assertion.key} 的上报：学生代码需要在读到数据后调用 HCP.report("${assertion.key}", 值)。${note}` };
      const latest = reports.at(-1)!;
      const problems: string[] = [];
      if (assertion.min !== undefined && latest.v < assertion.min) problems.push(`上报值 ${num(latest.v)} < 下限 ${num(assertion.min)}`);
      if (assertion.max !== undefined && latest.v > assertion.max) problems.push(`上报值 ${num(latest.v)} > 上限 ${num(assertion.max)}`);
      if (assertion.cross) {
        const expected = crossValue(facts, assertion.cross.source);
        if (expected === null) problems.push(`无法交叉校验（${assertion.cross.source} 无采样），说明对应外设并未真正工作`);
        else if (Math.abs(latest.v - expected) > assertion.cross.tolerance) problems.push(`上报值 ${num(latest.v)} 与硬件实测 ${num(expected)} 相差超过 ${num(assertion.cross.tolerance)}，判定为凭空填数`);
      }
      return { type, passed: problems.length === 0, detail: problems.length ? `${problems.join('；')}。${note}` : `上报 ${assertion.key}=${num(latest.v)}，与硬件实测一致。${note}` };
    }
    case 'uptime': {
      const passed = facts.uptimeMs >= assertion.minMs;
      return { type, passed, detail: `运行时长期望 ≥${assertion.minMs}ms，实测 ${facts.uptimeMs}ms${passed ? '' : '。频繁复位会被判为不合格。'}${note}` };
    }
  }
}

export function gradeProbe(probe: BoardProbe, facts: BoardFacts): BoardProbeResult {
  const checks = probe.expect.map((assertion) => check(assertion, facts));
  const firstFailure = checks.find((c) => !c.passed);
  return {
    probeId: probe.id,
    title: probe.title,
    passed: checks.every((c) => c.passed),
    weight: probe.weight,
    checks,
    feedback: firstFailure ? `${firstFailure.detail}提示：${probe.hint}` : `${probe.title} 通过。`,
  };
}

/** 关卡得分：满分 1000，按探针权重加权，提示与失败次数扣分。 */
export function scoreProbes(results: BoardProbeResult[], hintsUsed: number, failedAttempts: number): number {
  const total = results.reduce((sum, r) => sum + r.weight, 0);
  if (total <= 0) return 0;
  const gained = results.reduce((sum, r) => sum + (r.passed ? r.weight : 0), 0);
  const base = (gained / total) * 1000;
  return Math.max(0, Math.round(base - hintsUsed * 40 - failedAttempts * 15));
}

export function starsFor(score: number): number {
  return score >= 900 ? 3 : score >= 650 ? 2 : 1;
}
