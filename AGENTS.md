# exdbnein — инструкционный контекст
Работаем через git worktree что бы не конкурировать с другими агентами либо разработчиком в основной директории

## Обзор проекта

**exdbnein** — консольный интерактивный TUI-установщик Debian (аналог `archinstall`), написанный на `Bun + TypeScript`. Поставляется внутри собственного LiveCD. Репозиторий содержит как сам установщик, так и скрипты сборки LiveCD-образа (ISO).

**Ключевые архитектурные решения:**
- **Архитектура:** только `amd64`.
- **Файловые системы:** приоритет — `btrfs` (subvolumes, снапшоты), плюс `ext4`.
- **LUKS/LVM:** отложены на пост-MVP.
- **Сборка LiveCD:** собственный `livecd/build.sh` (debootstrap + squashfs + xorriso/grub-mkrescue).
- **Профили:** YAML-файлы с наследованием через `extends`; `commands` — произвольный shell.

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
├── livecd/                 # сборка LiveCD (этап 8): build.sh, packages.txt, overlay rootfs
├── scripts/                # embed-profiles.ts (генератор встроенных профилей) и др.
├── .github/workflows/ci.yml # CI: typecheck + lint + test + актуальность встроенных профилей
├── package.json
├── tsconfig.json
├── biome.json
└── plan.md                 # подробный план по этапам (0–9)
```

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
Тесты могут впасть в бесконечный цикл, используй timeout, что бы избежать этого

### CI
GitHub Actions (`.github/workflows/ci.yml`):
- Триггер: push на `main`, pull requests.
- Шаги: `bun install` → `typecheck` → `lint` → `test` → проверка актуальности
  встроенных профилей (`embed:profiles` + `git diff --exit-code`).