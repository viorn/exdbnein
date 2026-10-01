# Этап 6 — Настройка системы

Статус: ⬜ не начат.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 6».

## Цель

Фаза B: настроить установленную в `/mnt` систему: hostname, локали, пользователи, сеть, загрузчик.
Конец этапа — первая перезагрузка в установленную систему возможна.

## Задачи

- [ ] hostname, `/etc/hosts`
- [ ] locale + `locales` (locale-gen), раскладка клавиатуры, timezone (`/etc/localtime`)
- [ ] debconf-пресеты для locales/console-setup/keyboard-configuration/tzdata (P6.1)
- [ ] Пользователи: root-пароль, создание пользователя, группы, `sudo`
- [ ] SSH-ключи: `~/.ssh` + `authorized_keys` с правами 700/600 (P6.3)
- [ ] Сеть: NetworkManager или systemd-networkd + resolv.conf
- [ ] Загрузчик: `grub-pc` (BIOS) / `grub-efi-amd64` (UEFI), `grub-install`, `update-grub`
- [ ] os-prober — по умолчанию выключен или с таймаутом (P6.2)

## Риски

- P6.1 🟡 Без `DEBIAN_FRONTEND=noninteractive` и `debconf-set-selections` chroot-установка
  зависнет на вопросах локалей/timezone.
- P6.2 🔵 os-prober медленный и чувствителен к EFI-переменным в QEMU — сделать опцией
  (уже есть поле `bootloader.osProber` в [`types.ts`](../src/config/types.ts:53)).
- P6.3 🔵 Неверные права на SSH-ключи — sshd откажется их использовать.

## Критерии готовности

- Система после этапов 5–6 грузится в QEMU (BIOS и UEFI) и доступна по сети.
- Локаль/раскладка/timezone соответствуют конфигу; пользователь входит по паролю и ключу.
- GRUB установлен в зависимости от прошивки; повторная установка не дублирует записи.
- `bun run check` зелёный.