import type { DiskConfig, Filesystem, InstallConfig } from "../config/types.ts";
import { isMounted, TARGET_ROOT } from "./chroot.ts";
import type { Firmware } from "./environment.ts";
import { isLiveEnvironment } from "./environment.ts";
import { exec, hasCommand } from "./exec.ts";

/** Disk information from lsblk. */
export interface DiskInfo {
  /** Device name, e.g. sda. */
  name: string;
  /** Device path, e.g. /dev/sda. */
  path: string;
  /** Human-readable size, e.g. 238.5G. */
  size: string;
  /** Device type (disk/part/...). */
  type: string;
  /** Removable medium. */
  removable: boolean;
  /** Transport: usb/sata/nvme/... */
  tran?: string;
  model?: string;
  /** The disk is the LiveCD medium (or the current OS system disk). */
  isLiveMedium: boolean;
}

interface LsblkNode {
  name: string;
  path?: string;
  size?: string;
  type?: string;
  rm?: string;
  tran?: string;
  model?: string;
  fstype?: string;
  mountpoints?: (string | null)[];
  children?: LsblkNode[];
}

const LSBLK_COLUMNS = [
  "NAME",
  "PATH",
  "SIZE",
  "TYPE",
  "RM",
  "TRAN",
  "MODEL",
  "FSTYPE",
  "MOUNTPOINTS",
];

/** Parses `lsblk -J` output into a list of disks (only type=disk). */
export function parseLsblkOutput(json: string, isLive = true): DiskInfo[] {
  const parsed = JSON.parse(json) as { blockdevices?: LsblkNode[] };
  return (parsed.blockdevices ?? [])
    .filter((node) => node.type === "disk")
    .map((node) => toDiskInfo(node, isLive));
}

function toDiskInfo(node: LsblkNode, isLive = true): DiskInfo {
  return {
    name: node.name,
    path: node.path || `/dev/${node.name}`,
    size: node.size ?? "?",
    type: node.type ?? "disk",
    removable: node.rm === "1",
    tran: node.tran,
    model: node.model,
    isLiveMedium: hasLiveMountpoint(node, isLive),
  };
}

/**
 * The LiveCD medium — a disk where the system root ("/"),
 * live partitions (/run/live*), CD (/cdrom) or removable media (/media/*) are mounted.
 * Such disks cannot be selected as the installation target.
 *
 * When `isLive` is false (running outside LiveCD, e.g. `--force`), only removable
 * media (/media/*) and /cdrom are excluded — the host system disk (mounted at "/")
 * is NOT treated as a LiveCD medium.
 */
function hasLiveMountpoint(node: LsblkNode, isLive = true): boolean {
  const mounts = collectMountpoints(node);
  if (!isLive) {
    // Outside LiveCD: exclude only removable media and /cdrom.
    return mounts.some((m) => m === "/cdrom" || m.startsWith("/media/"));
  }
  return mounts.some(
    (mount) =>
      mount === "/" ||
      mount.startsWith("/run/live") ||
      mount === "/cdrom" ||
      mount.startsWith("/media/"),
  );
}

function collectMountpoints(node: LsblkNode): string[] {
  const own = (node.mountpoints ?? []).filter(
    (mount): mount is string => typeof mount === "string",
  );
  const children = (node.children ?? []).flatMap((child) => collectMountpoints(child));
  return [...own, ...children];
}

/** Returns the path to the disk partition `index` (p suffix for NVMe/MMC etc.). */
export function partitionPath(diskPath: string, index: number): string {
  return /[0-9]$/.test(diskPath) ? `${diskPath}p${index}` : `${diskPath}${index}`;
}

/** Fetches the disk list via `lsblk -J`. */
export async function listDisks(): Promise<DiskInfo[]> {
  const result = await exec(["lsblk", "-J", "-o", LSBLK_COLUMNS.join(",")], {
    allowFailure: true,
  });
  if (result.code !== 0) {
    throw new Error(`Failed to list disks: ${result.stderr.trim()}`);
  }
  const isLive = await isLiveEnvironment();
  return parseLsblkOutput(result.stdout, isLive);
}

// ---- Stage 4: disk partitioning ----------------------------------------------

export type PartitionTable = "gpt" | "msdos";
export type PartitionKind = "esp" | "root" | "swap";
export type CommandPhase = "partition" | "format" | "mount";

