import { readdir } from "node:fs/promises";
import { shell } from "./exec.ts";

export type Firmware = "uefi" | "bios";

/** Live-environment marker; created by the LiveCD build (stage 8). */
export const LIVE_MARKER = "/etc/exdbnein-live";

/** The installer is running as root. */
export async function isRoot(): Promise<boolean> {
  const result = await shell("id -u", { allowFailure: true });
  return result.code === 0 && result.stdout.trim() === "0";
}

/** The LiveCD marker is present. */
export async function isLiveEnvironment(): Promise<boolean> {
  return Bun.file(LIVE_MARKER).exists();
}

/** Firmware detection: UEFI when /sys/firmware/efi exists. */
export async function detectFirmware(): Promise<Firmware> {
  return (await Bun.file("/sys/firmware/efi").exists()) ? "uefi" : "bios";
}

/** Number of active network interfaces, excluding loopback. */
export async function networkInterfaceCount(): Promise<number> {
  try {
    const entries = await readdir("/sys/class/net");
    return entries.filter((name) => name !== "lo").length;
  } catch {
    return 0;
  }
}

/** Checks mirror availability with a HEAD request within a finite time. */
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
