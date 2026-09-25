/**
 * Minimal structured logger. Writes one JSON line per event in production
 * (easy to ship to any log aggregator) and readable lines in development.
 * Swap for pino/winston later without changing call sites.
 */
import config from '../config/index.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logging.level] ?? LEVELS.info;

function write(level, message, meta = {}) {
  if (LEVELS[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;

  if (config.isProduction) {
    stream.write(JSON.stringify({ time: new Date().toISOString(), level, message, ...meta }) + '\n');
  } else {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    stream.write(`${new Date().toLocaleTimeString()} ${level.toUpperCase().padEnd(5)} ${message}${extra}\n`);
  }
}

const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};

export default logger;
