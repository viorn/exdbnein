import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/config/types.ts";
import {
  authorizedKeysContent,
  createHomeCommand,
  debconfPresetsContent,
  defaultLocaleContent,
  grubDefaultsContent,
  grubInstallCommand,
  grubPackage,
  hostnameFileContent,
  hostsFileContent,
  keyboardContent,
  localeGenContent,
  networkdDhcpContent,
  systemPackages,
  timezonePath,
  tzdataAreaZone,
  useraddCommand,
} from "../src/system/configure.ts";

describe("hostname", () => {
  test("hostnameFileContent — имя с переводом строки", () => {
    expect(hostnameFileContent("debian")).toBe("debian\n");
  });

  test("hostsFileContent содержит localhost и 127.0.1.1 для hostname", () => {
    const hosts = hostsFileContent("myhost");
    expect(hosts).toContain("127.0.0.1\tlocalhost");
    expect(hosts).toContain("127.0.1.1\tmyhost");
    expect(hosts).toContain("::1\t\tlocalhost ip6-localhost ip6-loopback");
  });
});

describe("debconf-пресеты (P6.1)", () => {
  test("tzdataAreaZone разбивает область и зону", () => {
    expect(tzdataAreaZone("Europe/Moscow")).toEqual(["Europe", "Moscow"]);
    expect(tzdataAreaZone("America/New_York")).toEqual(["America", "New_York"]);
  });

  test("UTC без слеша попадает в область Etc", () => {
    expect(tzdataAreaZone("UTC")).toEqual(["Etc", "UTC"]);
  });

  test("пресеты покрывают locales/keyboard/console-setup/tzdata", () => {
    const config = defaultConfig();
    config.locale.locale = "ru_RU.UTF-8";
    config.locale.keymap = "us,ru";
    config.locale.timezone = "Europe/Moscow";
    const presets = debconfPresetsContent(config, "uefi");

    expect(presets).toContain(
      "locales locales/locales_to_be_generated multiselect ru_RU.UTF-8 UTF-8",
    );
    expect(presets).toContain("locales locales/default_environment_locale select ru_RU.UTF-8");
    expect(presets).toContain(
      "keyboard-configuration keyboard-configuration/xkb-keymap select us,ru",
    );
    expect(presets).toContain("console-setup console-setup/layoutcode string us,ru");
    expect(presets).toContain("tzdata tzdata/Areas select Europe");
    expect(presets).toContain("tzdata tzdata/Zones/Europe select Moscow");
  });

  test("BIOS добавляет grub-pc install_devices, UEFI — нет", () => {
    const config = defaultConfig();
    config.disk.device = "/dev/sda";
    const bios = debconfPresetsContent(config, "bios");
    expect(bios).toContain("grub-pc grub-pc/install_devices multiselect /dev/sda");
    expect(bios).toContain("grub-pc grub-pc/install_devices_empty boolean false");

    const uefi = debconfPresetsContent(config, "uefi");
    expect(uefi).not.toContain("grub-pc");
  });
});

describe("локаль", () => {
  test("localeGenContent добавляет выбранную локаль UTF-8", () => {
    expect(localeGenContent("ru_RU.UTF-8")).toContain("ru_RU.UTF-8 UTF-8");
  });

  test("defaultLocaleContent задаёт LANG", () => {
    expect(defaultLocaleContent("ru_RU.UTF-8")).toBe("LANG=ru_RU.UTF-8\n");
  });
});

describe("раскладка и часовой пояс", () => {
  test("keyboardContent содержит XKBLAYOUT и переключение", () => {
    const content = keyboardContent("us,ru");
    expect(content).toContain('XKBLAYOUT="us,ru"');
    expect(content).toContain('XKBOPTIONS="grp:alt_shift_toggle');
  });

  test("timezonePath — путь в zoneinfo", () => {
    expect(timezonePath("Europe/Moscow")).toBe("/usr/share/zoneinfo/Europe/Moscow");
  });
});

