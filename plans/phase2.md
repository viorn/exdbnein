# Этап 2 — Профили и наборы пакетов

Статус: ✅ завершён.
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 2».

## Цель

Предзаготовленные наборы софта и действий в YAML, с наследованием через `extends`.
Профиль выбирается в визарде и применяется в фазе B (этап 7).

## Формат профиля

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

## Правила слияния при наследовании

- `packages`, `services`, `commands`, `files` — конкатенация родителей (в порядке `extends`), затем свои.
- `packages`/`services` дедуплицируются (union); `commands`/`files` сохраняют порядок.
- Скалярные поля (`name`, `description`) — переопределяются потомком.
- Циклы в `extends` — `ProfileResolveError`; отсутствующий родитель — ошибка.
- Порядок применения: DFS post-order (родители раньше потомков).

## Модули

- [`src/profiles/types.ts`](../src/profiles/types.ts) — `Profile`, `ResolvedProfile`, `MergedProfiles`
- [`src/profiles/load.ts`](../src/profiles/load.ts) — загрузка `*.yaml`/`*.yml` с валидацией при загрузке
- [`src/profiles/resolve.ts`](../src/profiles/resolve.ts) — `resolveProfile`, `mergeProfiles`, `resolveProfiles`, `ProfileResolveError`
- [`src/profiles/validate.ts`](../src/profiles/validate.ts) — проверка схемы, неизвестные поля, типы полей

## Задачи

- [x] Зависимость `yaml` (yaml@2.9.1) в [`package.json`](../package.json)
- [x] Формат YAML-профиля: `packages`, `services`, `commands`, `files`, `extends`
- [x] Загрузка из `profiles/` и внешнего каталога `--profiles-dir` (шаг визарда грузит каталог из опций)
- [x] Резолв наследования: цепочки, слияние, защита от циклов, топосорт
- [x] Валидация профиля: схема, неизвестные поля, конфликты файлов при merge
- [x] Выбор профилей в визарде с предпросмотром итогового набора (пакеты/команды/файлы)
- [x] Встроенные профили: `base`, `server`, `desktop`, `dev`
- [x] Юнит-тесты: цепочки, дубли, циклы, конфликты, валидация (10 тестов в [`tests/profiles.test.ts`](../tests/profiles.test.ts))

## Принятые решения

- **Конфликт файлов** (разное содержимое по одному пути) — ошибка валидации при merge, а не «последний побеждает».
- **`commands` — доверенный источник.** Встроенные профили доверенные; предупреждение о недоверенных
  внешних каталогах показывается на этапе 7 перед применением команд.
- **Развёрнутый профиль** (flat list после резолва) доступен через `resolveProfiles` — применение
  на этапе 7 детерминировано.

## Не сделано / отложено

- Несколько каталогов `--profiles-dir` с переопределением встроенных по имени: CLI принимает один
  каталог (по умолчанию `profiles/`). Мульти-каталог — при необходимости.
- Применение профилей (пакеты/сервисы/команды/файлы) — этап 7.

## Критерии готовности

- [x] Выбор профилей в визарде работает; предпросмотр показывает итоговые пакеты/команды/файлы.
- [x] Наследование: цепочки, дубли, циклы, конфликты файлов покрыты тестами.
- [x] Встроенные профили `base`, `server`, `desktop`, `dev` валидны и загружаются.
- [x] `bun run check` зелёный.