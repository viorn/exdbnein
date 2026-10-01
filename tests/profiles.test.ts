import { describe, expect, test } from "bun:test";
import {
  loadProfiles,
  mergeProfiles,
  ProfileResolveError,
  resolveProfile,
  resolveProfiles,
  validateProfile,
} from "../src/profiles/index.ts";

const FIXTURES = `${import.meta.dir}/fixtures/profiles`;

async function loadFixtures() {
  return loadProfiles(FIXTURES);
}

describe("loadProfiles", () => {
  test("загружает все профили из каталога по имени", async () => {
    const profiles = await loadFixtures();
    expect(profiles.size).toBe(7);
    expect(profiles.has("base")).toBe(true);
    expect(profiles.has("child")).toBe(true);
  });

  test("профиль без name — ошибка", async () => {
    const dir = `${import.meta.dir}/fixtures/broken`;
    await Bun.write(`${dir}/no-name.yaml`, "packages: [x]\n");
    await expect(loadProfiles(dir)).rejects.toThrow(/отсутствует поле name/);
    await Bun.file(`${dir}/no-name.yaml`).delete();
  });
});

describe("resolveProfile", () => {
  test("наследование: пакеты union c дедупликацией, файлы по порядку", async () => {
    const profiles = await loadFixtures();
    const resolved = resolveProfile("child", profiles);

    expect(resolved.parents).toEqual(["base"]);
    expect(resolved.packages).toEqual(["curl", "git"]);
    expect(resolved.services).toEqual(["ssh"]);
    expect(resolved.files.map((f) => f.path)).toEqual(["/etc/a.conf", "/etc/b.conf"]);
  });

  test("цикл в extends — ошибка", async () => {
    const profiles = await loadFixtures();
    expect(() => resolveProfile("cycle-a", profiles)).toThrow(ProfileResolveError);
    expect(() => resolveProfile("cycle-a", profiles)).toThrow(/Цикл в extends/);
  });

  test("отсутствующий родитель — ошибка", async () => {
    const profiles = await loadFixtures();
    expect(() => resolveProfile("missing", profiles)).toThrow(/не найден/);
  });
});

describe("mergeProfiles", () => {
  test("конфликт файлов с разным содержимым — ошибка", async () => {
    const profiles = await loadFixtures();
    const list = [resolveProfile("conflict-a", profiles), resolveProfile("conflict-b", profiles)];
    expect(() => mergeProfiles(list)).toThrow(/Конфликт файла \/etc\/x\.conf/);
  });

  test("одинаковые файлы из разных профилей дедуплицируются", async () => {
    const profiles = await loadFixtures();
    const base = profiles.get("base");
    if (!base) throw new Error("нет фикстуры base");
    profiles.set("dup", { ...base, name: "dup" });
    const merged = mergeProfiles([
      resolveProfile("base", profiles),
      resolveProfile("dup", profiles),
    ]);
    expect(merged.files.filter((f) => f.path === "/etc/a.conf")).toHaveLength(1);
  });
});

describe("resolveProfiles", () => {
  test("несколько выбранных профилей объединяются", async () => {
    const profiles = await loadFixtures();
    const merged = resolveProfiles(["base", "conflict-a"], profiles);
    expect(merged.packages).toEqual(["curl"]);
    expect(merged.files.map((f) => f.path).sort()).toEqual(["/etc/a.conf", "/etc/x.conf"]);
  });
});

describe("validateProfile", () => {
  test("неизвестное поле — ошибка", () => {
    const issues = validateProfile("bad", { name: "bad", packages: ["x"], unexpected: 1 });
    expect(issues.some((i) => i.path === "unexpected")).toBe(true);
  });

  test("валидный профиль не даёт ошибок", () => {
    const issues = validateProfile("ok", {
      name: "ok",
      description: "x",
      extends: ["base"],
      packages: ["a"],
      services: ["s"],
      commands: [{ cmd: "true", description: "d", optional: true }],
      files: [{ path: "/etc/f", content: "c", mode: "0644" }],
    });
    expect(issues).toEqual([]);
  });
});
