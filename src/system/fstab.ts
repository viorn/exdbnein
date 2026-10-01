import { TARGET_ROOT } from "./chroot.ts";
import { exec } from "./exec.ts";

/** Колонки findmnt, нужные генератору fstab. */
const FINDMNT_COLUMNS = "SOURCE,TARGET,FSTYPE,OPTIONS,UUID";

export interface FindmntEntry {
  source: string;
  target: string;
  fstype: string;
  options: string;
  uuid?: string;
}

export interface FstabEntry {
  /** Источник в формате fstab, например UUID=... */
  source: string;
  /** Точка монтирования в целевой системе: /, /home, none (swap). */
  mountpoint: string;
  fstype: string;
  options: string;
  dump: number;
  pass: number;
}

/** Настоящие ФС — попадают в fstab; псевдо-ФС монтируются системой автоматически. */
export const REAL_FILESYSTEMS = new Set(["btrfs", "ext4", "vfat", "xfs", "f2fs", "exfat", "ntfs"]);

/** Разбирает вывод `findmnt -J`. */
export function parseFindmnt(json: string): FindmntEntry[] {
  const parsed = JSON.parse(json) as { filesystems?: FindmntEntry[] };
  return (parsed.filesystems ?? []).filter((entry) => typeof entry.target === "string");
}

/** Преобразует точку монтирования внутри целевого корня в путь целевой системы. */
export function targetToMountpoint(target: string, root = TARGET_ROOT): string {
  if (target === root) return "/";
  if (target.startsWith(`${root}/`)) return target.slice(root.length);
  return target;
}

/** Реальные ФС, смонтированные внутри целевого корня. */
export function realEntries(entries: FindmntEntry[], root = TARGET_ROOT): FindmntEntry[] {
  return entries.filter(
    (entry) =>
      REAL_FILESYSTEMS.has(entry.fstype) &&
      (entry.target === root || entry.target.startsWith(`${root}/`)),
  );
}

/** Извлекает опцию subvol= из строки монтирования (btrfs). */
export function subvolOption(options: string): string | null {
  const match = /(?:^|,)(subvol=[^,]+)/.exec(options);
  return match?.[1] ?? null;
}

/**
 * Опции fstab по типу ФС (соответствуют решениям этапов 4–5):
 * btrfs — compress=zstd,noatime (+subvol), vfat — umask=0077, остальные — rw,relatime.
 */
export function fstabOptions(entry: FindmntEntry): string {
  if (entry.fstype === "vfat") return "defaults,umask=0077";
  if (entry.fstype === "btrfs") {
    const subvol = subvolOption(entry.options);
    return subvol ? `rw,noatime,compress=zstd,${subvol}` : "rw,noatime,compress=zstd";
  }
  return "rw,relatime";
}

/** Поля dump/pass по типу ФС и точке монтирования. */
export function fstabDumpPass(fstype: string, mountpoint: string): [number, number] {
  if (fstype === "btrfs" || fstype === "xfs" || fstype === "f2fs") return [0, 0];
  if (mountpoint === "/") return [0, 1];
  if (fstype === "vfat") return [0, 1];
  if (fstype === "ext4") return [0, 2];
  return [0, 0];
}

/** Одна строка fstab. */
export function formatFstabEntry(entry: FstabEntry): string {
  return [entry.source, entry.mountpoint, entry.fstype, entry.options, entry.dump, entry.pass].join(
    "\t",
  );
}

/** Все строки fstab. */
export function formatFstab(entries: FstabEntry[]): string {
  return entries.map(formatFstabEntry).join("\n");
}

/** Разбирает /proc/swaps в список устройств подкачки. */
export function parseSwaps(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("Filename"))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter((device) => device.startsWith("/dev/"));
}

/** Разбирает `blkid -o export`: пары DEVNAME=.../UUID=... в карту устройство → UUID. */
export function parseBlkidExport(text: string): Map<string, string> {
  const uuidByDevice = new Map<string, string>();
  let device = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("DEVNAME=")) {
      device = line.slice("DEVNAME=".length);
    } else if (line.startsWith("UUID=") && device) {
      uuidByDevice.set(device, line.slice("UUID=".length));
    } else if (line.trim() === "") {
      device = "";
    }
  }
  return uuidByDevice;
}

/**
 * Собирает fstab из фактического состояния (P5.2): примонтированные в целевом
 * корне реальные ФС из findmnt + swap из /proc/swaps, UUID берутся из blkid.
 * Записи по UUID, а не по /dev/sdX — имена устройств меняются между перезагрузками.
 */
export function buildFstab(
  findmntJson: string,
  swapsText: string,
  blkidExport: string,
  root = TARGET_ROOT,
): string {
  const entries: FstabEntry[] = [];

  for (const entry of realEntries(parseFindmnt(findmntJson), root)) {
    if (!entry.uuid) continue;
    const mountpoint = targetToMountpoint(entry.target, root);
    const [dump, pass] = fstabDumpPass(entry.fstype, mountpoint);
    entries.push({
      source: `UUID=${entry.uuid}`,
      mountpoint,
      fstype: entry.fstype,
      options: fstabOptions(entry),
      dump,
      pass,
    });
  }

  const uuidByDevice = parseBlkidExport(blkidExport);
  for (const device of parseSwaps(swapsText)) {
    const uuid = uuidByDevice.get(device);
    if (!uuid) continue;
    entries.push({
      source: `UUID=${uuid}`,
      mountpoint: "none",
      fstype: "swap",
      options: "sw",
      dump: 0,
      pass: 0,
    });
  }

  return formatFstab(entries);
}

/** Генерирует fstab по фактически примонтированному целевому корню. */
export async function generateFstab(root = TARGET_ROOT): Promise<string> {
  const findmnt = await exec(["findmnt", "-R", "-J", "-o", FINDMNT_COLUMNS, root]);
  const swaps = await Bun.file("/proc/swaps").text();
  const blkid = await exec(["blkid", "-o", "export"]);
  return buildFstab(findmnt.stdout, swaps, blkid.stdout, root);
}
