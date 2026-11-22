/**
 * 暗色 → 白蓝 / 白绿 主题转换器
 * ------------------------------------------------------------------
 * 旧样式是深色青绿系（#0b1117 底 + 薄荷绿高亮）。新主题是浅色纸白底：
 *   - 深色面（L<=0.34）→ 浅面（0.995..0.92），保留一点原色相
 *   - 亮色字（L>=0.72）→ 深墨字（0.10..0.18）
 *   - 中间调 → 次级文字（0.34..0.30）
 *   - 高饱和中间调（强调色/状态色）→ 压亮到 0.40 附近、提饱和
 *   - 白/黑叠加层按语义改写：白描边→深描边，黑色阴影→冷灰软阴影
 *
 * 只做颜色替换，不动布局与选择器，保证结构零回归；跑完再由人工核对截图修正。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
}
const toHex = (rgb) => '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** 色相往青绿/蓝带轻微吸附，避免浅底上出现脏黄脏紫 */
function settleHue(h, s, l) {
  if (s < 0.12) return h;
  const teal = 0.45, blue = 0.58;
  const near = (target) => Math.abs(((h - target + 1) % 1)) < 0.12 || Math.abs(((h - target + 1) % 1)) > 0.88;
  if (near(teal)) return teal;
  if (near(blue)) return blue;
  return h;
}

function mapHex(hex) {
  const rgb = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(rgb);
  const chromatic = s > 0.34;
  if (l <= 0.34) {
    const nl = 0.995 - (l / 0.34) * 0.075;
    const ns = chromatic ? Math.min(0.30, s * 0.5) : Math.min(0.10, s * 0.5);
    return toHex(hslToRgb([settleHue(h, ns, nl), ns, nl]));
  }
  if (chromatic && l >= 0.45 && l < 0.80) {
    // 强调色：压亮提饱和，保证浅底上的对比度
    const nl = clamp(l * 0.62, 0.36, 0.46);
    const ns = clamp(s * 1.18, 0.45, 0.88);
    return toHex(hslToRgb([settleHue(h, ns, nl), ns, nl]));
  }
  if (l >= 0.72) {
    const nl = 0.105 + (1 - l) * 0.30;
    return toHex(hslToRgb([settleHue(h, Math.min(0.42, s * 0.85), nl), Math.min(0.42, s * 0.85), nl]));
  }
  const nl = 0.335 + (l - 0.34) * 0.16;
  const ns = Math.min(0.26, s * 0.8);
  return toHex(hslToRgb([settleHue(h, ns, nl), ns, nl]));
}

function mapRgba([r, g, b, a]) {
  const [h, s, l] = rgbToHsl([r, g, b]);
  const alpha = Number(a);
  const nearWhite = r > 190 && g > 190 && b > 190;
  const nearBlack = r < 40 && g < 40 && b < 40;
  if (nearBlack) {
    // 阴影
    return `rgba(20,58,50,${(alpha * 0.55).toFixed(3)})`;
  }
  if (nearWhite) {
    // 深底上的白色描边/高光 → 浅底上的深描边
    return `rgba(16,54,46,${clamp(alpha * 1.6, 0.02, 0.20).toFixed(3)})`;
  }
  if (s > 0.28 && l > 0.42) {
    // 强调色叠加
    const nl = clamp(l * 0.62, 0.36, 0.46);
    const ns = clamp(s * 1.15, 0.45, 0.88);
    const [rr, gg, bb] = hslToRgb([settleHue(h, ns, nl), ns, nl]);
    return `rgba(${rr},${gg},${bb},${clamp(alpha * 0.95, 0.01, 1).toFixed(3)})`;
  }
  const mapped = mapHex(toHex([r, g, b]));
  const [rr, gg, bb] = hexToRgb(mapped);
  return `rgba(${rr},${gg},${bb},${alpha})`;
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*,\s*[0-9]{1,3}\s*(?:,\s*[0-9.]+\s*)?\)/g;

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node scripts/lightify.mjs <css 文件...>');
  process.exit(1);
}
let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(COLOR, (match) => {
    if (match.startsWith('#')) return mapHex(match);
    const parts = match.replace(/^rgba?\(|\)$/g, '').split(',').map((v) => Number(v.trim()));
    if (parts.length === 3) parts.push(1);
    return mapRgba(parts);
  });
  if (after !== before) {
    writeFileSync(file, after);
    changed += 1;
    console.log(`改写 ${file}`);
  }
}
console.log(`完成：${changed}/${files.length} 个文件`);
