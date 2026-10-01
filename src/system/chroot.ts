import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

/** Корень целевой системы (точка монтирования во время установки). */
export const TARGET_ROOT = "/mnt";

export interface ChrootMount {
  /** Точка монтирования внутри целевой системы. */
  target: string;
  description: string;
  argv: string[];
}

/**
 * Монтирования псевдо-ФС, необходимые для работы в chroot (P5.3):
 * apt/dpkg и скрипты пакетов видят /proc, /sys, /dev, /run.
 * Для UEFI обязателен bind-mount efivars — без него на этапе 6 не
 * установится GRUB (grub-install читает EFI-переменные).
 */
export function chrootMounts(firmware: Firmware): ChrootMount[] {
  const mounts: ChrootMount[] = [
    {
      target: "/proc",
      description: "Примонтировать /proc в chroot",
      argv: ["mount", "-t", "proc", "proc", `${TARGET_ROOT}/proc`],
    },
    {
      target: "/sys",
      description: "Примонтировать /sys в chroot",
      argv: ["mount", "--bind", "/sys", `${TARGET_ROOT}/sys`],
    },
    {
      target: "/dev",
      description: "Примонтировать /dev в chroot",
      argv: ["mount", "--bind", "/dev", `${TARGET_ROOT}/dev`],
    },
    {
      target: "/dev/pts",
      description: "Примонтировать /dev/pts в chroot",
      argv: ["mount", "-t", "devpts", "devpts", `${TARGET_ROOT}/dev/pts`],
    },
    {
      target: "/run",
      description: "Примонтировать /run в chroot",
      argv: ["mount", "--bind", "/run", `${TARGET_ROOT}/run`],
    },
  ];

  if (firmware === "uefi") {
    mounts.push({
      target: "/sys/firmware/efi/efivars",
      description: "Примонтировать /sys/firmware/efi/efivars в chroot (UEFI)",
      argv: [
        "mount",
        "--bind",
        "/sys/firmware/efi/efivars",
        `${TARGET_ROOT}/sys/firmware/efi/efivars`,
      ],
    });
  }

  return mounts;
}

/** Точка уже примонтирована (идемпотентность повторного входа). */
export async function isMounted(path: string): Promise<boolean> {
  const result = await exec(["findmnt", "-n", path], { allowFailure: true });
  return result.code === 0;
}

/** Обёртка команды для выполнения внутри целевого корня. */
export function inChroot(command: string[], root = TARGET_ROOT): string[] {
  return ["chroot", root, ...command];
}