/** Partition in the generated layout (auto/manual schemes). */
export interface PartitionSpec {
  /** Partition number (1-based). */
  number: number;
  kind: PartitionKind;
  /** Size in GiB; absent — the partition takes the rest of the disk. */
  sizeGiB?: number;
  filesystem: Filesystem | "fat32" | "swap";
  /** Mount point in the target system. */
  mountpoint?: string;
  /** Partition flag (GPT: esp; MBR: boot). */
  bootFlag?: "esp" | "boot";
  /** Create btrfs subvolumes (@, @home, @snapshots). */
  btrfsSubvolumes?: boolean;
}

/** Partition layout for the auto/manual schemes. */
export interface PartitionLayout {
  table: PartitionTable;
  partitions: PartitionSpec[];
}

/** Plan command: shown in dry-run and executed directly (no shell). */
export interface PlannedCommand {
  phase: CommandPhase;
  /** Human-readable description. */
  description: string;
  /** Command arguments. */
  argv: string[];
}

/** Partition information from lsblk. */
export interface PartitionInfo {
  name: string;
  path: string;
  size: string;
  fstype?: string;
  mountpoints: string[];
}

const PARTED_FS: Record<PartitionSpec["filesystem"], string> = {
  btrfs: "btrfs",
  ext4: "ext4",
  fat32: "fat32",
  swap: "linux-swap",
};

const KIND_LABEL: Record<PartitionKind, string> = {
  esp: "ESP",
  root: "root",
  swap: "swap",
};

/**
 * Builds the layout for auto/manual schemes: UEFI → GPT + ESP + root (+swap),
 * BIOS → MBR + root (+swap). The root partition is last and takes the rest of the disk.
 */
export function buildPartitionLayout(disk: DiskConfig, firmware: Firmware): PartitionLayout {
  const partitions: PartitionSpec[] = [];

  if (firmware === "uefi") {
    partitions.push({
      number: 1,
      kind: "esp",
      sizeGiB: disk.espSizeGiB,
      filesystem: "fat32",
      mountpoint: "/boot/efi",
      bootFlag: "esp",
    });
  }

  if (disk.swap) {
    partitions.push({
      number: partitions.length + 1,
      kind: "swap",
      sizeGiB: disk.swapSizeGiB,
      filesystem: "swap",
    });
  }

  const root: PartitionSpec = {
    number: partitions.length + 1,
    kind: "root",
    filesystem: disk.filesystem,
    mountpoint: "/",
    btrfsSubvolumes: disk.filesystem === "btrfs" && disk.btrfsSubvolumes,
  };
  if (firmware === "bios") root.bootFlag = "boot";
  partitions.push(root);

  return { table: firmware === "uefi" ? "gpt" : "msdos", partitions };
}

/** Parses `lsblk -J <disk>` output into a list of disk partitions. */
export function parseLsblkPartitions(json: string): PartitionInfo[] {
  const parsed = JSON.parse(json) as { blockdevices?: LsblkNode[] };
  const diskNode = parsed.blockdevices?.[0];
  return (diskNode?.children ?? [])
    .filter((node) => node.type === "part")
    .map((node) => ({
      name: node.name,
      path: node.path || `/dev/${node.name}`,
      size: node.size ?? "?",
      fstype: node.fstype,
      mountpoints: (node.mountpoints ?? []).filter(
        (mount): mount is string => typeof mount === "string",
      ),
    }));
}

/** Fetches the partitions of a disk via `lsblk -J <device>`. */
export async function listPartitions(device: string): Promise<PartitionInfo[]> {
  const result = await exec(["lsblk", "-J", "-o", LSBLK_COLUMNS.join(","), device], {
    allowFailure: true,
  });
  if (result.code !== 0) {
    throw new Error(`Failed to list partitions of ${device}: ${result.stderr.trim()}`);
  }
  return parseLsblkPartitions(result.stdout);
}

// ---- Disk preparation state (idempotency + partial recovery) -------------------

/** Expected btrfs subvolumes and their mount points inside the target root. */
export const BTRFS_SUBVOLUME_MOUNTS = [
  { subvolume: "@home", mountpoint: "/home" },
  { subvolume: "@snapshots", mountpoint: "/.snapshots" },
] as const;

/**
 * Whether the config expects the @/@home/@snapshots btrfs subvolume scheme.
 * For the keep layout the filesystem type comes from the selected partition.
 */
export function wantsBtrfsSubvolumes(config: InstallConfig): boolean {
  if (!config.disk.btrfsSubvolumes) return false;
  if (config.disk.layout === "keep") return config.disk.rootPartitionFstype === "btrfs";
  return config.disk.filesystem === "btrfs";
}

