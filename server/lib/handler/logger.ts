export interface LogFields {
  tenantId?: string;
  operation?: string;
  blobCount?: number;
  durationMs?: number;
  requestId?: string;
  [key: string]: unknown;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private log(level: LogLevel, message: string, fields?: LogFields): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields,
    };
    console.log(JSON.stringify(entry));
  }

  info(message: string, fields?: LogFields): void {
    this.log('INFO', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.log('WARN', message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.log('ERROR', message, fields);
  }
}

export const logger = new Logger();
