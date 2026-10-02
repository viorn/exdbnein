# exdbnein — консольный установщик Debian

Интерактивный TUI-установщик Debian (аналог `archinstall`) на `Bun + TypeScript`.
Поставляется внутри собственного LiveCD; репозиторий содержит и сам установщик,
и скрипты сборки образа.

- **Архитектура:** только `amd64`.
- **Файловые системы:** `btrfs` (subvolumes `@`, `@home`, `@snapshots`, `compress=zstd,noatime`) и `ext4`.
- **Разметка по прошивке:** BIOS → MBR, UEFI → GPT + ESP.
- **Загрузчик:** GRUB (BIOS `i386-pc`, UEFI `x86_64-efi` + fallback `EFI/BOOT/BOOTX64.EFI`).
- **Профили:** YAML с наследованием (`extends`): `base`, `server`, `desktop`, `dev`.
- **Два режима:** интерактивный визард и полностью автоматическая установка
  по JSON-конфигу (`--config … --unattended`).

## Возможности

| Область | Что умеет |
|---|---|
| Диск | `auto` (полный wipe), `manual` (свои размеры ESP/swap), `keep` (без стирания); dry-run план команд перед выполнением |
| Система | `debootstrap` (minbase, stable), ядро `linux-image-amd64`, `fstab` по UUID |
| Настройка | locale, keymap, timezone, пользователи + sudo, SSH-ключи, NetworkManager / systemd-networkd, GRUB |
| Профили | пакеты, сервисы, файлы, команды; идемпотентность через `/var/lib/exdbnein/applied.json` |
| Безопасность | отказ без root / вне LiveCD (маркер `/etc/exdbnein-live`), защита от выбора LiveCD-носителя |
| Автоматизация | `--unattended` + полный JSON-конфиг; QEMU-прогоны BIOS/UEFI (`scripts/qemu-test.sh`) |

## Структура репозитория

```
exdbnein/
├── src/                 # установщик
│   ├── index.ts         # точка входа (визард → применение)
│   ├── cli.ts           # аргументы: -c/--config, -p/--profiles-dir, -y/--unattended, -f/--force
│   ├── steps/           # шаги визарда (фаза A — только конфигурация)
│   ├── install/         # apply-раннер (фаза B — системные операции)
│   ├── system/          # обёртки над parted/mkfs/debootstrap/apt/chroot/GRUB
│   ├── config/          # InstallConfig, валидация, save/load JSON
│   ├── profiles/        # загрузка/резолв YAML-профилей (extends)
│   └── ui/              # хелперы поверх @clack/prompts
├── profiles/            # YAML-профили (base, server, desktop, dev)
├── livecd/              # сборка LiveCD: build.sh, packages.txt, overlay rootfs, grub.cfg
├── scripts/             # qemu-test.sh (QEMU e2e), embed-profiles.ts
├── plans/               # план проекта и детали этапов (phase0–phase9)
└── tests/               # bun test
```

## Требования

Для разработки:

