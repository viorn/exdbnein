# exdbnein — инструкционный контекст

## Обзор проекта

**exdbnein** — консольный интерактивный TUI-установщик Debian (аналог `archinstall`), написанный на `Bun + TypeScript`. Поставляется внутри собственного LiveCD. Репозиторий содержит как сам установщик, так и скрипты сборки LiveCD-образа (ISO).

**Ключевые архитектурные решения:**
- **Архитектура:** только `amd64`.
- **Файловые системы:** приоритет — `btrfs` (subvolumes, снапшоты), плюс `ext4`.
- **LUKS/LVM:** отложены на пост-MVP.
- **Сборка LiveCD:** собственный `livecd/build.sh` (debootstrap + squashfs + xorriso/grub-mkrescue).
- **Профили:** YAML-файлы с наследованием через `extends`; `commands` — произвольный shell.

**Принципы разработки:**
- MVP по шагам — каждый этап заканчивается работоспособным состоянием.
- Идемпотентность и dry-run — деструктивные шаги сначала показываются как план команд.
- Безопасность — отказ при отсутствии root, не в LiveCD, или целевой диск = LiveCD-носитель.
- Тонкая обёртка над системой — модуль `system/` вызывает parted, mkfs.*, debootstrap, apt, chroot и т.д. Логика TUI не знает про shell.
- Конфиг как данные — `InstallConfig` сериализуемый (JSON), можно сохранить/загрузить/автоматизировать.

## Структура репозитория

```
exdbnein/
├── src/                    # установщик
│   ├── index.ts            # точка входа, каркас визарда (MVP-этап 0)
│   ├── steps/              # шаги визарда (диск, сеть, пользователи, ...)
│   ├── system/             # обёртки над parted/mkfs/debootstrap/apt/chroot
│   │   └── exec.ts         # обёртка над Bun.spawn + ExecError
│   ├── config/             # типы InstallConfig, валидация, save/load
│   ├── profiles/           # загрузка/резолв YAML-профилей
│   ├── ui/                 # хелперы поверх @clack/prompts
│   └── utils/
├── profiles/               # встроенные YAML-профили (base, desktop, server, ...)
├── tests/                  # bun test
├── livecd/                 # сборка LiveCD (ещё не создана)
├── .github/workflows/ci.yml # CI: typecheck + lint + test
├── package.json
├── tsconfig.json
├── biome.json
└── plan.md                 # подробный план по этапам (0–9)
```

> **Важно:** Большинство директорий (`src/steps`, `src/config`, `src/ui`, `src/profiles`, `src/utils`, `profiles/`, `livecd/`) — пока пустые заглушки. Реализован только каркас: `src/index.ts` (демо-визард) и `src/system/exec.ts` (обёртка над spawn). Полный функционал разбит на этапы 1–9 в `plan.md`.

## Сборка и запуск

### Установка зависимостей
```bash
bun install
```

### Запуск
```bash
bun run start          # bun run src/index.ts
bun run dev            # bun --watch src/index.ts (режим разработки)
```

### Проверка качества кода
```bash
bun run typecheck      # tsc --noEmit
bun run lint           # biome check .
bun run lint:fix       # biome check --write . (автофикс)
bun run format         # biome format --write . (автоформатирование)
bun run check          # typecheck + lint + test
```

### Тесты
```bash
bun run test           # bun test (все тесты в tests/)
```

### CI
GitHub Actions (`.github/workflows/ci.yml`):
- Триггер: push на `main`, pull requests.
- Шаги: `bun install` → `typecheck` → `lint` → `test`.

## Стек технологий

| Компонент        | Инструмент              |
|------------------|-------------------------|
| Рентайм          | Bun (v1.4.0+)           |
| Язык             | TypeScript ^7 (strict)  |
| TUI              | @clack/prompts          |
| Линтер/форматтер | Biome ^2.5              |
| Тестирование     | bun test                |
| CI               | GitHub Actions          |

## Настройки проекта

