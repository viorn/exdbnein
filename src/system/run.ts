import { spinner } from "@clack/prompts";
import { CancelledError } from "../ui/errors.ts";
import { ExecError, type ExecResult } from "./exec.ts";

export interface RunLongOptions {
  /** Spinner title while running. */
  label: string;
  /** Time limit in ms; after it expires the whole process group is killed. */
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  /** Do not throw on a non-zero exit code. */
  allowFailure?: boolean;
}

/** Default limit for long operations (debootstrap/apt run for minutes). */
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Runs a long command in a separate process group (P5.4): spinner,
 * timeout and kill-group on Ctrl+C — child processes are not orphaned.
 *
 * The command is started via `setsid` to become the leader of a new session/group;
 * termination sends a signal to the negative pid (the whole group).
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
      // the group has already exited
    }
  };

  const onSigint = (): void => {
    cancelled = true;
    killGroup("SIGTERM");
    // A second Ctrl+C or a "stuck" cleanup — hard kill.
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
      progress?.stop("Cancelled");
      throw new CancelledError(`Operation cancelled: ${options.label}`);
    }
    if (timedOut) {
      progress?.stop("Timeout");
      throw new Error(
        `Operation exceeded the time limit (${Math.round(timeoutMs / 1000)} s) and was stopped: ${options.label}`,
      );
    }
    if (code !== 0 && !options.allowFailure) {
      progress?.stop("Error");
      throw new ExecError(command.join(" "), result);
    }
    progress?.stop("Done");
    return result;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    groupPid = null;
  }
}
