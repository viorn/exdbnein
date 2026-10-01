/**
 * Хеширование паролей в формате crypt(3) (sha512-crypt) — именно он попадает
 * в /etc/shadow. Пароль передаётся через stdin, чтобы не светиться в списке процессов.
 */

async function opensslPasswd(password: string, salt?: string): Promise<string> {
  const args = ["openssl", "passwd", "-6"];
  if (salt) args.push("-salt", salt);
  args.push("-stdin");

  const proc = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(`${password}\n`);
  await proc.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    throw new Error(`Не удалось захешировать пароль: ${stderr.trim()}`);
  }
  return stdout.trim();
}

/** Возвращает sha512-crypt хеш пароля со случайной солью. */
export async function hashPassword(password: string): Promise<string> {
  return opensslPasswd(password);
}

/** Проверяет пароль против ранее полученного хеша. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const salt = hash.split("$")[2];
  if (!salt) return false;
  return (await opensslPasswd(password, salt)) === hash;
}
