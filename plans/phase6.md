# Этап 6 — Настройка системы

Статус: ✅ завершён.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 6».

## Цель

Фаза B: настроить установленную в `/mnt` систему: hostname, локали, пользователи, сеть, загрузчик.
Конец этапа — первая перезагрузка в установленную систему возможна.

## Задачи

- [x] hostname, `/etc/hosts`
- [x] locale + `locales` (locale-gen), раскладка клавиатуры, timezone (`/etc/localtime`)
- [x] debconf-пресеты для locales/console-setup/keyboard-configuration/tzdata (P6.1)
- [x] Пользователи: root-пароль, создание пользователя, группы, `sudo`
- [x] SSH-ключи: `~/.ssh` + `authorized_keys` с правами 700/600 (P6.3)
- [x] Сеть: NetworkManager или systemd-networkd + resolv.conf
- [x] Загрузчик: `grub-pc` (BIOS) / `grub-efi-amd64` (UEFI), `grub-install`, `update-grub`
- [x] os-prober — по умолчанию выключен (P6.2)

## Принятые решения

- Стадия [`configureSystemStage`](../src/install/configure.ts) — идемпотентный набор действий
  (планы в [`src/system/configure.ts`](../src/system/configure.ts)): каждый под-шаг
  пропускается, если уже выполнен (hostname, locale.gen, XKBLAYOUT, симлинк localtime,
  dpkg-статусы пакетов, `id -u`, хеш root в `/etc/shadow`, `systemctl is-enabled`, EFI-файл GRUB).
- **debconf-пресеты** (P6.1) применяются через `debconf-set-selections` до установки пакетов:
  `locales`, `console-setup`, `keyboard-configuration`, `tzdata`; для BIOS — ещё
  `grub-pc/install_devices` (диск из конфига). Без них chroot-установка зависнет на вопросах.
- **Пароли** — только хеши: root через `usermod -p`, пользователи через `useradd -p`;
  повторный запуск сверяет хеш с `/etc/shadow` (`getent shadow root`) и не трогает неизменённое.
- **SSH-ключи** (P6.3): `~/.ssh/authorized_keys` с правами 600, каталог 700, владелец —
  пользователь (`chown`); sshd отказывается работать при неверных правах.
- **Сеть:** NetworkManager — пакет + `systemctl enable`; systemd-networkd — DHCP-конфиг
  `20-wired.network` (en*/eth*) + включение `systemd-networkd` и `systemd-resolved`,
  resolv.conf — симлинк на stub-резолвер; `none` — ничего не трогаем.
- **Загрузчик:** пакет по прошивке; BIOS — `grub-install --target=i386-pc <диск>` (postinst
  grub-pc ставит GRUB сам через пресет `install_devices`), UEFI — `grub-install
  --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=exdbnein` + резервная копия
  `grubx64.efi → EFI/BOOT/BOOTX64.EFI` (работает в QEMU/OVMF даже без записи в NVRAM).
  `/etc/default/grub` пишется до `update-grub`; повторная установка не дублирует записи.
- **os-prober** (P6.2) выключен по умолчанию: `GRUB_DISABLE_OS_PROBER=true`; поле
  `bootloader.osProber` (по умолчанию `false`) управляет установкой пакета `os-prober`
  и значением флага.

## Риски

- P6.1 🟡 Без `DEBIAN_FRONTEND=noninteractive` и `debconf-set-selections` chroot-установка
  зависнет на вопросах локалей/timezone — пресеты применяются до установки пакетов.
- P6.2 🔵 os-prober медленный и чувствителен к EFI-переменным в QEMU — выключен по
  умолчанию; включается полем `bootloader.osProber`.
- P6.3 🔵 Неверные права на SSH-ключи — sshd откажется их использовать; права 700/600
  выставляются явно (`chmod`) вместе с владельцем (`chown`).
- P6.4 🔵 GRUB-настройки должны попасть в grub.cfg — если пакет уже сгенерировал его,
  `update-grub` пересобирается только при изменении `/etc/default/grub`.

## Критерии готовности

- [ ] Система после этапов 5–6 грузится в QEMU (BIOS и UEFI) и доступна по сети (этап 9).
- [x] Локаль/раскладка/timezone соответствуют конфигу; пользователь входит по паролю
  и ключу — хеши через `usermod -p`/`useradd -p`, ключи с правами 700/600 (P6.3).
- [x] GRUB установлен в зависимости от прошивки (BIOS — i386-pc, UEFI — x86_64-efi + fallback);
  повторная установка не дублирует записи (проверка `isGrubInstalled`).
- [x] `bun run check` зелёный (102 теста, 21 новый для этапа 6).