### TypeScript (`tsconfig.json`)
- `target`: ESNext, `module`: Preserve, `moduleResolution`: bundler
- `strict`: true, `verbatimModuleSyntax`: true
- `noEmit`: true (только типизация, Bun сам транспилирует)
- `types`: ["bun"]

### Biome (`biome.json`)
- **Formatter:** 2 пробела, ширина строки 100, двойные кавычки, точки с запятой всегда, trailing commas везде.
- **Linter:** preset "recommended".
- **Assist:** `organizeImports: on`.
- **Игнорируются:** `node_modules`, `dist`, `out`.

## Текущее состояние реализации

### ✅ Реализовано (Этап 0)
- Каркас проекта: `bun init`, TypeScript strict, `@clack/prompts`
- Скрипты `start` / `dev` / `test` / `typecheck` / `lint` / `format` / `check`
- Биome линтер + форматтер
- Структура каталогов `src/{steps,system,config,profiles,ui,utils}`, `profiles/`, `tests/`
- Модуль `system/exec.ts` — обёртка над `Bun.spawn` с `ExecError`, поддержка `allowFailure`, shell-команды, `hasCommand`
- Тесты для `exec.ts` (5 тестов)
- CI-заготовка (GitHub Actions)

### 🚧 В процессе / Запланировано (Этапы 1–9)
Полный план см. в `plan.md`. Кратко:
- **Этап 1** — Ядро TUI, модель `InstallConfig`, визард, сохранение конфига
- **Этап 2** — YAML-профили, наследование, выбор в визарде
- **Этап 3** — Определение окружения (root, UEFI/BIOS, диски, сеть)
- **Этап 4** — Разметка диска (GPT, btrfs/ext4, subvolumes)
- **Этап 5** — Установка базовой системы (debootstrap, ядро, fstab)
- **Этап 6** — Настройка системы (locale, hostname, пользователи, сеть, GRUB)
- **Этап 7** — Пост-установка (профили, очистка, reboot)
- **Этап 8** — Сборка LiveCD (build.sh, squashfs, ISO)
- **Этап 9** — Тестирование и автоматизация (QEMU, скрипты)

## Формат YAML-профилей

Профили — предзаготовленные наборы софта и действий. Поддерживают наследование через `extends`.

```yaml
name: desktop-gnome
description: GNOME на базе desktop
extends: desktop

packages:
  - gnome
  - gnome-tweaks

services:
  - gdm3

commands:
  - cmd: systemctl set-default graphical.target
    description: Загрузка в графический режим
    optional: true

files:
  - path: /etc/skel/.config/example.conf
    content: |
      key=value
    mode: "0644"
```

**Правила слияния:** `packages`/`services` — конкатенация с дедупликацией; `commands`/`files` — с сохранением порядка; скаляры — переопределение; циклы `extends` — ошибка.

## Работа с кодом

### Обёртка над командами (`src/system/exec.ts`)
Основной интерфейс — функция `exec(command: string[], options?)` и утилита `shell(command: string, options?)`. Возвращает `{ code, stdout, stderr }`. При ошибке (code != 0) бросает `ExecError`, если не указан `allowFailure`.

### TUI (`src/ui/` — ещё не реализовано)
Предполагается единый слой обёрток поверх `@clack/prompts` с обработкой `isCancel`, спиннерами и единым стилем.

### Конфигурация (`src/config/` — ещё не реализовано)
Предполагается тип `InstallConfig`, валидация по схеме, сохранение/загрузка JSON, режим `--config <file>` для автоматической установки.

### Шаги визарда (`src/steps/` — ещё не реализовано)
Каждый шаг — функция, принимающая текущий конфиг, задающая вопросы через TUI, возвращающая обновлённый конфиг.

## Открытые вопросы (из plan.md)
- Загрузчик: только GRUB или ещё systemd-boot?
- Нужен ли автоматический режим (kickstart-подобный) в MVP?
- Снапшоты btrfs «из коробки» (snapper/timeshift) или только subvolumes?
- Условия/переменные в профилях (`when: uefi`) — отложены.
