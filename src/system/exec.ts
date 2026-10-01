export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Не бросать исключение при ненулевом коде выхода. */
  allowFailure?: boolean;
}

export class ExecError extends Error {
  constructor(
    readonly command: string,
    readonly result: ExecResult,
  ) {
    super(`Команда завершилась с кодом ${result.code}: ${command}\n${result.stderr.trim()}`);
    this.name = "ExecError";
  }
}

/** Запускает команду и возвращает её вывод. Бросает ExecError при ошибке, если не allowFailure. */
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

/** Запускает команду через shell (для пайпов и редиректов). */
export async function shell(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  return exec(["sh", "-c", command], options);
}

/** Проверяет, доступна ли утилита в PATH. */
export async function hasCommand(name: string): Promise<boolean> {
  const result = await exec(["sh", "-c", `command -v ${name}`], { allowFailure: true });
  return result.code === 0;
}
