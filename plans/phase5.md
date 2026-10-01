# Этап 5 — Установка базовой системы

Статус: ⬜ не начат.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 5».

## Цель

Фаза B: установить минимальную Debian-систему в `/mnt` (debootstrap), подключить ядро и firmware,
сгенерировать `fstab`. После этого шага система должна грузиться (вместе с этапом 6).

## Задачи

- [ ] `debootstrap` (stable) в `/mnt` с выбором зеркала
- [ ] Монтирование `/proc`, `/sys`, `/dev`, `/dev/pts`, `/run` в chroot
- [ ] Для UEFI — bind-mount `/sys/firmware/efi/efivars` (P5.3)
- [ ] `sources.list` (main contrib non-free non-free-firmware), `apt update`
- [ ] Установка ядра `linux-image-amd64` и firmware
- [ ] Генерация `fstab` по UUID (P5.2)
- [ ] Долгие операции: прогресс, таймауты, kill-группа при отмене (P5.4)

## Принятые решения

- Зеркало по умолчанию `http://deb.debian.org/debian`, компоненты
  `main contrib non-free non-free-firmware` (Debian 12+).
- `fstab` — по UUID (устройства меняют имена между перезагрузками).
- Долгие системные операции выносятся в модуль `src/system/run.ts`: спиннер/прогресс в TUI,
  лимит времени, уничтожение дочерних процессов при Ctrl+C.

## Риски

- P5.1 🟡 В LiveCD должны быть `debootstrap` и `debian-archive-keyring`; в офлайне — понятный отказ.
- P5.2 🔴 `fstab` по UUID, не по `/dev/sdX` — генератор или `genfstab -U`.
- P5.3 🟡 Для UEFI `grub-install` в chroot нужен `/sys/firmware/efi/efivars` — включить в список
  обязательных монтирований.
- P5.4 🟡 `debootstrap`/`apt` идут минуты; Ctrl+C не должен оставлять осиротевшие процессы —
  kill-группа в `system/run.ts`.

## Критерии готовности

- После этапа 5 в `/mnt` есть загружаемое ядро и корректный `fstab` (UUID).
- Отмена во время debootstrap не оставляет процессов установщика в системе.
- Повторный запуск поверх готового `/mnt` не ломает установленное (идемпотентность).
- `bun run check` зелёный.