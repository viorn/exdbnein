# exdbnein — консольный установщик Debian

Аналог `archinstall` для Debian: интерактивный TUI-установщик на `bun + TypeScript + @clack/prompts`,
поставляемый внутри собственного LiveCD. Репозиторий содержит и сам установщик, и скрипты сборки LiveCD.

## Зафиксированные решения

- **Архитектура:** только `amd64`.
- **Файловые системы:** приоритет — `btrfs` (в т.ч. subvolumes и снапшоты), плюс `ext4` как базовый вариант.
- **LUKS/LVM:** отложены на пост-MVP.
- **Сборка LiveCD:** свой `livecd/build.sh` (debootstrap + squashfs + xorriso/grub-mkrescue),
  без обёртки над `live-build` — нужен контроль над автозапуском и содержимым.
- **Профили:** YAML, наследование через `extends`; `commands` — произвольный shell; без условий/переменных.

## Принципы

- **MVP по шагам.** Каждый этап заканчивается работоспособным состоянием и проверяется в QEMU.
- **Идемпотентность и dry-run.** Любой деструктивный шаг сначала показывается пользователю как план команд.
- **Безопасность.** Установщик отказывается работать, если не root, не в LiveCD, или если целевой диск — носитель LiveCD.
- **Тонкая обёртка над системой.** Вся работа с дисками/пакетами — через модуль `system/`, который вызывает
  `parted`, `mkfs.*`, `debootstrap`, `apt`, `chroot` и т.п. Логика TUI не знает про shell.
- **Конфиг как данные.** Вся установка описывается сериализуемым `InstallConfig` (JSON) — можно сохранить,
  загрузить, прогнать в автоматическом режиме.

## Структура репозитория (целевая)

```
exdbnein/
├── src/                 # установщик
│   ├── index.ts         # точка входа, сборка флоу из шагов
│   ├── steps/           # шаги визарда (диск, сеть, пользователи, ...)
│   ├── system/          # обёртки над parted/mkfs/debootstrap/apt/chroot
│   ├── config/          # типы InstallConfig, валидация, save/load
│   ├── profiles/        # загрузка/резолв YAML-профилей (наследование)
│   ├── ui/              # хелперы поверх @clack/prompts
│   └── utils/
├── profiles/            # встроенные YAML-профили (base, desktop, server, ...)
├── livecd/              # сборка LiveCD
│   ├── build.sh         # оркестратор сборки ISO
│   ├── chroot/          # файлы, копируемые в Live-систему
│   └── boot/            # grub/isolinux, конфиги загрузки
├── tests/               # bun test
├── plan.md
└── package.json
```

## MVP этапы

### Этап 0 — Каркас проекта
- [x] `bun init`, TypeScript strict, `@clack/prompts`
- [x] Скрипты `start` / `dev` / `test` / `typecheck`
- [x] Линтер + форматтер (Biome) и скрипты `lint` / `lint:fix` / `format` / `check`
- [x] Структура каталогов `src/{steps,system,config,profiles,ui,utils}`, `profiles/`, `tests/`
- [x] Модуль `system/exec.ts` (обёртка над spawn) + тесты
- [x] CI-заготовка (typecheck + lint + test)

### Этап 1 — Ядро TUI и модель конфигурации
- [x] Тип `InstallConfig` (диск, разметка, locale, timezone, hostname, пользователи, пакеты, загрузчик)
- [x] Каркас визарда: список шагов, отмена (Ctrl+C) с корректным выходом
- [x] Хелперы `ui/`: обёртки `text/password/select/multiselect/confirm` с обработкой `isCancel`
- [x] Сохранение/загрузка конфига в JSON, режим `--config <file>`
- [x] Итоговый экран-ревью: показать план установки перед применением
- [x] Хеширование паролей (sha512-crypt через `openssl passwd -6 -stdin`)
- [x] CLI: `--config`, `--profiles-dir`, `--unattended`, `--help`
- [ ] Навигация «назад» между шагами (сейчас только вперёд)
- [ ] Авторежим `--unattended`: пропуск вопросов при полном конфиге

