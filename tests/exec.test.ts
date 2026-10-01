import { describe, expect, test } from "bun:test";
import { ExecError, exec, hasCommand, shell } from "../src/system/exec.ts";

describe("exec", () => {
  test("возвращает stdout и код 0", async () => {
    const result = await exec(["echo", "hello"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  test("бросает ExecError при ненулевом коде", async () => {
    expect(exec(["sh", "-c", "exit 3"])).rejects.toBeInstanceOf(ExecError);
  });

  test("allowFailure не бросает исключение", async () => {
    const result = await exec(["sh", "-c", "exit 3"], { allowFailure: true });
    expect(result.code).toBe(3);
  });

  test("shell выполняет пайпы", async () => {
    const result = await shell("printf 'a\\nb\\n' | wc -l");
    expect(result.stdout.trim()).toBe("2");
  });

  test("hasCommand находит sh и не находит несуществующую утилиту", async () => {
    expect(await hasCommand("sh")).toBe(true);
    expect(await hasCommand("exdbnein-nonexistent-tool")).toBe(false);
  });
});
