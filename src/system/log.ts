import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "step" | "info" | "ok" | "warn" | "error";

export interface LogRecord {
  /** Время записи в ISO 8601. */
  ts: string;
  level: LogLevel;
  message: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Журнал установки (P7.2): собирает шаги и ошибки фазы B в памяти и дописывает их
 * в файл(ы) при flush. Запись — best-effort: если каталог недоступен (диск ещё не
 * размечен, права LiveCD), ошибки игнорируются — отчёт остаётся в памяти.
 */
export class InstallLogger {
  private records: LogRecord[] = [];

  constructor(
    /** Файлы журнала; каждая запись дописывается во все. */
    private files: string[] = [],
  ) {}

  step(stepId: string, title: string): void {
    this.push("step", `${stepId}: ${title}`);
  }

  info(message: string): void {
    this.push("info", message);
  }

  ok(message: string): void {
    this.push("ok", message);
  }

  warn(message: string): void {
    this.push("warn", message);
  }

  error(message: string): void {
    this.push("error", message);
  }

  get entries(): readonly LogRecord[] {
    return this.records;
  }

  private push(level: LogLevel, message: string): void {
    this.records.push({ ts: timestamp(), level, message });
  }

  /** Дописывает накопленные записи во все файлы и очищает буфер. */
  async flush(): Promise<void> {
    if (this.records.length === 0) return;
    const text = `${this.records.map((record) => `[${record.ts}] ${record.level}: ${record.message}`).join("\n")}\n`;
    await Promise.all(this.files.map((file) => appendLog(file, text)));
    this.records = [];
  }
}

async function appendLog(file: string, text: string): Promise<void> {
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, text, "utf8");
  } catch {
    // best-effort: лог уже есть в памяти, каталог может быть недоступен
  }
}