### Этап 2 — Профили и наборы пакетов
- [ ] Формат YAML-профиля: `packages`, `services`, `commands`, `files`, `extends`
- [ ] Загрузка профилей из `profiles/` (встроенные) и из внешнего каталога (`--profiles-dir`)
- [ ] Резолв наследования `extends` (цепочки, слияние, защита от циклов)
- [ ] Валидация профиля (схема, неизвестные поля, конфликты)
- [ ] Выбор профилей в визарде (мультивыбор), предпросмотр итогового набора пакетов/команд
- [ ] Встроенные профили: `base`, `server`, `desktop`, `dev`

### Этап 3 — Определение окружения
- [ ] Проверки: root, наличие LiveCD-маркера, доступность нужных утилит
- [ ] Определение прошивки: UEFI vs BIOS (`/sys/firmware/efi`)
- [ ] Список дисков через `lsblk -J` (модель, размер, тип, съёмный)
- [ ] Защита: исключить носитель LiveCD из списка целевых дисков
- [ ] Проверка сети (интерфейсы, DHCP, доступность зеркал Debian)

### Этап 4 — Разметка диска
- [ ] Выбор диска и схемы: авто (wipe), ручная, «оставить существующие разделы»
- [ ] Схемы: GPT + ESP + `/` (+ swap)
- [ ] ФС: `btrfs` (приоритет) и `ext4`; для btrfs — subvolumes (`@`, `@home`, `@snapshots`) и монтирование с `compress=zstd,noatime`
- [ ] Разметка через `parted`/`sgdisk`, форматирование (`mkfs.btrfs`, `mkfs.ext4`, `mkfs.fat`, `mkswap`)
- [ ] Монтирование в `/mnt` (и `/mnt/boot/efi` для UEFI)
- [ ] Экран подтверждения с точным списком команд (dry-run)
- [ ] (пост-MVP) LUKS и LVM

### Этап 5 — Установка базовой системы
- [ ] `debootstrap` (stable) в `/mnt` с выбором зеркала
- [ ] Монтирование `/proc`, `/sys`, `/dev`, `/dev/pts`, `/run` в chroot
- [ ] `sources.list` (main contrib non-free non-free-firmware), `apt update`
- [ ] Установка ядра (`linux-image-amd64`) и firmware
- [ ] Генерация `fstab` (свой генератор или `arch-install-scripts`/`genfstab`)

### Этап 6 — Настройка системы
- [ ] hostname, `/etc/hosts`
- [ ] locale + `locales`, раскладка клавиатуры, timezone (`/etc/localtime`)
- [ ] Пользователи: root-пароль, создание пользователя, группы, `sudo`
- [ ] Сеть: NetworkManager или systemd-networkd + resolv.conf
- [ ] Загрузчик: `grub-pc` (BIOS) / `grub-efi-amd64` (UEFI), `grub-install`, `update-grub`, os-prober

### Этап 7 — Пост-установка и завершение
- [ ] Применение выбранных профилей: установка пакетов, включение сервисов, `commands`, `files`
- [ ] Хуки/скрипты пользователя после установки
- [ ] Очистка: `apt clean`, удаление временных файлов
- [ ] Размонтирование, `swapoff`, финальный экран, `reboot`

### Этап 8 — Сборка LiveCD
- [ ] `livecd/build.sh`: сборка Live-системы (debootstrap) + установка установщика
- [ ] Упаковка установщика: скомпилированный `bun build --compile` бинарь (без зависимости от bun в Live)
- [ ] squashfs + initramfs + загрузчик (GRUB, гибридный ISO BIOS+UEFI)
- [ ] Автозапуск установщика на tty1, live-пользователь, сеть из коробки
- [ ] Сборка ISO через `xorriso`/`grub-mkrescue`

