/**
 * PM2 启动配置（生产）
 * 读取项目根目录的 .env 并注入进程环境，避免把口令写死在命令行里。
 * 用法：pm2 start ecosystem.config.cjs && pm2 save
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const env = {};
try {
  for (const line of readFileSync(resolve(__dirname, '.env'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
} catch {
  // 没有 .env 时使用 PM2 进程环境
}

module.exports = {
  apps: [
    {
      name: 'iot-city',
      script: 'dist/server.mjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '700M',
      autorestart: true,
      exp_backoff_restart_delay: 2000,
      max_restarts: 20,
      kill_timeout: 8000,
      env: { ...env, NODE_ENV: 'production' },
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
