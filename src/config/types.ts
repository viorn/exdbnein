/** Configuration schema version. Changes on incompatible format edits. */
export const CONFIG_VERSION = 1;

export type Firmware = "uefi" | "bios";
export type Filesystem = "btrfs" | "ext4";
export type DiskLayout = "auto" | "manual" | "keep";

export interface DiskConfig {
  /** Device path, e.g. /dev/sda. */
  device: string;
  layout: DiskLayout;
  filesystem: Filesystem;
  /** Create a swap partition. */
  swap: boolean;
  /** Swap size in GiB (if swap is enabled). */
  swapSizeGiB: number;
  /** ESP size in GiB (auto/manual layouts, UEFI). */
  espSizeGiB: number;
  /** Create btrfs subvolumes (@, @home, @snapshots). */
  btrfsSubvolumes: boolean;
  /** keep: existing partition for /. */
  rootPartition?: string;
  /** keep: root partition FS — for subvol=@ with btrfs. */
  rootPartitionFstype?: string;
  /** keep: existing ESP partition (UEFI). */
  espPartition?: string;
  /** keep: existing swap partition. */
  swapPartition?: string;
}

export interface UserConfig {
  username: string;
  /** Plaintext password — memory only, never written to a file. */
  password?: string;
  /** Password hash (sha512-crypt) — what goes into the config. */
  passwordHash?: string;
  fullName?: string;
  /** Add to the sudo group. */
  sudo: boolean;
  /** Public SSH keys for ~/.ssh/authorized_keys. */
  sshKeys: string[];
}

export interface NetworkConfig {
  /** Network manager in the target system. */
  manager: "networkmanager" | "systemd-networkd" | "none";
  hostname: string;
}

export interface LocaleConfig {
  /** Locale, e.g. en_US.UTF-8. */
  locale: string;
  /** Console layout, e.g. us or us,ru. */
  keymap: string;
  /** Time zone, e.g. Europe/Moscow. */
  timezone: string;
}

export interface BootloaderConfig {
  /** Target system bootloader. */
  type: "grub";
  /** Install os-prober to detect other OSes. */
  osProber: boolean;
}

export interface InstallConfig {
  version: number;
  disk: DiskConfig;
  locale: LocaleConfig;
  network: NetworkConfig;
  /** Root password hash (sha512-crypt). */
  rootPasswordHash?: string;
  users: UserConfig[];
  /** Names of the selected profiles (see profiles/). */
  profiles: string[];
  bootloader: BootloaderConfig;
  /** Debian mirror for debootstrap/apt. */
  mirror: string;
  /** Run the installation without confirmations (unattended mode). */
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
      espSizeGiB: 1,
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
      // Disabled by default: slow and sensitive to EFI variables (P6.2).
      osProber: false,
    },
    mirror: "http://deb.debian.org/debian",
    unattended: false,
  };
}
