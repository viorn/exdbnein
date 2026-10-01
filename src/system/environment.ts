import { readdir } from "node:fs/promises";
import { shell } from "./exec.ts";

export type Firmware = "uefi" | "bios";

/** Маркер Live-окружения; создаётся сборкой LiveCD (этап 8). */
export const LIVE_MARKER = "/etc/exdbnein-live";

/** Установщик запущен от root. */
export async function isRoot(): Promise<boolean> {
  const result = await shell("id -u", { allowFailure: true });
  return result.code === 0 && result.stdout.trim() === "0";
}

/** Есть маркер LiveCD. */
export async function isLiveEnvironment(): Promise<boolean> {
  return Bun.file(LIVE_MARKER).exists();
}

/** Определение прошивки: UEFI при наличии /sys/firmware/efi. */
export async function detectFirmware(): Promise<Firmware> {
  return (await Bun.file("/sys/firmware/efi").exists()) ? "uefi" : "bios";
}

/** Число активных сетевых интерфейсов, кроме loopback. */
export async function networkInterfaceCount(): Promise<number> {
  try {
    const entries = await readdir("/sys/class/net");
    return entries.filter((name) => name !== "lo").length;
  } catch {
    return 0;
  }
}

/** Проверяет доступность зеркала HEAD-запросом за конечное время. */
export async function checkNetwork(mirror: string, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(mirror, { method: "HEAD", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