- [Bun](https://bun.sh) 1.4+;
- для ISO-сборки и QEMU-тестов — Linux x86_64, root/sudo и пакеты хоста:
  `debootstrap`, `squashfs-tools`, `xorriso`, `grub-pc-bin`, `grub-efi-amd64-bin`,
  `mtools`, `debian-archive-keyring`, а для тестов ещё `qemu-system-x86` и `ovmf`.

## Быстрый старт

```bash
bun install          # зависимости
bun run dev          # визард в режиме разработки (вне LiveCD нужен --force)
bun run check        # typecheck + lint + тесты
bun run test         # только тесты
```

Запуск установщика вне LiveCD (для разработки):

```bash
sudo -E bun run start -- --force
```

## Сборка LiveCD

```bash
sudo bash livecd/build.sh
# результат: out/exdbnein-stable.iso (гибридный BIOS+UEFI)
```

Параметры сборки — переменные окружения:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `SUITE` | `stable` | дистрибутив для debootstrap |
| `MIRROR` | `http://deb.debian.org/debian` | зеркало |
| `COMPONENTS` | `main,contrib,non-free-firmware` | компоненты (WiFi-прошивки — в non-free-firmware) |
| `ISO_NAME` | `exdbnein-stable.iso` | имя образа |
| `VOLID` | `EXDBNEIN_LIVE` | метка тома |
| `KEEP_WORK` | `0` | не пересобирать live-root (ускоряет итерации) |
| `AUTOTEST` | `0` | `1` — добавить в cmdline ядра `exdbnein.config=auto` (QEMU-автоматизация) |

Внутри LiveCD установщик автозапускается на tty1 (override `getty@tty1`);
отладка — на tty2 (пользователь `live`/`live`, passwordless sudo) и на
последовательном порту (`console=ttyS0,115200`, serial-getty).

## Запуск установщика

### Интерактивно (в LiveCD)

1. Загрузитесь с ISO в BIOS или UEFI.
2. Установщик стартует сам: выберите диск, локаль, сеть, пользователей и профили.
3. На шаге ревью показывается план; подтвердите — дальше идёт применение
   (разметка, debootstrap, настройка, профили) с dry-run планами перед
   деструктивными шагами.

### Автоматически (`--unattended`)

Полный конфиг сохраняется визардом (`-c config.json`) или пишется вручную —
пример: [`scripts/qemu/unattended.json`](scripts/qemu/unattended.json).

```bash
exdbnein -c /path/to/config.json -y
# или: exdbnein --config /path/to/config.json --unattended
```

Особенности:

- в `--unattended` все шаги визарда пропускаются (хук `Step.skip`), шаг ревью
  проверяет конфиг и подтверждает установку автоматически;
- неполный конфиг — ошибка со списком проблем валидации;
- после установки система **не** перезагружается сама (для CI/скриптов);
- пароли хранятся только в виде sha512-crypt хешей (`passwordHash`), в файл
  конфига открытые пароли не пишутся (`redact`).

## QEMU-тестирование (этап 9)

`scripts/qemu-test.sh` прогоняет полный цикл: ISO → установка в QEMU →
перезагрузка → вход по SSH → проверка системы (hostname, btrfs subvolumes,
SSH-сервис, лог установки) → корректное завершение.

```bash
scripts/qemu-test.sh                     # BIOS + UEFI
scripts/qemu-test.sh --firmware uefi     # только UEFI
scripts/qemu-test.sh --iso out/exdbnein-autotest.iso
scripts/qemu-test.sh --skip-build        # не собирать ISO
scripts/qemu-test.sh --timeout 3600      # таймаут фазы установки, сек
scripts/qemu-test.sh --keep-vm           # оставить QEMU живым при провале
```

Как это работает:

1. Если ISO нет — собирается с `AUTOTEST=1` (нужен root, скрипт перезапустит себя
   через `sudo`).
2. Генерируется эфемерный SSH-ключ; его публичная часть подставляется в конфиг
   (плейсхолдер `@@PUBKEY@@` в [`scripts/qemu/unattended.json`](scripts/qemu/unattended.json)).
3. Создаётся seed-диск (FAT, метка `EXDBNEINCFG`) с конфигом.
4. QEMU загружает ISO; авторежим (`exdbnein.config=auto` в cmdline) монтирует
   seed-диск и запускает `exdbnein --config … --unattended`; результат
   (`RESULT=OK|FAIL`) пишется на ttyS0 (`-serial stdio`).
5. После успешной установки VM выключается, тест загружает систему с целевого
   диска и проверяет SSH (`localhost:2222`).

Логи и артефакты — в `out/qemu/<bios|uefi>/`.

## Тесты и CI

- `bun run check` — typecheck + lint + тесты (129+ тестов: lsblk, fstab, профили,
  имена разделов, валидация конфига, стадии установки и др.).
- PR-проверки (`.github/workflows/ci.yml`): typecheck, lint, test,
  актуальность встроенных профилей.
- QEMU-прогоны (`.github/workflows/qemu-nightly.yml`): ночной job (и
  `workflow_dispatch`) — BIOS + UEFI, не блокирует ревью.

## Документация плана

- [`plans/plan.md`](plans/plan.md) — решения, принципы, статус этапов.
- [`plans/phase0.md`…`plans/phase9.md`](plans/) — детали этапов.