export type DiskPreparationState = "none" | "partial" | "ready";

/**
 * Pure decision on the disk state: "none" — the root is not mounted, "partial" —
 * the root is mounted but expected subvolumes are missing, "ready" — everything is
 * in place. The partial state must never be treated as "none": re-partitioning
 * would destroy the disk.
 */
export function diskPreparationStateFrom(
  rootMounted: boolean,
  subvolumesExpected: boolean,
  missingSubvolumes: readonly string[],
): DiskPreparationState {
  if (!rootMounted) return "none";
  if (!subvolumesExpected) return "ready";
  return missingSubvolumes.length === 0 ? "ready" : "partial";
}

/** Expected subvolumes that are not mounted inside the target root yet. */
export async function missingSubvolumeMounts(root = TARGET_ROOT): Promise<string[]> {
  const missing: string[] = [];
  for (const { subvolume, mountpoint } of BTRFS_SUBVOLUME_MOUNTS) {
    if (!(await isMounted(`${root}${mountpoint}`))) missing.push(subvolume);
  }
  return missing;
}

/**
 * Current state of disk preparation. The old check only looked at the root mount;
 * a partially prepared disk (root mounted, @home/@snapshots missing) was mistaken
 * for a ready one and the subvolumes were never restored.
 */
export async function diskPreparationState(config: InstallConfig): Promise<DiskPreparationState> {
  const partitions = await listPartitions(config.disk.device);
  const rootMounted = partitions.some((partition) => partition.mountpoints.includes(TARGET_ROOT));
  const expected = wantsBtrfsSubvolumes(config);
  const missing = expected ? await missingSubvolumeMounts() : [];
  return diskPreparationStateFrom(rootMounted, expected, missing);
}

/** The disk is fully prepared: the root and all expected subvolumes are mounted. */
export async function isDiskPrepared(config: InstallConfig): Promise<boolean> {
  return (await diskPreparationState(config)) === "ready";
}

/**
 * Strips the btrfs subvolume suffix from a findmnt SOURCE value:
 * `/dev/sda3[/@]` → `/dev/sda3`. Without this the recovery mount would get an
 * invalid source.
 */
export function deviceFromSource(source: string): string {
  return source.replace(/\[.*?\]\s*$/, "").trim();
}

/** Device currently mounted at the target root (`findmnt -o SOURCE`), or null. */
export async function mountedRootSource(root = TARGET_ROOT): Promise<string | null> {
  const result = await exec(["findmnt", "-n", "-o", "SOURCE", root], { allowFailure: true });
  if (result.code !== 0) return null;
  const source = deviceFromSource(result.stdout);
  return source || null;
}

/** Pure: mount commands for the given btrfs subvolumes from a source device. */
export function subvolumeMountCommands(
  source: string,
  subvolumes: readonly string[],
  root = TARGET_ROOT,
): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  for (const { subvolume, mountpoint } of BTRFS_SUBVOLUME_MOUNTS) {
    if (!subvolumes.includes(subvolume)) continue;
    const target = `${root}${mountpoint}`;
    commands.push({
      phase: "mount",
      description: `Create directory ${target}`,
      argv: ["mkdir", "-p", target],
    });
    commands.push({
      phase: "mount",
      description: `Mount ${subvolume} into ${target}`,
      argv: ["mount", "-o", `subvol=${subvolume},compress=zstd,noatime`, source, target],
    });
  }
  return commands;
}

/**
 * Checks that the expected btrfs subvolumes actually exist on the source device.
 * Returns the list of subvolumes that are missing from the filesystem.
 */
export async function missingSubvolumesOnDisk(
  device: string,
  expected: readonly string[],
): Promise<string[]> {
  const result = await exec(["btrfs", "subvolume", "list", "-q", device], { allowFailure: true });
  if (result.code !== 0) {
    // btrfs-progs not available or device is not btrfs — cannot verify.
    return [...expected];
  }
  // Each line starts with a numeric ID, then a dot, then the name.
  const existing = new Set<string>();
  const subvolLineRe = /^\d+\t\./;
  for (const line of result.stdout.split("\n")) {
    if (subvolLineRe.test(line)) {
      const name = line.split("\t")[1]?.trim();
      if (name) existing.add(name);
    }
  }
  return expected.filter((subvolume) => !existing.has(subvolume));
}

/**
 * Recovery of a partially prepared disk: mounts the expected @home/@snapshots
 * subvolumes if they are missing. Used instead of a full re-partition, which would
 * wipe data that is already on the disk.
 */