### Этап 9 — Тестирование и автоматизация
- [ ] Юнит-тесты (`bun test`) для конфига, парсинга `lsblk`, генерации fstab, резолва профилей
- [ ] Прогон установки в QEMU (BIOS и UEFI) по сохранённому конфигу
- [ ] Скрипт `scripts/qemu-test.sh` для быстрой проверки ISO
- [ ] Документация: README, как собрать ISO и как запустить установщик

## Профили (YAML)

Профиль — предзаготовленный набор софта и действий, который пользователь выбирает в визарде.
Профили наследуются друг от друга через `extends`, что позволяет строить иерархии
(`desktop` → `desktop-gnome` → `desktop-gnome-dev`).

### Схема

```yaml
# profiles/desktop-gnome.yaml
name: desktop-gnome
description: GNOME на базе desktop
extends: desktop            # строка или список; можно несколько родителей

packages:                   # пакеты apt
  - gnome
  - gnome-tweaks

services:                   # systemd-юниты для enable
  - gdm3

commands:                   # команды в chroot, по порядку (произвольный shell)
  - cmd: systemctl set-default graphical.target
    description: Загрузка в графический режим
    optional: true          # не прерывать установку при ошибке

files:                      # файлы, создаваемые в целевой системе
  - path: /etc/skel/.config/example.conf
    content: |
      key=value
    mode: "0644"
```

### Правила слияния при наследовании

- `packages`, `services`, `commands`, `files` — **конкатенация** родителей (в порядке `extends`), затем свои.
- `packages`/`services` дедуплицируются; `commands`/`files` сохраняют порядок.
- Скалярные поля (`name`, `description`) — переопределяются потомком.
- Циклы в `extends` — ошибка; глубина и число профилей ограничены.
- Порядок применения: топологическая сортировка по `extends`, чтобы родители шли раньше потомков.

### Источники профилей

- Встроенные — `profiles/` в репозитории (попадают в LiveCD).
- Пользовательские — каталог `--profiles-dir` (можно несколько), переопределяют встроенные по имени.

## Содержимое LiveCD

**База**
- Debian stable (debootstrap), ядро `linux-image-amd64` + `firmware-linux`
- systemd, live-boot/live-config (или кастомный init), `squashfs-tools`

**Установщик**
- `exdbnein` — скомпилированный бинарь (`bun build --compile`), автозапуск на tty1
- встроенные YAML-профили (`profiles/`)

**Инструменты разметки и ФС**
- `parted`, `gdisk`, `util-linux`, `dosfstools`, `e2fsprogs`, `btrfs-progs`, `xfsprogs`
- `cryptsetup`, `lvm2` (для LUKS/LVM)

**Установка системы**
- `debootstrap`, `arch-install-scripts` (genfstab), `apt`, `rsync`, `wget`/`curl`
- `grub-pc`, `grub-efi-amd64`, `grub-efi-amd64-bin`, `os-prober`, `efibootmgr`

**Сеть**
- `NetworkManager` (или `systemd-networkd` + `dhcpcd`), `iproute2`, `iw`, `wpasupplicant`

**Прочее**
- `locales`, `console-setup`, `keyboard-configuration`, `tzdata`
- `nano`/`vim`, `less`, `htop`, `dialog` (fallback), `bash-completion`

**Для сборки ISO (на хосте, не в Live)**
- `debootstrap`, `squashfs-tools`, `xorriso`, `mtools`, `grub-common`, `grub-pc-bin`, `grub-efi-amd64-bin`

## Открытые вопросы

- Загрузчик: только GRUB или ещё systemd-boot?
- Нужен ли автоматический режим (kickstart-подобный) в MVP?
- Нужны ли снапшоты btrfs «из коробки» (snapper/timeshift) или только subvolumes?
- Профили: `commands` — произвольный shell (выполняются в chroot, доверенный источник).
- Профили: условия/переменные (`when: uefi`) — отложены, пока статично.
