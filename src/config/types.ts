/** Версия схемы конфигурации. Меняется при несовместимых правках формата. */
export const CONFIG_VERSION = 1;

export type Firmware = "uefi" | "bios";
export type Filesystem = "btrfs" | "ext4";
export type DiskLayout = "auto" | "manual" | "keep";

export interface DiskConfig {
  /** Путь к устройству, например /dev/sda. */
  device: string;
  layout: DiskLayout;
  filesystem: Filesystem;
  /** Создавать swap-раздел. */
  swap: boolean;
  /** Размер swap в GiB (если swap включён). */
  swapSizeGiB: number;
  /** Создавать subvolumes btrfs (@, @home, @snapshots). */
  btrfsSubvolumes: boolean;
}

export interface UserConfig {
  username: string;
  /** Пароль в открытом виде — только в памяти, в файл не пишется. */
  password?: string;
  /** Хеш пароля (sha512-crypt) — то, что попадает в конфиг. */
  passwordHash?: string;
  fullName?: string;
  /** Добавить в группу sudo. */
  sudo: boolean;
  /** Публичные SSH-ключи для ~/.ssh/authorized_keys. */
  sshKeys: string[];
}

export interface NetworkConfig {
  /** Менеджер сети в целевой системе. */
  manager: "networkmanager" | "systemd-networkd" | "none";
  hostname: string;
}

export interface LocaleConfig {
  /** Локаль, например ru_RU.UTF-8. */
  locale: string;
  /** Раскладка консоли, например us,ru. */
  keymap: string;
  /** Часовой пояс, например Europe/Moscow. */
  timezone: string;
}

export interface BootloaderConfig {
  /** Загрузчик целевой системы. */
  type: "grub";
  /** Устанавливать os-prober для поиска других ОС. */
  osProber: boolean;
}

export interface InstallConfig {
  version: number;
  disk: DiskConfig;
  locale: LocaleConfig;
  network: NetworkConfig;
  /** Хеш пароля root (sha512-crypt). */
  rootPasswordHash?: string;
  users: UserConfig[];
  /** Имена выбранных профилей (см. profiles/). */
  profiles: string[];
  bootloader: BootloaderConfig;
  /** Зеркало Debian для debootstrap/apt. */
  mirror: string;
  /** Выполнять установку без подтверждений (авторежим). */
  unattended: boolean;
}

export function defaultConfig(): InstallConfig {
  return {
    version: CONFIG_VERSION,
    disk: {
      device: "",
      layout: "auto",
      filesystem: "btrfs",
      swap: true,
      swapSizeGiB: 4,
      btrfsSubvolumes: true,
    },
    locale: {
      locale: "en_US.UTF-8",
      keymap: "us",
      timezone: "UTC",
    },
    network: {
      manager: "networkmanager",
      hostname: "debian",
    },
    users: [],
    profiles: [],
    bootloader: {
      type: "grub",
      osProber: true,
    },
    mirror: "http://deb.debian.org/debian",
    unattended: false,
  };
}
