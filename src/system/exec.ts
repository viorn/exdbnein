export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Do not throw on a non-zero exit code. */
  allowFailure?: boolean;
}

export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly result: ExecResult,
  ) {
    super(`Command exited with code ${result.code}: ${command}\n${result.stderr.trim()}`);
    this.name = "ExecError";
  }
}

/** Runs a command and returns its output. Throws ExecError on failure unless allowFailure. */
export async function exec(command: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const result: ExecResult = { code, stdout, stderr };
  if (code !== 0 && !options.allowFailure) {
    throw new ExecError(command.join(" "), result);
  }
  return result;
}

/** Runs a command through the shell (for pipes and redirections). */
export async function shell(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  return exec(["sh", "-c", command], options);
}

/** Checks whether a utility is available in PATH. */
export async function hasCommand(name: string): Promise<boolean> {
  const result = await exec(["sh", "-c", `command -v ${name}`], { allowFailure: true });
  return result.code === 0;
}
