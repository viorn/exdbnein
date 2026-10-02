# exdbnein

Консольный интерактивный TUI-установщик Debian (аналог `archinstall`) на
`Bun + TypeScript` + `@clack/prompts`. Поставляется внутри собственного LiveCD.

## Установка зависимостей

```bash
bun install
```

## Запуск

```bash
bun run start          # bun run src/index.ts
bun run dev            # bun --watch src/index.ts (режим разработки)
```

Вне LiveCD установщик требует флаг `--force` (иначе отказ по маркеру
`/etc/exdbnein-live`). Полный список опций — `bun run start -- --help`.

## Проверка качества кода

```bash
bun run typecheck      # tsc --noEmit
bun run lint           # biome check .
bun run lint:fix       # biome check --write . (автофикс)
bun run format         # biome format --write . (автоформатирование)
bun run check          # typecheck + lint + test
```

## Тесты

```bash
bun run test           # bun test (все тесты в tests/)
```

## Встроенные профили

Профили `profiles/*.yaml` компилируются в бинарь установщика (`bun build --compile`),
чтобы LiveCD работал без YAML-ассетов рядом (P8.1):

```bash
bun run embed:profiles          # регенерирует src/profiles/embedded-data.generated.ts
bun run build:installer         # bun build --compile ./src/index.ts → out/exdbnein
```

Рантайм берёт YAML-каталог `--profiles-dir`, если он есть, иначе — встроенные данные.

## Сборка LiveCD

```bash
bun run build:live              # bash livecd/build.sh → out/exdbnein-stable.iso
```

Требования к хосту (root, amd64): `debootstrap`, `squashfs-tools`, `xorriso`,
`grub-pc-bin`, `grub-efi-amd64-bin`, `mtools`, `debian-archive-keyring`, рантайм `bun`.
Параметры сборки — окружение (`SUITE`, `MIRROR`, `ISO_NAME`, `SOURCE_DATE_EPOCH`,
`KEEP_WORK`, `BUN`). Подробности — `livecd/build.sh` и `plans/phase8.md`.

Сборка требует root, а `bun` обычно стоит только в `~/.bun/bin` пользователя, куда
`sudo` не заглядывает (secure_path). Запускайте одним из способов:

```bash
sudo env "PATH=$PATH" bash livecd/build.sh            # пробросить пользовательский PATH
BUN=/path/to/bun sudo -E bash livecd/build.sh          # явно указать путь к bun
```

Если `BUN` не задан, скрипт сам ищет `bun` в `PATH`, `~/.bun/bin` и `~/.local/bin`
текущего пользователя и пользователя `SUDO_USER`.

## CI

GitHub Actions (`.github/workflows/ci.yml`): `bun install` → `typecheck` → `lint` →
`test` → проверка актуальности встроенных профилей (`embed:profiles` + `git diff --exit-code`).
