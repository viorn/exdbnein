import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallLogger } from "../src/system/log.ts";

describe("InstallLogger (P7.2)", () => {
  test("накапливает записи в памяти с уровнями", () => {
    const logger = new InstallLogger();
    logger.step("postinstall", "Пост-установка");
    logger.info("начало");
    logger.ok("готово");
    logger.warn("optional пропущено");
    logger.error("ошибка");

    expect(logger.entries.map((entry) => entry.level)).toEqual([
      "step",
      "info",
      "ok",
      "warn",
      "error",
    ]);
    expect(logger.entries[0]?.message).toBe("postinstall: Пост-установка");
  });

  test("flush дописывает записи в файл и очищает буфер", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exdb-log-"));
    const file = join(dir, "install.log");
    const logger = new InstallLogger([file]);

    logger.info("первая запись");
    await logger.flush();
    expect(logger.entries).toHaveLength(0);

    const first = await Bun.file(file).text();
    expect(first).toContain("info: первая запись");

    // Повторный flush дописывает, а не перезаписывает.
    logger.ok("вторая запись");
    await logger.flush();
    const second = await Bun.file(file).text();
    expect(second).toContain("info: первая запись");
    expect(second).toContain("ok: вторая запись");

    await rm(dir, { recursive: true, force: true });
  });

  test("flush без записей не создаёт файл", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exdb-log-"));
    const file = join(dir, "install.log");
    const logger = new InstallLogger([file]);

    await logger.flush();
    expect(await Bun.file(file).exists()).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });
});