export async function recoverSubvolumeMounts(config: InstallConfig): Promise<PlannedCommand[]> {
  if (!wantsBtrfsSubvolumes(config)) return [];
  const missing = await missingSubvolumeMounts();
  if (missing.length === 0) return [];
  const source = await mountedRootSource();
  if (!source) return [];

  // Verify subvolumes exist on the filesystem before attempting to mount.
  const absent = await missingSubvolumesOnDisk(source, missing);
  if (absent.length > 0) {
    // Subvolumes are gone — recovery is impossible, return empty so the caller
    // can fall back to a destructive re-partition (which requires confirmation).
    return [];
  }

  return subvolumeMountCommands(source, missing);
}

/** Partitioning, formatting and mounting commands for a layout. */
export function layoutCommands(device: string, layout: PartitionLayout): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  const part = (number: number) => partitionPath(device, number);

  commands.push({
    phase: "partition",
    description: `Create ${layout.table === "gpt" ? "GPT" : "MBR"} partition table`,
    argv: ["parted", "-s", device, "mklabel", layout.table],
  });

  let startMiB = 1;
  for (const spec of layout.partitions) {
    const end = spec.sizeGiB !== undefined ? `${startMiB + spec.sizeGiB * 1024}MiB` : "100%";
    const mkpart =
      layout.table === "gpt"
        ? ["mkpart", KIND_LABEL[spec.kind], PARTED_FS[spec.filesystem], `${startMiB}MiB`, end]
        : ["mkpart", "primary", PARTED_FS[spec.filesystem], `${startMiB}MiB`, end];
    const sizeLabel = spec.sizeGiB !== undefined ? `${spec.sizeGiB} GiB` : "rest";
    commands.push({
      phase: "partition",
      description: `Partition ${spec.number}: ${KIND_LABEL[spec.kind]} (${sizeLabel})`,
      argv: ["parted", "-s", device, ...mkpart],
    });
    if (spec.bootFlag) {
      commands.push({
        phase: "partition",
        description: `Set ${spec.bootFlag} flag on partition ${spec.number}`,
        argv: ["parted", "-s", device, "set", `${spec.number}`, spec.bootFlag, "on"],
      });
    }
    if (spec.sizeGiB !== undefined) startMiB += spec.sizeGiB * 1024;
  }

  commands.push({
    phase: "partition",
    description: "Wait for devices to appear",
    argv: ["udevadm", "settle"],
  });

  for (const spec of layout.partitions) {
    const path = part(spec.number);
    if (spec.kind === "esp") {
      commands.push({
        phase: "format",
        description: `Format ESP (FAT32): ${path}`,
        argv: ["mkfs.fat", "-F32", path],
      });
    } else if (spec.kind === "root" && spec.filesystem === "btrfs") {
      commands.push({
        phase: "format",
        description: `Format root (btrfs): ${path}`,
        argv: ["mkfs.btrfs", "-f", path],
      });
    } else if (spec.kind === "root") {
      commands.push({
        phase: "format",
        description: `Format root (ext4): ${path}`,
        argv: ["mkfs.ext4", "-F", path],
      });
    } else {
      commands.push({
        phase: "format",
        description: `Set up swap: ${path}`,
        argv: ["mkswap", path],
      });
    }
  }

  const root = layout.partitions.find((spec) => spec.kind === "root");
  if (!root) throw new Error("Layout has no root partition");
  const rootPath = part(root.number);

  if (root.btrfsSubvolumes) {
    commands.push(
      {
        phase: "mount",
        description: "Mount btrfs to create subvolumes",
        argv: ["mount", "-o", "compress=zstd,noatime", rootPath, "/mnt"],
      },
      ...["@", "@home", "@snapshots"].map((subvolume) => ({
        phase: "mount" as const,
        description: `Create subvolume ${subvolume}`,
        argv: ["btrfs", "subvolume", "create", `/mnt/${subvolume}`],
      })),
      {
        phase: "mount",
        description: "Temporarily unmount",
        argv: ["umount", "/mnt"],
      },
      {
        phase: "mount",
        description: "Mount @ into /mnt",
        argv: ["mount", "-o", "subvol=@,compress=zstd,noatime", rootPath, "/mnt"],
      },
      {
        phase: "mount",
        description: "Create directory /mnt/home",
        argv: ["mkdir", "-p", "/mnt/home"],
      },
      {
        phase: "mount",
        description: "Mount @home into /mnt/home",
        argv: ["mount", "-o", "subvol=@home,compress=zstd,noatime", rootPath, "/mnt/home"],
      },
      {
        phase: "mount",
        description: "Create directory /mnt/.snapshots",
        argv: ["mkdir", "-p", "/mnt/.snapshots"],
      },
      {
        phase: "mount",
        description: "Mount @snapshots into /mnt/.snapshots",
        argv: [
          "mount",
          "-o",
          "subvol=@snapshots,compress=zstd,noatime",
          rootPath,
          "/mnt/.snapshots",
        ],
      },
    );
  } else if (root.filesystem === "btrfs") {
    commands.push({
      phase: "mount",
      description: "Mount root (btrfs) into /mnt",
      argv: ["mount", "-o", "compress=zstd,noatime", rootPath, "/mnt"],
    });
  } else {
    commands.push({
      phase: "mount",
      description: "Mount root (ext4) into /mnt",
      argv: ["mount", rootPath, "/mnt"],
    });
  }

  const esp = layout.partitions.find((spec) => spec.kind === "esp");
  if (esp) {
    commands.push(
      {
        phase: "mount",
        description: "Create directory /mnt/boot/efi",
        argv: ["mkdir", "-p", "/mnt/boot/efi"],
      },
      {
        phase: "mount",
        description: "Mount ESP into /mnt/boot/efi",
        argv: ["mount", part(esp.number), "/mnt/boot/efi"],
      },
    );
  }

  const swap = layout.partitions.find((spec) => spec.kind === "swap");
  if (swap) {
    commands.push({
      phase: "mount",
      description: "Enable swap",
      argv: ["swapon", part(swap.number)],
    });
  }

  return commands;
}

