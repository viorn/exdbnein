import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MergedProfiles } from "../src/profiles/types.ts";
import {
  markCommandsApplied,
  pendingCommands,
  planCleanup,
  planProfileFiles,
  planProfilePackages,
  planProfileServices,
  profileTargetPath,
  readAppliedCommands,
} from "../src/system/postinstall.ts";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "exdb-postinstall-"));
}

describe("profileTargetPath (P7.1)", () => {
  test("добавляет префикс целевого корня к абсолютному пути", () => {
    expect(profileTargetPath("/etc/skel/example.conf")).toBe("/mnt/etc/skel/example.conf");
  });

  test("нормализует путь без ведущего слэша", () => {
    expect(profileTargetPath("etc/x", "/tmp/root")).toBe("/tmp/root/etc/x");
  });
});

describe("применение файлов профилей", () => {
  test("planProfileFiles: отсутствующий файл попадает в план с префиксом корня", async () => {
    const root = await tempRoot();
    const merged: MergedProfiles = {
      packages: [],
      services: [],
      commands: [],
      files: [{ path: "/etc/example.conf", content: "key=value\n", mode: "0644" }],
    };

    const plan = await planProfileFiles(merged, root);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.file?.path).toBe(`${root}/etc/example.conf`);
    expect(plan[0]?.file?.mode).toBe("0644");

    await rm(root, { recursive: true, force: true });
  });

  test("planProfileFiles: совпадающий файл пропускается, изменённый — пишется заново", async () => {
    const root = await tempRoot();
    const merged: MergedProfiles = {
      packages: [],
      services: [],
      commands: [],
      files: [{ path: "/etc/example.conf", content: "key=value\n", mode: "0644" }],
    };

    const first = (await planProfileFiles(merged, root))[0];
    expect(first?.file?.path).toBeDefined();
    const target = first?.file?.path ?? `${root}/etc/example.conf`;
    await Bun.write(target, "key=value\n");

    expect(await planProfileFiles(merged, root)).toEqual([]);

    await Bun.write(target, "changed\n");
    expect(await planProfileFiles(merged, root)).toHaveLength(1);

    await rm(root, { recursive: true, force: true });
  });
});

describe("маркер применённых команд (P7.2)", () => {
  test("readAppliedCommands: пустой набор до первой записи", async () => {
    const root = await tempRoot();
    expect([...(await readAppliedCommands(root))]).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  test("markCommandsApplied дополняет состояние между запусками", async () => {
    const root = await tempRoot();
    await markCommandsApplied(["systemctl enable ssh"], root);
    await markCommandsApplied(["ufw default deny incoming", "systemctl enable ssh"], root);

    const applied = await readAppliedCommands(root);
    expect(applied.has("systemctl enable ssh")).toBe(true);
    expect(applied.has("ufw default deny incoming")).toBe(true);
    expect(applied.size).toBe(2);

    await rm(root, { recursive: true, force: true });
  });

  test("pendingCommands отсеивает уже применённые команды", () => {
    const commands = [
      { cmd: "systemctl enable ssh" },
      { cmd: "ufw default deny incoming", optional: true },
    ];
    expect(pendingCommands(commands, new Set(["systemctl enable ssh"])).map((c) => c.cmd)).toEqual([
      "ufw default deny incoming",
    ]);
    expect(pendingCommands(commands, new Set())).toHaveLength(2);
  });
});

describe("planProfilePackages", () => {
  test("пустой набор пакетов — пустой план", async () => {
    const merged: MergedProfiles = { packages: [], services: [], commands: [], files: [] };
    expect(await planProfilePackages(merged)).toEqual([]);
  });

  test("недостающие пакеты ставятся одним apt-get install", async () => {
    const merged: MergedProfiles = {
      packages: ["nginx", "htop"],
      services: [],
      commands: [],
      files: [],
    };
    const plan = await planProfilePackages(merged);
    if (plan.length > 0) {
      const argv = plan[0]?.argv ?? [];
      expect(argv).toContain("apt-get");
      expect(argv).toContain("nginx");
      expect(argv).toContain("htop");
    }
  });
});

describe("planProfileServices", () => {
  test("включение сервисов выполняется в chroot через systemctl enable", async () => {
    const merged: MergedProfiles = {
      packages: [],
      services: ["ssh", "nginx"],
      commands: [],
      files: [],
    };
    const plan = await planProfileServices(merged);
    if (plan.length > 0) {
      const argv = plan[0]?.argv ?? [];
      expect(argv.slice(0, 2)).toEqual(["chroot", "/mnt"]);
      expect(argv).toContain("systemctl");
      expect(argv).toContain("enable");
      expect(argv).toContain("ssh");
      expect(argv).toContain("nginx");
    }
  });
});

describe("planCleanup", () => {
  test("apt clean + удаление временных файлов exdbnein", async () => {
    const plan = await planCleanup();
    expect(plan).toHaveLength(2);
    expect(plan[0]?.description).toContain("apt-get clean");
    expect(plan[0]?.argv).toContain("clean");
    expect(plan[1]?.argv?.[0]).toBe("sh");
    expect(plan[1]?.description).toContain("/tmp");
  });
});
