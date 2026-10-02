import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogLevel = "step" | "info" | "ok" | "warn" | "error";

export interface LogRecord {
  /** Record time in ISO 8601. */
  ts: string;
  level: LogLevel;
  message: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Installation log (P7.2): collects phase B steps and errors in memory and appends
 * them to file(s) on flush. Writing is best-effort: if the directory is unavailable
 * (disk not partitioned yet, LiveCD permissions), errors are ignored — the report
 * stays in memory.
 */
export class InstallLogger {
  private records: LogRecord[] = [];

  constructor(
    /** Log files; every record is appended to all of them. */
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

  /** Appends the accumulated records to all files and clears the buffer. */
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
    // best-effort: the log is already in memory, the directory may be unavailable
  }
}
