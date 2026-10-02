import { readFile } from "node:fs/promises";
import { isMounted, TARGET_ROOT } from "./chroot.ts";
import { exec } from "./exec.ts";
import { parseSwaps } from "./fstab.ts";

/**
 * Installation finalization (P7.3): proper unmounting of /mnt, disabling the target
 * disk swap and rebooting. All operations are idempotent and do not throw —
 * they are called from finally blocks even on installation errors.
 */

/** Reads active swap devices from /proc/swaps. */
export async function readSwaps(): Promise<string[]> {
  try {
    return parseSwaps(await readFile("/proc/swaps", "utf8"));
  } catch {
    return [];
  }
}

/**
 * Target system swap devices: the explicit list (keep layout) plus all partitions
 * of the target disk by path prefix (auto/manual layouts). The LiveCD swap is untouched.
 */
export function swapsForTarget(swaps: string[], device: string, extra: string[] = []): string[] {
  const wanted = new Set<string>(extra.filter(Boolean));
  for (const swap of swaps) {
    if (device && swap.startsWith(device)) wanted.add(swap);
  }
  return [...wanted];
}

/** Disables the target system swap; only touches its own partitions. */
export async function swapoffTarget(device: string, extra: string[] = []): Promise<void> {
  for (const swap of swapsForTarget(await readSwaps(), device, extra)) {
    await exec(["swapoff", swap], { allowFailure: true });
  }
}

/**
 * Unmount order: nested mount points before the root /mnt (the last element).
 * Matches stage 4 mounts (ESP, @home, @snapshots) and stage 5 chroot mounts
 * (/proc /sys /dev /dev/pts /run + efivars inside /sys).
 */
export const UNMOUNT_ORDER = [
  "/boot/efi",
  "/.snapshots",
  "/home",
  "/dev/pts",
  "/dev",
  "/proc",
  "/sys",
  "/run",
  "",
];

/**
 * Unmounts the target system. Every mount point is checked via findmnt —
 * calling again after an error is safe and breaks nothing.
 */
export async function unmountTarget(root = TARGET_ROOT): Promise<void> {
  for (const suffix of UNMOUNT_ORDER) {
    const path = suffix === "" ? root : `${root}${suffix}`;
    if (await isMounted(path)) {
      await exec(["umount", path], { allowFailure: true });
    }
  }
}

/** Reboots the system (after user confirmation). */
export async function rebootNow(): Promise<void> {
  await exec(["reboot"]);
}