/** Mounting commands for existing partitions in the keep layout (no formatting). */
export function keepMountCommands(disk: DiskConfig): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  if (!disk.rootPartition) throw new Error("No root partition selected for the keep layout");

  const btrfsSubvol = disk.rootPartitionFstype === "btrfs" && disk.btrfsSubvolumes;
  const rootArgs = btrfsSubvol
    ? ["mount", "-o", "subvol=@", disk.rootPartition, "/mnt"]
    : ["mount", disk.rootPartition, "/mnt"];
  commands.push({
    phase: "mount",
    description: `Mount ${disk.rootPartition} into /mnt`,
    argv: rootArgs,
  });

  if (disk.espPartition) {
    commands.push(
      {
        phase: "mount",
        description: "Create directory /mnt/boot/efi",
        argv: ["mkdir", "-p", "/mnt/boot/efi"],
      },
      {
        phase: "mount",
        description: `Mount ESP ${disk.espPartition}`,
        argv: ["mount", disk.espPartition, "/mnt/boot/efi"],
      },
    );
  }

  if (disk.swap && disk.swapPartition) {
    commands.push({
      phase: "mount",
      description: `Enable swap ${disk.swapPartition}`,
      argv: ["swapon", disk.swapPartition],
    });
  }

  return commands;
}

/** Plan of disk preparation commands from the current config and firmware. */
export function planPartitionCommands(config: InstallConfig, firmware: Firmware): PlannedCommand[] {
  if (config.disk.layout === "keep") return keepMountCommands(config.disk);
  return layoutCommands(config.disk.device, buildPartitionLayout(config.disk, firmware));
}

// ---- Fail-fast tool preflight ------------------------------------------------

/** External binaries required by the partition/format phases of the plan. */
function planToolBinaries(commands: PlannedCommand[]): string[] {
  const tools = new Set<string>();
  for (const command of commands) {
    if (command.phase !== "partition" && command.phase !== "format") continue;
    const tool = command.argv[0];
    if (tool) tools.add(tool);
  }
  return [...tools];
}

/** Pure: plan tool binaries missing from the available set. */
export function missingPlanTools(
  commands: PlannedCommand[],
  available: readonly string[],
): string[] {
  return planToolBinaries(commands).filter((tool) => !available.includes(tool));
}

/**
 * Checks that the binaries needed by the partition/format phases exist.
 * A missing mkfs.* tool (e.g. mkfs.ext4 without e2fsprogs in the LiveCD) would
 * otherwise abort the installation right after the disk has been wiped — this
 * check must run BEFORE the destructive confirmation.
 */
export async function checkPlanTools(commands: PlannedCommand[]): Promise<string[]> {
  const tools = planToolBinaries(commands);
  const availability = await Promise.all(tools.map((tool) => hasCommand(tool)));
  return tools.filter((_, index) => !availability[index]);
}
