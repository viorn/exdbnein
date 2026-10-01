import type { DiskConfig, Filesystem, InstallConfig } from "../config/types.ts";
import type { Firmware } from "./environment.ts";
import { exec } from "./exec.ts";

/** Информация о диске из lsblk. */
export interface DiskInfo {
  /** Имя устройства, например sda. */
  name: string;
  /** Путь к устройству, например /dev/sda. */
  path: string;
  /** Размер в человекочитаемом виде, например 238.5G. */
  size: string;
  /** Тип устройства (disk/part/...). */
  type: string;
  /** Съёмный носитель. */
  removable: boolean;
  /** Транспорт: usb/sata/nvme/... */
  tran?: string;
  model?: string;
  /** Диск является носителем LiveCD (или системным диском текущей ОС). */
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

/** Разбирает вывод `lsblk -J` в список дисков (только type=disk). */
export function parseLsblkOutput(json: string): DiskInfo[] {
  const parsed = JSON.parse(json) as { blockdevices?: LsblkNode[] };
  return (parsed.blockdevices ?? []).filter((node) => node.type === "disk").map(toDiskInfo);
}

function toDiskInfo(node: LsblkNode): DiskInfo {
  return {
    name: node.name,
    path: node.path || `/dev/${node.name}`,
    size: node.size ?? "?",
    type: node.type ?? "disk",
    removable: node.rm === "1",
    tran: node.tran,
    model: node.model,
    isLiveMedium: hasLiveMountpoint(node),
  };
}

/**
 * Носитель LiveCD — диск, где примонтированы корень системы («/»),
 * live-разделы (/run/live*), CD (/cdrom) или съёмные медиа (/media/*).
 * Такие диски нельзя выбирать целью установки.
 */
function hasLiveMountpoint(node: LsblkNode): boolean {
  const mounts = collectMountpoints(node);
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

/** Возвращает путь к разделу index диска (суффикс p для NVMe/MMC и т.п.). */
export function partitionPath(diskPath: string, index: number): string {
  return /[0-9]$/.test(diskPath) ? `${diskPath}p${index}` : `${diskPath}${index}`;
}

/** Получает список дисков через `lsblk -J`. */
export async function listDisks(): Promise<DiskInfo[]> {
  const result = await exec(["lsblk", "-J", "-o", LSBLK_COLUMNS.join(",")], {
    allowFailure: true,
  });
  if (result.code !== 0) {
    throw new Error(`Не удалось получить список дисков: ${result.stderr.trim()}`);
  }
  return parseLsblkOutput(result.stdout);
}

// ---- Этап 4: разметка диска ------------------------------------------------

export type PartitionTable = "gpt" | "msdos";
export type PartitionKind = "esp" | "root" | "swap";
export type CommandPhase = "partition" | "format" | "mount";

/** Раздел в генерируемой раскладке (схемы auto/manual). */
export interface PartitionSpec {
  /** Номер раздела (1-based). */
  number: number;
  kind: PartitionKind;
  /** Размер в GiB; отсутствует — раздел занимает остаток диска. */
  sizeGiB?: number;
  filesystem: Filesystem | "fat32" | "swap";
  /** Точка монтирования в целевой системе. */
  mountpoint?: string;
  /** Флаг раздела (GPT: esp; MBR: boot). */
  bootFlag?: "esp" | "boot";
  /** Создавать subvolumes btrfs (@, @home, @snapshots). */
  btrfsSubvolumes?: boolean;
}

/** Раскладка разделов для схем auto/manual. */
export interface PartitionLayout {
  table: PartitionTable;
  partitions: PartitionSpec[];
}

/** Команда плана: показывается в dry-run и исполняется напрямую (без shell). */
export interface PlannedCommand {
  phase: CommandPhase;
  /** Человекочитаемое описание. */
  description: string;
  /** Аргументы команды. */
  argv: string[];
}

/** Информация о разделе диска из lsblk. */
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
 * Строит раскладку по схемам auto/manual: UEFI → GPT + ESP + root (+swap),
 * BIOS → MBR + root (+swap). Раздел root — последний, занимает остаток диска.
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

/** Разбирает вывод `lsblk -J <disk>` в список разделов диска. */
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

/** Получает разделы диска через `lsblk -J <device>`. */
export async function listPartitions(device: string): Promise<PartitionInfo[]> {
  const result = await exec(["lsblk", "-J", "-o", LSBLK_COLUMNS.join(","), device], {
    allowFailure: true,
  });
  if (result.code !== 0) {
    throw new Error(`Не удалось получить разделы диска ${device}: ${result.stderr.trim()}`);
  }
  return parseLsblkPartitions(result.stdout);
}

/** Диск уже подготовлен, если какой-то его раздел примонтирован в /mnt. */
export async function isDiskPrepared(device: string): Promise<boolean> {
  const partitions = await listPartitions(device);
  return partitions.some((partition) => partition.mountpoints.includes("/mnt"));
}

/** Команды разметки, форматирования и монтирования для раскладки. */
export function layoutCommands(device: string, layout: PartitionLayout): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  const part = (number: number) => partitionPath(device, number);

  commands.push({
    phase: "partition",
    description: `Создать таблицу разделов ${layout.table === "gpt" ? "GPT" : "MBR"}`,
    argv: ["parted", "-s", device, "mklabel", layout.table],
  });

  let startMiB = 1;
  for (const spec of layout.partitions) {
    const end = spec.sizeGiB !== undefined ? `${startMiB + spec.sizeGiB * 1024}MiB` : "100%";
    const mkpart =
      layout.table === "gpt"
        ? ["mkpart", KIND_LABEL[spec.kind], PARTED_FS[spec.filesystem], `${startMiB}MiB`, end]
        : ["mkpart", "primary", PARTED_FS[spec.filesystem], `${startMiB}MiB`, end];
    const sizeLabel = spec.sizeGiB !== undefined ? `${spec.sizeGiB} GiB` : "остаток";
    commands.push({
      phase: "partition",
      description: `Раздел ${spec.number}: ${KIND_LABEL[spec.kind]} (${sizeLabel})`,
      argv: ["parted", "-s", device, ...mkpart],
    });
    if (spec.bootFlag) {
      commands.push({
        phase: "partition",
        description: `Установить флаг ${spec.bootFlag} на раздел ${spec.number}`,
        argv: ["parted", "-s", device, "set", `${spec.number}`, spec.bootFlag, "on"],
      });
    }
    if (spec.sizeGiB !== undefined) startMiB += spec.sizeGiB * 1024;
  }

  commands.push({
    phase: "partition",
    description: "Дождаться появления устройств",
    argv: ["udevadm", "settle"],
  });

  for (const spec of layout.partitions) {
    const path = part(spec.number);
    if (spec.kind === "esp") {
      commands.push({
        phase: "format",
        description: `Форматировать ESP (FAT32): ${path}`,
        argv: ["mkfs.fat", "-F32", path],
      });
    } else if (spec.kind === "root" && spec.filesystem === "btrfs") {
      commands.push({
        phase: "format",
        description: `Форматировать root (btrfs): ${path}`,
        argv: ["mkfs.btrfs", "-f", path],
      });
    } else if (spec.kind === "root") {
      commands.push({
        phase: "format",
        description: `Форматировать root (ext4): ${path}`,
        argv: ["mkfs.ext4", "-F", path],
      });
    } else {
      commands.push({
        phase: "format",
        description: `Подготовить swap: ${path}`,
        argv: ["mkswap", path],
      });
    }
  }

  const root = layout.partitions.find((spec) => spec.kind === "root");
  if (!root) throw new Error("В раскладке нет раздела root");
  const rootPath = part(root.number);

  if (root.btrfsSubvolumes) {
    commands.push(
      {
        phase: "mount",
        description: "Примонтировать btrfs для создания subvolumes",
        argv: ["mount", "-o", "compress=zstd,noatime", rootPath, "/mnt"],
      },
      ...["@", "@home", "@snapshots"].map((subvolume) => ({
        phase: "mount" as const,
        description: `Создать subvolume ${subvolume}`,
        argv: ["btrfs", "subvolume", "create", `/mnt/${subvolume}`],
      })),
      {
        phase: "mount",
        description: "Временно отмонтировать",
        argv: ["umount", "/mnt"],
      },
      {
        phase: "mount",
        description: "Примонтировать @ в /mnt",
        argv: ["mount", "-o", "subvol=@,compress=zstd,noatime", rootPath, "/mnt"],
      },
      {
        phase: "mount",
        description: "Создать каталог /mnt/home",
        argv: ["mkdir", "-p", "/mnt/home"],
      },
      {
        phase: "mount",
        description: "Примонтировать @home в /mnt/home",
        argv: ["mount", "-o", "subvol=@home,compress=zstd,noatime", rootPath, "/mnt/home"],
      },
      {
        phase: "mount",
        description: "Создать каталог /mnt/.snapshots",
        argv: ["mkdir", "-p", "/mnt/.snapshots"],
      },
      {
        phase: "mount",
        description: "Примонтировать @snapshots в /mnt/.snapshots",
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
      description: "Примонтировать root (btrfs) в /mnt",
      argv: ["mount", "-o", "compress=zstd,noatime", rootPath, "/mnt"],
    });
  } else {
    commands.push({
      phase: "mount",
      description: "Примонтировать root (ext4) в /mnt",
      argv: ["mount", rootPath, "/mnt"],
    });
  }

  const esp = layout.partitions.find((spec) => spec.kind === "esp");
  if (esp) {
    commands.push(
      {
        phase: "mount",
        description: "Создать каталог /mnt/boot/efi",
        argv: ["mkdir", "-p", "/mnt/boot/efi"],
      },
      {
        phase: "mount",
        description: "Примонтировать ESP в /mnt/boot/efi",
        argv: ["mount", part(esp.number), "/mnt/boot/efi"],
      },
    );
  }

  const swap = layout.partitions.find((spec) => spec.kind === "swap");
  if (swap) {
    commands.push({
      phase: "mount",
      description: "Активировать swap",
      argv: ["swapon", part(swap.number)],
    });
  }

  return commands;
}

/** Команды монтирования существующих разделов для схемы keep (без форматирования). */
export function keepMountCommands(disk: DiskConfig): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  if (!disk.rootPartition) throw new Error("Для схемы keep не выбран раздел root");

