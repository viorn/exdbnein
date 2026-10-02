import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

/** Target system root (mount point during installation). */
export const TARGET_ROOT = "/mnt";

export interface ChrootMount {
  /** Mount point inside the target system. */
  target: string;
  description: string;
  argv: string[];
}

/**
 * Pseudo-FS mounts needed to work inside the chroot (P5.3):
 * apt/dpkg and package scripts see /proc, /sys, /dev, /run.
 * For UEFI a bind-mount of efivars is mandatory — without it GRUB will not
 * install at stage 6 (grub-install reads EFI variables).
 */
export function chrootMounts(firmware: Firmware): ChrootMount[] {
  const mounts: ChrootMount[] = [
    {
      target: "/proc",
      description: "Mount /proc into chroot",
      argv: ["mount", "-t", "proc", "proc", `${TARGET_ROOT}/proc`],
    },
    {
      target: "/sys",
      description: "Mount /sys into chroot",
      argv: ["mount", "--bind", "/sys", `${TARGET_ROOT}/sys`],
    },
    {
      target: "/dev",
      description: "Mount /dev into chroot",
      argv: ["mount", "--bind", "/dev", `${TARGET_ROOT}/dev`],
    },
    {
      target: "/dev/pts",
      description: "Mount /dev/pts into chroot",
      argv: ["mount", "-t", "devpts", "devpts", `${TARGET_ROOT}/dev/pts`],
    },
    {
      target: "/run",
      description: "Mount /run into chroot",
      argv: ["mount", "--bind", "/run", `${TARGET_ROOT}/run`],
    },
  ];

  if (firmware === "uefi") {
    mounts.push({
      target: "/sys/firmware/efi/efivars",
      description: "Mount /sys/firmware/efi/efivars into chroot (UEFI)",
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

/** The mount point is already mounted (idempotency of a re-entry). */
export async function isMounted(path: string): Promise<boolean> {
  const result = await exec(["findmnt", "-n", path], { allowFailure: true });
  return result.code === 0;
}

/** Wraps a command for execution inside the target root. */
export function inChroot(command: string[], root = TARGET_ROOT): string[] {
  return ["chroot", root, ...command];
}
