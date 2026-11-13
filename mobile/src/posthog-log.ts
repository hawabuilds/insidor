import { posthog } from './posthog.ts';

type LogAttributes = Record<string, string | number | boolean>;
type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, message: string, attributes: LogAttributes): void {
  try {
    posthog.logger[level](message, attributes);
  } catch {
    return;
  }
}

export const posthogLog = {
  info(message: string, attributes: LogAttributes): void {
    emit('info', message, attributes);
  },
  warn(message: string, attributes: LogAttributes): void {
    emit('warn', message, attributes);
  },
  error(message: string, attributes: LogAttributes): void {
    emit('error', message, attributes);
  },
};
