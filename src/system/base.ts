import { readdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { InstallConfig } from "../config/types.ts";
import { chrootMounts, inChroot, isMounted, TARGET_ROOT } from "./chroot.ts";
import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

/** Действие плана фазы B: команда, запись файла или генерация fstab. */
export interface PlannedAction {
  description: string;
  /** Команда для выполнения в отдельной группе процессов (см. run.ts). */
  argv?: string[];
  /** Файл в целевом корне. */
  file?: { path: string; content: string; mode?: string };
  /** Сгенерировать /etc/fstab по фактическим монтированиям. */
  generateFstab?: boolean;
  /** Лимит времени для argv (по умолчанию — 30 минут). */
  timeoutMs?: number;
  /** Ошибка выполнения не прерывает установку (команды профилей с optional). */
  optional?: boolean;
}

/** Кодовое имя стабильного Debian для debootstrap/apt. */
export const DEBOOTSTRAP_SUITE = "stable";
/** Компоненты архивов Debian 12+ (включая non-free-firmware); для debootstrap --components=. */
export const APT_COMPONENTS = "main,contrib,non-free,non-free-firmware";
/** Те же компоненты для sources.list (разделитель — пробел). */
const SOURCES_COMPONENTS = "main contrib non-free non-free-firmware";

/** Лимиты для долгих шагов. */
export const APT_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/** Команда debootstrap: минимальная база stable в целевой корень с зеркалом. */
export function debootstrapCommand(config: InstallConfig): string[] {
  return [
    "debootstrap",
    "--arch=amd64",
    "--variant=minbase",
    `--components=${APT_COMPONENTS}`,
    DEBOOTSTRAP_SUITE,
    TARGET_ROOT,
    config.mirror,
  ];
}

/** sources.list целевой системы: stable + updates + security. */
export function sourcesListContent(mirror: string): string {
  const mirrorBase = mirror.replace(/\/+$/, "");
  return [
    `deb ${mirrorBase} stable ${SOURCES_COMPONENTS}`,
    `deb ${mirrorBase} stable-updates ${SOURCES_COMPONENTS}`,
    `deb http://security.debian.org/debian-security stable-security ${SOURCES_COMPONENTS}`,
    "",
  ].join("\n");
}

/** Базовая система уже установлена: есть метаданные Debian в целевом корне. */
export async function isBaseInstalled(root = TARGET_ROOT): Promise<boolean> {
  return Bun.file(`${root}/etc/debian_version`).exists();
}

/** Пакет установлен в целевом корне (dpkg-query в chroot). */
export async function isPackageInstalled(pkg: string, root = TARGET_ROOT): Promise<boolean> {
  const result = await exec(inChroot(["dpkg-query", "-W", `-f=\${Status}`, pkg], root), {
    allowFailure: true,
  });
  return result.code === 0 && result.stdout.trim() === "install ok installed";
}

/** Есть ли файлы в каталоге (для идемпотентности apt-списков). */
async function dirHasFiles(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/** Записывает файл в целевую систему (создаёт каталоги, выставляет права). */
export async function writeTargetFile(file: {
  path: string;
  content: string;
  mode?: string;
}): Promise<void> {
  await exec(["mkdir", "-p", dirname(file.path)]);
  await Bun.write(file.path, file.content);
  if (file.mode) {
    await exec(["chmod", file.mode, file.path]);
  }
}

// ---- План этапа 5 (идемпотентный) ------------------------------------------

/** debootstrap — только если база ещё не установлена. */
export async function planDebootstrap(config: InstallConfig): Promise<PlannedAction[]> {
  if (await isBaseInstalled()) return [];
  return [
    {
      description: `debootstrap ${DEBOOTSTRAP_SUITE} в ${TARGET_ROOT} (${config.mirror})`,
      argv: debootstrapCommand(config),
    },
  ];
}

/** Монтирования псевдо-ФС — только те, что ещё не примонтированы. */
export async function planChrootMounts(firmware: Firmware): Promise<PlannedAction[]> {
  const actions: PlannedAction[] = [];
  for (const mount of chrootMounts(firmware)) {
    if (await isMounted(`${TARGET_ROOT}${mount.target}`)) continue;
    actions.push({ description: mount.description, argv: mount.argv });
  }
  return actions;
}

/** Копирует хостовый resolv.conf — без DNS apt в chroot не увидит зеркало. */
export async function planResolvConf(): Promise<PlannedAction[]> {
  const content = await Bun.file("/etc/resolv.conf")
    .text()
    .catch(() => "");
  if (!content.trim()) return [];
  return [
    {
      description: "Скопировать /etc/resolv.conf в целевую систему",
      file: { path: `${TARGET_ROOT}/etc/resolv.conf`, content, mode: "0644" },
    },
  ];
}

/** apt-get в chroot с неинтерактивным debconf (P6.1) и -y. */
export function aptGet(...args: string[]): string[] {
  return inChroot(["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y", ...args]);
}

/** apt-get update — только если списки пакетов ещё не загружены. */
export async function planAptUpdate(): Promise<PlannedAction[]> {
  if (await dirHasFiles(`${TARGET_ROOT}/var/lib/apt/lists`)) return [];
  return [
    {
      description: "Обновить списки пакетов (apt-get update)",
      argv: aptGet("update"),
      timeoutMs: APT_UPDATE_TIMEOUT_MS,
    },
  ];
}

/** Ядро и firmware — только если ядро ещё не установлено. */
export async function planKernelInstall(): Promise<PlannedAction[]> {
  if (await isPackageInstalled("linux-image-amd64")) return [];
  return [
    {
      description: "Установить ядро linux-image-amd64 и firmware-linux",
      argv: aptGet("install", "--no-install-recommends", "linux-image-amd64", "firmware-linux"),
    },
  ];
}

/** fstab — только если ещё не сгенерирован. */
export async function planFstab(): Promise<PlannedAction[]> {
  if (await Bun.file(`${TARGET_ROOT}/etc/fstab`).exists()) return [];
  return [
    {
      description: "Сгенерировать /etc/fstab по UUID",
      generateFstab: true,
    },
  ];
}
