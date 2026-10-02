/**
 * Password hashing in crypt(3) format (sha512-crypt) — exactly what goes into
 * /etc/shadow. The password is passed via stdin so it does not show in the process list.
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
    throw new Error(`Failed to hash password: ${stderr.trim()}`);
  }
  return stdout.trim();
}

/** Returns a sha512-crypt hash of the password with a random salt. */
export async function hashPassword(password: string): Promise<string> {
  return opensslPasswd(password);
}

/** Verifies a password against a previously obtained hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const salt = hash.split("$")[2];
  if (!salt) return false;
  return (await opensslPasswd(password, salt)) === hash;
}
