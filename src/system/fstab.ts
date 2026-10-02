import { TARGET_ROOT } from "./chroot.ts";
import { exec } from "./exec.ts";

/** findmnt columns needed by the fstab generator. */
const FINDMNT_COLUMNS = "SOURCE,TARGET,FSTYPE,OPTIONS,UUID";

export interface FindmntEntry {
  source: string;
  target: string;
  fstype: string;
  options: string;
  uuid?: string;
}

export interface FstabEntry {
  /** Source in fstab format, e.g. UUID=... */
  source: string;
  /** Mount point in the target system: /, /home, none (swap). */
  mountpoint: string;
  fstype: string;
  options: string;
  dump: number;
  pass: number;
}

/** Real filesystems — go into fstab; pseudo-FS are mounted by the system automatically. */
export const REAL_FILESYSTEMS = new Set(["btrfs", "ext4", "vfat", "xfs", "f2fs", "exfat", "ntfs"]);

/** Parses `findmnt -J` output. */
export function parseFindmnt(json: string): FindmntEntry[] {
  const parsed = JSON.parse(json) as { filesystems?: FindmntEntry[] };
  return (parsed.filesystems ?? []).filter((entry) => typeof entry.target === "string");
}

/** Converts a mount point inside the target root into a target system path. */
export function targetToMountpoint(target: string, root = TARGET_ROOT): string {
  if (target === root) return "/";
  if (target.startsWith(`${root}/`)) return target.slice(root.length);
  return target;
}

/** Real filesystems mounted inside the target root. */
export function realEntries(entries: FindmntEntry[], root = TARGET_ROOT): FindmntEntry[] {
  return entries.filter(
    (entry) =>
      REAL_FILESYSTEMS.has(entry.fstype) &&
      (entry.target === root || entry.target.startsWith(`${root}/`)),
  );
}

/** Extracts the subvol= option from a mount options string (btrfs). */
export function subvolOption(options: string): string | null {
  const match = /(?:^|,)(subvol=[^,]+)/.exec(options);
  return match?.[1] ?? null;
}

/**
 * fstab options by filesystem type (matching stage 4–5 decisions):
 * btrfs — compress=zstd,noatime (+subvol), vfat — umask=0077, others — rw,relatime.
 */
export function fstabOptions(entry: FindmntEntry): string {
  if (entry.fstype === "vfat") return "defaults,umask=0077";
  if (entry.fstype === "btrfs") {
    const subvol = subvolOption(entry.options);
    return subvol ? `rw,noatime,compress=zstd,${subvol}` : "rw,noatime,compress=zstd";
  }
  return "rw,relatime";
}

/** dump/pass fields by filesystem type and mount point. */
export function fstabDumpPass(fstype: string, mountpoint: string): [number, number] {
  if (fstype === "btrfs" || fstype === "xfs" || fstype === "f2fs") return [0, 0];
  if (mountpoint === "/") return [0, 1];
  if (fstype === "vfat") return [0, 1];
  if (fstype === "ext4") return [0, 2];
  return [0, 0];
}

/** A single fstab line. */
export function formatFstabEntry(entry: FstabEntry): string {
  return [entry.source, entry.mountpoint, entry.fstype, entry.options, entry.dump, entry.pass].join(
    "\t",
  );
}

/** All fstab lines. */
export function formatFstab(entries: FstabEntry[]): string {
  return entries.map(formatFstabEntry).join("\n");
}

/** Parses /proc/swaps into a list of swap devices. */
export function parseSwaps(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("Filename"))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter((device) => device.startsWith("/dev/"));
}

/** Parses `blkid -o export`: DEVNAME=.../UUID=... pairs into a device → UUID map. */
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
 * Builds fstab from the actual state (P5.2): real FS mounted in the target
 * root from findmnt + swap from /proc/swaps, UUIDs taken from blkid.
 * Entries by UUID, not by /dev/sdX — device names change between reboots.
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

/** Generates fstab from the actually mounted target root. */
export async function generateFstab(root = TARGET_ROOT): Promise<string> {
  const findmnt = await exec(["findmnt", "-R", "-J", "-o", FINDMNT_COLUMNS, root]);
  const swaps = await Bun.file("/proc/swaps").text();
  const blkid = await exec(["blkid", "-o", "export"]);
  return buildFstab(findmnt.stdout, swaps, blkid.stdout, root);
}
