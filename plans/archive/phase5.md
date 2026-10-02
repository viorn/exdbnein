# Этап 5 — Установка базовой системы

Статус: ✅ завершён.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 5».

## Цель

Фаза B: установить минимальную Debian-систему в `/mnt` (debootstrap), подключить ядро и firmware,
сгенерировать `fstab`. После этого шага система должна грузиться (вместе с этапом 6).

## Задачи

- [x] `debootstrap` (stable) в `/mnt` с зеркалом из конфига
- [x] Монтирование `/proc`, `/sys`, `/dev`, `/dev/pts`, `/run` в chroot
- [x] Для UEFI — bind-mount `/sys/firmware/efi/efivars` (P5.3)
- [x] `sources.list` (main contrib non-free non-free-firmware), `apt update`
- [x] Установка ядра `linux-image-amd64` и firmware
- [x] Генерация `fstab` по UUID (P5.2)
- [x] Долгие операции: прогресс, таймауты, kill-группа при отмене (P5.4)

## Принятые решения

- Зеркало по умолчанию `http://deb.debian.org/debian`, компоненты
  `main contrib non-free non-free-firmware` (Debian 12+).
- `fstab` — по UUID (устройства меняют имена между перезагрузками). Генератор свой
  (`src/system/fstab.ts`): читает фактические монтирования `findmnt -R -J` по целевому корню,
  swap — из `/proc/swaps`, UUID — из `blkid -o export`. `genfstab` не используется — он входит
  в arch-install-scripts, которого нет в Debian.
- Долгие системные операции вынесены в модуль [`src/system/run.ts`](../src/system/run.ts):
  спиннер в TUI, лимит времени, уничтожение дочерних процессов при Ctrl+C.
  Команда запускается через `setsid` и становится лидером новой группы процессов;
  завершение — сигналом на отрицательный pid (kill-группа целиком).
- План этапа — идемпотентный набор действий ([`src/system/base.ts`](../src/system/base.ts)):
  каждый под-шаг пропускается, если уже выполнен (debian_version, chroot-монтирования,
  apt-списки, dpkg-статус ядра, наличие fstab). Повторный вход поверх готового `/mnt`
  ничего не ломает.
- Preflight (P5.1): без `debootstrap` или `debian-archive-keyring` в LiveCD — понятный отказ
  до начала установки, а не падение посреди операции.
- `sources.list`: stable + stable-updates + security; компоненты — пробельный разделитель
  (для debootstrap `--components` — запятые).

## Риски

- P5.1 🟡 `debootstrap` и `debian-archive-keyring` в LiveCD — проверяются в preflight стадии
  ([`install/base.ts`](../src/install/base.ts)); офлайн-отказ понятный.
- P5.2 🔴 `fstab` по UUID — собственный генератор по `findmnt`/`blkid`; btrfs-subvolumes
  сохраняют `subvol=`, vfat ESP получает `umask=0077`; покрыто тестами.
- P5.3 🟡 Для UEFI efivars в списке обязательных монтирований chroot
  ([`chrootMounts`](../src/system/chroot.ts)) — без него на этапе 6 не встанет GRUB.
- P5.4 🟡 Ctrl+C во время `debootstrap`/`apt` — kill-группа в `run.ts`; повторный Ctrl+C
  или «зависшая» очистка → жёсткий SIGKILL; тест проверяет, что процессов не остаётся.

## Критерии готовности

- [x] После этапа 5 в `/mnt` есть загружаемое ядро и корректный `fstab` (UUID) —
  генерируется на стадии [`installBaseStage`](../src/install/base.ts); QEMU-прогон — этап 9.
- [x] Отмена во время debootstrap не оставляет процессов установщика в системе —
  kill-группа в [`src/system/run.ts`](../src/system/run.ts) + тест `tests/run.test.ts`.
- [x] Повторный запуск поверх готового `/mnt` не ломает установленное (идемпотентность
  каждого под-шага плана).
- [x] `bun run check` зелёный (81 тест, 26 новых для этапа 5).