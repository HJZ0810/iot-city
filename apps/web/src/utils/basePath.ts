// 部署基路径适配：应用现在以 /legacy/ 前缀部署在 iot.luo-jin-ai.com 下（主域名归 NEXUS CITY RTS）。
// vite base 通过 VITE_BASE 环境变量配置；本地开发默认 '/'，所有绝对路径请求都经此前缀。
const prefix = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
export const withBase = (path: string): string => (path.startsWith('/') ? prefix + path : path);
