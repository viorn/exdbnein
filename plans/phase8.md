# Этап 8 — Сборка LiveCD

Статус: ✅ завершён.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 8».

## Цель

Собрать загрузочный ISO с установщиком: live-система Debian, скомпилированный бинарь exdbnein,
инструменты разметки, автозапуск установщика на tty1 и маркер LiveCD.

## Задачи

- [x] `livecd/build.sh`: сборка live-системы (debootstrap) + установка установщика
- [x] Упаковка установщика: `bun build --compile` (без зависимости от bun в Live)
- [x] Доставка YAML-профилей: инлайн в TS-модули (P8.1)
- [x] squashfs + initramfs + загрузчик (GRUB, гибридный ISO BIOS+UEFI)
- [x] Автозапуск установщика на tty1 (systemd-юнит), live-пользователь, сеть из коробки
- [x] Маркер LiveCD `/etc/exdbnein-live` (P8.2)
- [x] Сборка ISO через `grub-mkrescue` (xorriso)

## Принятые решения

- **Автозапуск:** override `getty@tty1.service.d` — вместо agetty/login на tty1 запускается
  установщик; отладка — на tty2 (`getty@tty2.service`, пользователь `live`/`live`, sudo без пароля).
- **Маркер LiveCD:** `/etc/exdbnein-live` создаётся в live-root на этапе сборки;
  его проверяет этап 3 ([`src/system/environment.ts`](../src/system/environment.ts)).
- **Профили (P8.1):** данные компилируются в TS-модуль
  [`src/profiles/embedded-data.generated.ts`](../src/profiles/embedded-data.generated.ts)
  и попадают в бинарь (`bun build --compile`). Загрузчик
  [`loadProfilesOrDefault`](../src/profiles/embedded.ts) берёт YAML-каталог, если он доступен,
  иначе — встроенные профили. YAML также кладутся в ISO рядом с бинарём для отладки.

## Реализация

### Скрипт сборки ([`livecd/build.sh`](../livecd/build.sh))

| Стадия | Что делает |
|---|---|
| preflight | root, amd64, инструменты хоста (debootstrap, squashfs-tools, xorriso, grub-pc-bin, grub-efi-amd64-bin, mtools, bun), `debian-archive-keyring` |
| 1. compile | `bun run embed:profiles` + `bun build --compile --minify ./src/index.ts` |
| 2. debootstrap | live-root (minbase + пакеты из [`livecd/packages.txt`](../livecd/packages.txt)) |
| 3. customize | маркер, `/opt/exdbnein/{exdbnein,profiles}`, overlay, live-пользователь, NetworkManager/resolved/getty@tty2, `update-initramfs -u -k all` |
| 4. squashfs | `mksquashfs … -comp zstd` |
| 5. boot files | vmlinuz/initrd.img → `/live/`, grub.cfg → `/boot/grub/` |
| 6. iso | `grub-mkrescue` (гибрид BIOS+UEFI, volid `EXDBNEIN_LIVE`) |

Параметры через окружение (все опциональны): `SUITE`, `MIRROR`, `COMPONENTS`, `WORK`, `OUT`,
`ISO_NAME`, `VOLID`, `KEEP_WORK`, `SOURCE_DATE_EPOCH` (воспроизводимость — читается
grub-mkrescue). Пакеты live-системы — [`livecd/packages.txt`](../livecd/packages.txt): ядро
и live-boot, инструменты установщика (parted, btrfs-progs, dosfstools, debootstrap,
debian-archive-keyring — P5.1), сеть (NetworkManager + nmtui, wpasupplicant, iw, rfkill,
systemd-resolved, curl, ca-certificates), WiFi-прошивки (`firmware-iwlwifi`, `firmware-realtek`,
`firmware-atheros`, `firmware-brcm80211`, `firmware-misc-nonfree`, `wireless-regdb` — компонент
`non-free-firmware`), отладка (sudo, vim-tiny), локали.

### Профили в бинаре (P8.1)

- Генератор [`scripts/embed-profiles.ts`](../scripts/embed-profiles.ts): `profiles/*.yaml` →
  [`src/profiles/embedded-data.generated.ts`](../src/profiles/embedded-data.generated.ts)
  (`bun run embed:profiles`, выполняется внутри `build.sh` до компиляции).
- Рантайм: [`loadProfilesOrDefault`](../src/profiles/embedded.ts) — каталог YAML, если есть,
  иначе встроенные данные; используется шагом визарда (`src/steps/profiles.ts`) и
  пост-установкой (`src/install/postinstall.ts`).
- Согласованность данных проверяется тестом `tests/embedded.test.ts` и CI-шагом
  (`git diff --exit-code` после перегенерации).

### Автозапуск и сеть (P8.3)

- [`getty@tty1.service.d/exdbnein.conf`](../livecd/rootfs/etc/systemd/system/getty@tty1.service.d/exdbnein.conf):
  `ExecStart=-/opt/exdbnein/exdbnein` на tty1, `LANG=C.UTF-8` (корректный UTF-8 для TUI).
- Сеть из коробки — **NetworkManager** (проводные DHCP + WiFi через `nmtui`): включается
  вместе с `systemd-resolved`, `/etc/resolv.conf` → stub systemd-resolved. Для WiFi —
  `wpasupplicant`, `iw`, `rfkill` и максимальный набор прошивок (`firmware-*`, `wireless-regdb`),
  ставимых из компонента `non-free-firmware`.
- live-пользователь `live` (пароль `live`) для отладки на tty2, sudo без пароля.

## Риски

- P8.1 🟡 `bun build --compile` не упаковывает YAML-ассеты — решено инлайном в TS-модуль;
  YAML рядом с бинарём оставлен для отладки. Проверено: маркеры профилей присутствуют
  в скомпилированном бинаре, fallback покрыт тестами.
- P8.2 🟡 Маркер `/etc/exdbnein-live` создаётся здесь же — согласован с этапом 3.
- P8.3 🔵 Кастомный init не понадобился: live-boot + systemd-юнит автозапуска.

## Критерии готовности

- [x] ISO собирается скриптом (`livecd/build.sh`); гибрид BIOS+UEFI через grub-mkrescue.
      Загрузка в QEMU (BIOS и UEFI) и автозапуск на tty1 проверяются на этапе 9
      (`scripts/qemu-test.sh`).
- [x] Бинарь установщика автономен: профили встроены (grep по бинарю + юнит-тесты),
      запуск из произвольного CWD не требует ассетов рядом.
- [x] Сборка воспроизводима с хоста без Live: список пакетов сборщика зафиксирован
      в preflight и шапке `build.sh`.