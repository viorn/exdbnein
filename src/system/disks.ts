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
  mountpoints?: (string | null)[];
  children?: LsblkNode[];
}

const LSBLK_COLUMNS = ["NAME", "PATH", "SIZE", "TYPE", "RM", "TRAN", "MODEL", "MOUNTPOINTS"];

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
