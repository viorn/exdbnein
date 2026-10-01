import { spinner } from "@clack/prompts";
import { CancelledError } from "../ui/errors.ts";
import { ExecError, type ExecResult } from "./exec.ts";

export interface RunLongOptions {
  /** Заголовок спиннера во время выполнения. */
  label: string;
  /** Лимит времени в мс; по истечении вся группа процессов завершается принудительно. */
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  /** Не бросать исключение при ненулевом коде выхода. */
  allowFailure?: boolean;
}

/** Лимит по умолчанию для долгих операций (debootstrap/apt идут минутами). */
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Выполняет долгую команду в отдельной группе процессов (P5.4): спиннер,
 * таймаут и kill-группа при Ctrl+C — дочерние процессы не осиротевают.
 *
 * Команда запускается через `setsid`, чтобы стать лидером новой сессии/группы;
 * завершение идёт сигналом на отрицательный pid (вся группа целиком).
 */
export async function runLong(command: string[], options: RunLongOptions): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const progress = process.stdout.isTTY ? spinner() : null;
  progress?.start(options.label);

  let cancelled = false;
  let timedOut = false;
  let groupPid: number | null = null;

  const killGroup = (signal: NodeJS.Signals): void => {
    if (groupPid === null) return;
    try {
      process.kill(-groupPid, signal);
    } catch {
      // группа уже завершилась
    }
  };

  const onSigint = (): void => {
    cancelled = true;
    killGroup("SIGTERM");
    // Повторный Ctrl+C или «зависшая» очистка — жёсткое завершение.
    setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
  };

  const timer = setTimeout(() => {
    timedOut = true;
    killGroup("SIGKILL");
  }, timeoutMs);

  process.on("SIGINT", onSigint);

  try {
    const proc = Bun.spawn(["setsid", ...command], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdout: "pipe",
      stderr: "pipe",
    });
    groupPid = proc.pid;

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const result: ExecResult = { code, stdout, stderr };

    if (cancelled) {
      progress?.stop("Отменено");
      throw new CancelledError(`Операция отменена: ${options.label}`);
    }
    if (timedOut) {
      progress?.stop("Таймаут");
      throw new Error(
        `Операция превысила лимит времени (${Math.round(timeoutMs / 1000)} с) и остановлена: ${options.label}`,
      );
    }
    if (code !== 0 && !options.allowFailure) {
      progress?.stop("Ошибка");
      throw new ExecError(command.join(" "), result);
    }
    progress?.stop("Выполнено");
    return result;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    groupPid = null;
  }
}