describe("пользователи (P6.3)", () => {
  test("useraddCommand: home, bash, хеш, sudo-группа и полное имя", () => {
    const command = useraddCommand({
      username: "ivan",
      passwordHash: "$6$salt$hash",
      sudo: true,
      fullName: "Ivan Petrov",
      sshKeys: [],
    });
    expect(command).toEqual([
      "chroot",
      "/mnt",
      "useradd",
      "-m",
      "-s",
      "/bin/bash",
      "-G",
      "sudo",
      "-c",
      "Ivan Petrov",
      "-p",
      "$6$salt$hash",
      "ivan",
    ]);
  });

  test("без sudo и полного имени флаги не добавляются", () => {
    const command = useraddCommand({
      username: "guest",
      passwordHash: "$6$x$y",
      sudo: false,
      sshKeys: [],
    });
    expect(command).not.toContain("-G");
    expect(command).not.toContain("-c");
  });

  test("authorizedKeysContent — по ключу на строку", () => {
    expect(authorizedKeysContent([" ssh-ed25519 AAA ", "ssh-ed25519 BBB"])).toBe(
      "ssh-ed25519 AAA\nssh-ed25519 BBB\n",
    );
    expect(authorizedKeysContent([])).toBe("\n");
  });

  test("createHomeCommand: home из /etc/skel в chroot с владельцем-пользователем", () => {
    const command = createHomeCommand({
      username: "ivan",
      passwordHash: "$6$x$y",
      sudo: true,
      sshKeys: [],
    });
    expect(command.slice(0, 3)).toEqual(["chroot", "/mnt", "sh"]);
    expect(command).toContain("-c");
    const script = command[command.length - 1] ?? "";
    expect(script).toContain("mkdir -p /home/ivan");
    expect(script).toContain("chmod 700 /home/ivan");
    expect(script).toContain("chown ivan: /home/ivan");
    expect(script).toContain("cp -a /etc/skel/. /home/ivan/");
    expect(script).toContain("chown -R ivan: /home/ivan");
  });
});

describe("сеть", () => {
  test("networkdDhcpContent включает DHCP для проводных интерфейсов", () => {
    const content = networkdDhcpContent();
    expect(content).toContain("[Match]");
    expect(content).toContain("Name=en* eth*");
    expect(content).toContain("DHCP=ipv4");
  });
});

describe("загрузчик", () => {
  test("grubPackage зависит от прошивки", () => {
    expect(grubPackage("bios")).toBe("grub-pc");
    expect(grubPackage("uefi")).toBe("grub-efi-amd64");
  });

  test("systemPackages: общие + сеть + загрузчик + os-prober", () => {
    const config = defaultConfig();
    config.network.manager = "networkmanager";
    config.bootloader.osProber = true;

    const packages = systemPackages(config, "bios");
    for (const pkg of ["locales", "console-setup", "keyboard-configuration", "tzdata", "sudo"]) {
      expect(packages).toContain(pkg);
    }
    expect(packages).toContain("openssh-server");
    expect(packages).toContain("network-manager");
    expect(packages).toContain("grub-pc");
    expect(packages).toContain("os-prober");
  });

  test("systemPackages: uefi — grub-efi-amd64; none — без менеджера; os-prober выключен", () => {
    const config = defaultConfig();
    config.network.manager = "none";
    const packages = systemPackages(config, "uefi");
    expect(packages).toContain("grub-efi-amd64");
    expect(packages).not.toContain("network-manager");
    expect(packages).not.toContain("os-prober");
  });

  test("os-prober по умолчанию выключен в конфиге (P6.2)", () => {
    expect(defaultConfig().bootloader.osProber).toBe(false);
  });

  test("grubDefaultsContent: GRUB_DISABLE_OS_PROBER отражает конфиг", () => {
    expect(grubDefaultsContent(false)).toContain("GRUB_DISABLE_OS_PROBER=true");
    expect(grubDefaultsContent(true)).toContain("GRUB_DISABLE_OS_PROBER=false");
  });

  test("grubInstallCommand: BIOS — устройство, i386-pc", () => {
    expect(grubInstallCommand("bios", "/dev/sda")).toEqual([
      "chroot",
      "/mnt",
      "grub-install",
      "--target=i386-pc",
      "/dev/sda",
    ]);
  });

  test("grubInstallCommand: UEFI — efi-directory и bootloader-id", () => {
    const command = grubInstallCommand("uefi", "/dev/nvme0n1");
    expect(command).toContain("grub-install");
    expect(command).toContain("--target=x86_64-efi");
    expect(command).toContain("--efi-directory=/boot/efi");
    expect(command).toContain("--bootloader-id=exdbnein");
    // Устройство UEFI-ветке не передаётся.
    expect(command).not.toContain("/dev/nvme0n1");
  });
});
