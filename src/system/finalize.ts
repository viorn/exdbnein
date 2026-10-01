import { readFile } from "node:fs/promises";
import { isMounted, TARGET_ROOT } from "./chroot.ts";
import { exec } from "./exec.ts";
import { parseSwaps } from "./fstab.ts";

/**
 * Финализация установки (P7.3): корректное размонтирование /mnt, отключение swap
 * целевого диска и перезагрузка. Все операции идемпотентны и не бросают исключений —
 * вызываются из finally-блоков даже при ошибке установки.
 */

/** Читает активные swap-устройства из /proc/swaps. */
export async function readSwaps(): Promise<string[]> {
  try {
    return parseSwaps(await readFile("/proc/swaps", "utf8"));
  } catch {
    return [];
  }
}

/**
 * Swap-устройства целевой системы: явный список (схема keep) плюс все разделы
 * целевого диска по префиксу пути (схемы auto/manual). Swap LiveCD при этом не трогается.
 */
export function swapsForTarget(swaps: string[], device: string, extra: string[] = []): string[] {
  const wanted = new Set<string>(extra.filter(Boolean));
  for (const swap of swaps) {
    if (device && swap.startsWith(device)) wanted.add(swap);
  }
  return [...wanted];
}

/** Отключает подкачку целевой системы; утилизирует только свои разделы. */
export async function swapoffTarget(device: string, extra: string[] = []): Promise<void> {
  for (const swap of swapsForTarget(await readSwaps(), device, extra)) {
    await exec(["swapoff", swap], { allowFailure: true });
  }
}

/**
 * Порядок размонтирования: вложенные точки раньше корня /mnt (последний элемент).
 * Совпадает с монтированиями этапа 4 (ESP, @home, @snapshots) и chroot-монтированиями
 * этапа 5 (/proc /sys /dev /dev/pts /run + efivars внутри /sys).
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
 * Размонтирует целевую систему. Каждая точка проверяется через findmnt —
 * повторный вызов после ошибки безопасен и ничего не ломает.
 */
export async function unmountTarget(root = TARGET_ROOT): Promise<void> {
  for (const suffix of UNMOUNT_ORDER) {
    const path = suffix === "" ? root : `${root}${suffix}`;
    if (await isMounted(path)) {
      await exec(["umount", path], { allowFailure: true });
    }
  }
}

/** Перезагружает систему (по подтверждению пользователя). */
export async function rebootNow(): Promise<void> {
  await exec(["reboot"]);
}
