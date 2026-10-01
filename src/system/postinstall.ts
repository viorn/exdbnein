import type { MergedProfiles, ProfileFile } from "../profiles/types.ts";
import { aptGet, isPackageInstalled, type PlannedAction, writeTargetFile } from "./base.ts";
import { inChroot, TARGET_ROOT } from "./chroot.ts";
import { isServiceEnabled } from "./configure.ts";

/**
 * Применение профилей (этап 7). Два пространства путей (P7.1):
 * - файлы пишутся через writer — путь профиля получает префикс целевого корня
 *   (profileTargetPath: `/etc/x` → `/mnt/etc/x`);
 * - команды выполняются в chroot и видят целевую систему напрямую (`/etc/x`).
 */

/** Преобразует путь файла профиля в путь на хосте установщика (writer-пространство). */
export function profileTargetPath(profilePath: string, root = TARGET_ROOT): string {
  const normalized = profilePath.startsWith("/") ? profilePath : `/${profilePath}`;
  return `${root}${normalized}`;
}

/** Содержимое файла профиля уже совпадает с файлом в целевой системе. */
export async function isProfileFileSame(file: ProfileFile, root = TARGET_ROOT): Promise<boolean> {
  const current = await Bun.file(profileTargetPath(file.path, root))
    .text()
    .catch(() => null);
  return current === file.content;
}

/** Недостающие пакеты профилей — одним apt-get install (идемпотентно по dpkg-статусам). */
export async function planProfilePackages(merged: MergedProfiles): Promise<PlannedAction[]> {
  const toInstall: string[] = [];
  for (const pkg of merged.packages) {
    if (!(await isPackageInstalled(pkg))) toInstall.push(pkg);
  }
  if (toInstall.length === 0) return [];
  return [
    {
      description: `Установить пакеты профилей: ${toInstall.join(", ")}`,
      argv: aptGet("install", "--no-install-recommends", ...toInstall),
    },
  ];
}

/** Недостающие сервисы профилей — одним systemctl enable (в chroot). */
export async function planProfileServices(merged: MergedProfiles): Promise<PlannedAction[]> {
  const toEnable: string[] = [];
  for (const service of merged.services) {
    if (!(await isServiceEnabled(service))) toEnable.push(service);
  }
  if (toEnable.length === 0) return [];
  return [
    {
      description: `Включить сервисы профилей: ${toEnable.join(", ")}`,
      argv: inChroot(["systemctl", "enable", ...toEnable]),
    },
  ];
}

/** Файлы профилей — только если содержимое отличается от текущего. */
export async function planProfileFiles(
  merged: MergedProfiles,
  root = TARGET_ROOT,
): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  for (const file of merged.files) {
    if (await isProfileFileSame(file, root)) continue;
    actions.push({
      description: `Записать файл профиля ${file.path}`,
      file: {
        path: profileTargetPath(file.path, root),
        content: file.content,
        mode: file.mode || "0644",
      },
    });
  }
  return actions;
}

// ---- маркер применённых команд (идемпотентный повторный вход, P7.2) ----------

/** Файл состояния внутри целевой системы; сохраняется между запусками. */
export const APPLIED_STATE_PATH = "/var/lib/exdbnein/applied.json";

interface AppliedState {
  /** Команды, выполнившиеся успешно (повторно не запускаются). */
  commands: string[];
}

/** Читает список применённых команд; при отсутствии файла — пустой набор. */
export async function readAppliedCommands(root = TARGET_ROOT): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(
      await Bun.file(`${root}${APPLIED_STATE_PATH}`).text(),
    ) as AppliedState;
    return new Set(parsed.commands ?? []);
  } catch {
    return new Set();
  }
}

/** Команды, которые ещё предстоит выполнить (не помечены как применённые). */
export function pendingCommands(
  commands: MergedProfiles["commands"],
  applied: ReadonlySet<string>,
): MergedProfiles["commands"] {
  return commands.filter((command) => !applied.has(command.cmd));
}

/** Помечает команды как применённые (после успешного выполнения). */
export async function markCommandsApplied(commands: string[], root = TARGET_ROOT): Promise<void> {
  const applied = await readAppliedCommands(root);
  for (const command of commands) applied.add(command);
  const state: AppliedState = { commands: [...applied] };
  await writeTargetFile({
    path: `${root}${APPLIED_STATE_PATH}`,
    content: JSON.stringify(state, null, 2),
    mode: "0600",
  });
}

// ---- очистка ----------------------------------------------------------------

/** Очистка после применения профилей: кэш apt и временные файлы установщика. */
export async function planCleanup(root = TARGET_ROOT): Promise<PlannedAction[]> {
  return [
    {
      description: "Очистить кэш пакетов (apt-get clean)",
      argv: aptGet("clean"),
    },
    {
      description: "Удалить временные файлы exdbnein из /tmp",
      argv: ["sh", "-c", `rm -rf ${root}/tmp/exdbnein-*`],
    },
  ];
}
