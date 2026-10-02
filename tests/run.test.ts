import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { runLong } from "../src/system/run.ts";

/** Список cmdline процессов, содержащих строку (для проверки отсутствия осиротевших). */
async function findCmdlines(needle: string): Promise<string[]> {
  const pids = (await readdir("/proc")).filter((pid) => /^\d+$/.test(pid));
  const found: string[] = [];
  for (const pid of pids) {
    try {
      const cmd = (await Bun.file(`/proc/${pid}/cmdline`).text()).replaceAll("\0", " ");
      if (cmd.includes(needle)) found.push(cmd);
    } catch {
      // процесс исчез в момент чтения
    }
  }
  return found;
}

describe("runLong", () => {
  test("возвращает stdout успешной команды", async () => {
    const result = await runLong(["echo", "hello"], { label: "test echo" });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello\n");
  });

  test("передаёт переменные окружения", async () => {
    const result = await runLong(["sh", "-c", "echo $EXDB_TEST_VAR"], {
      label: "test env",
      env: { EXDB_TEST_VAR: "ok" },
    });
    expect(result.stdout.trim()).toBe("ok");
  });

  test("бросает ExecError при ненулевом коде", async () => {
    await expect(runLong(["sh", "-c", "exit 3"], { label: "test fail" })).rejects.toThrow(/code 3/);
  });

  test("allowFailure возвращает ненулевой код без исключения", async () => {
    const result = await runLong(["sh", "-c", "exit 3"], {
      label: "test allow",
      allowFailure: true,
    });
    expect(result.code).toBe(3);
  });

  test("таймаут прерывает команду и убивает всю группу процессов (P5.4)", async () => {
    const needle = "sleep 57493";
    await expect(
      runLong(["sh", "-c", needle], { label: "test timeout", timeoutMs: 400 }),
    ).rejects.toThrow(/time limit/);

    // Даём процессам время завершиться и убеждаемся, что никого не осталось.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await findCmdlines(needle)).toEqual([]);
  });
});
