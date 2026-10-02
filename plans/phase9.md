# Этап 9 — Тестирование и автоматизация

Статус: ✅ завершён.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 9».

## Цель

Доказать, что установщик работает: юнит-тесты ключевых модулей, полные прогоны установки в QEMU
(BIOS и UEFI) по `--unattended` конфигу, скрипты автоматизации и документация.

## Задачи

- [x] Юнит-тесты: парсинг `lsblk`, генерация `fstab`, резолв профилей, имена разделов (P4.2/P9.2)
- [x] Прогон установки в QEMU (BIOS и UEFI) по сохранённому конфигу
- [x] Скрипт `scripts/qemu-test.sh` для быстрой проверки ISO
- [x] Автоматизация через serial console (`-serial stdio`) и полный `--unattended` конфиг (P9.1)
- [x] Документация: README, как собрать ISO и как запустить установщик
- [x] CI: QEMU-прогон отдельным ночным job (P9.3)

## Принятые решения

- QEMU-прогон строится на честном авторежиме (зависимость от P1.1 из [`plans/phase1.md`](phase1.md)).
- CI: typecheck/lint/test остаются в PR; QEMU — ночной job, чтобы не замедлять ревью.

## Риски

- P9.1 🟡 Без полного `--unattended` нельзя автоматизировать установку — закрыть P1.1 до этого этапа.
- P9.2 🔵 Тесты на суффиксы разделов и merges профилей — добавить вместе с реализацией этапов 2 и 4.
- P9.3 🔵 QEMU в CI — ночной job, не блокирующий PR.

## Критерии готовности

- Полный цикл: ISO → QEMU → установка → reboot → система входит и доступна по SSH (в обоих режимах прошивки).
- `scripts/qemu-test.sh` запускается одной командой и возвращает статус.
- README описывает сборку ISO, запуск установщика и режим автоматизации.
- `bun run check` зелёный; ночной CI-прогон зелёный.

## Реализация

**Авторежим (P9.1).** Юнит-тесты по списку этапа уже покрывали парсинг `lsblk`,
fstab, резолв профилей и имена разделов (P4.2/P9.2) и остались зелёными.
Полный `--unattended` уже существовал (P1.1, `Step.skip` + автоподтверждение на
ревью); добавлена сквозная автоматизация:

- [`scripts/qemu/unattended.json`](../scripts/qemu/unattended.json) — полный
  тестовый конфиг (btrfs, subvolumes, base-профиль, SSH-ключ через плейсхолдер
  `@@PUBKEY@@`);
- [`livecd/rootfs/opt/exdbnein/autostart.sh`](../livecd/rootfs/opt/exdbnein/autostart.sh) —
  wrapper tty1: обычный режим (интерактивный установщик) или авторежим по
  параметру ядра `exdbnein.config=auto`: монтирует seed-том (`EXDBNEINCFG`),
  запускает `--config … --unattended`, зеркалит вывод на ttyS0, пишет
  `RESULT=OK|FAIL` и выключает VM (`poweroff -f`) после успеха;
- [`livecd/build.sh`](../livecd/build.sh) — опция `AUTOTEST=1` добавляет
  `exdbnein.config=auto` в cmdline; grub.cfg собирается из шаблона
  ([`livecd/grub.cfg`](../livecd/grub.cfg)) с подстановкой параметров ядра;
  включён serial-getty на ttyS0.

**QEMU-прогоны (P9.2/P9.3).** [`scripts/qemu-test.sh`](../scripts/qemu-test.sh)
— один вызов: сборка AUTOTEST-ISO (при необходимости, перезапуск через sudo),
seed-диск с конфигом, фаза установки в QEMU (BIOS: SeaBIOS/pc, UEFI: OVMF/q35,
`-serial stdio`), ожидание маркера, перезагрузка с целевого диска, ожидание SSH
на `localhost:2222` и проверка (hostname, btrfs subvolumes, SSH-сервис, лог
установки). CI: ночной job
[`.github/workflows/qemu-nightly.yml`](../.github/workflows/qemu-nightly.yml)
(`schedule` + `workflow_dispatch`), не блокирует PR.

**Документация.** [`README.md`](../README.md): сборка ISO, интерактивный запуск,
режим `--unattended`, QEMU-автоматизация, команды разработчика.