  const btrfsSubvol = disk.rootPartitionFstype === "btrfs" && disk.btrfsSubvolumes;
  const rootArgs = btrfsSubvol
    ? ["mount", "-o", "subvol=@", disk.rootPartition, "/mnt"]
    : ["mount", disk.rootPartition, "/mnt"];
  commands.push({
    phase: "mount",
    description: `Примонтировать ${disk.rootPartition} в /mnt`,
    argv: rootArgs,
  });

  if (disk.espPartition) {
    commands.push(
      {
        phase: "mount",
        description: "Создать каталог /mnt/boot/efi",
        argv: ["mkdir", "-p", "/mnt/boot/efi"],
      },
      {
        phase: "mount",
        description: `Примонтировать ESP ${disk.espPartition}`,
        argv: ["mount", disk.espPartition, "/mnt/boot/efi"],
      },
    );
  }

  if (disk.swap && disk.swapPartition) {
    commands.push({
      phase: "mount",
      description: `Активировать swap ${disk.swapPartition}`,
      argv: ["swapon", disk.swapPartition],
    });
  }

  return commands;
}

/** План команд подготовки диска по текущему конфигу и прошивке. */
export function planPartitionCommands(config: InstallConfig, firmware: Firmware): PlannedCommand[] {
  if (config.disk.layout === "keep") return keepMountCommands(config.disk);
  return layoutCommands(config.disk.device, buildPartitionLayout(config.disk, firmware));
}
