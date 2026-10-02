# Закрытые пункты ревью — уже исправлены или ложные срабатывания

> Актуализация: 2026-10-03. Задачи, исправленные правками кода, описаны ниже.
> Задачи, закрытые без правок (ложные срабатывания, реализовано в overlay), — в конце.

---

## #2. `planAptUpdate` — ложная идемпотентность при частичных списках — исправлено

**Было в ревью (🔴):** `planAptUpdate` пропускал `apt-get update`, если в
`/mnt/var/lib/apt/lists` был хотя бы один файл. Прерванный `apt-get update`
оставлял `.lz4`-фрагменты → последующий `apt-get install` падал с `404`.

**Текущее состояние:** в [`src/system/base.ts`](../src/system/base.ts) `dirHasFiles`
заменена на `aptListsFresh(root)`, которая проверяет наличие `*_Release` или
`*_InRelease` файлов — признак успешного завершения `apt-get update`.
Частичные списки (только `.lz4`) больше не блокируют повторный запуск.

**Проверка:** `bun run check` проходит (158 тестов, 0 fail).

**Вывод:** задача исправлена; re-entry после прерванного `apt-get update`
теперь корректно повторяет обновление.

---

## #3. `onStepDone` вызывается при навигации `back` — неконсистентный черновик — исправлено

**Было в ревью (🔴):** `onStepDone` вызывался безусловно после каждого шага,
включая `back`. Черновик сохранялся с неконсистентным конфигом (например,
`disk.device` выбран, но layout/filesystem ещё нет).

**Текущее состояние:** в [`src/ui/wizard.ts`](../src/ui/wizard.ts) `onStepDone`
перемещён внутрь ветки `else` (continue) — больше не вызывается при `back`.

**Проверка:** `bun run check` проходит (158 тестов, 0 fail). Обновлён
юнит-тест `onStepDone вызывается только при continue, не при back`.

**Вывод:** задача исправлена; черновик не сохраняется с неполным конфигом.

---

## #4. Plaintext-пароль: legacy-поле в конфиге и очистка из памяти — исправлено

**Было в ревью (🔴):** `parseConfig` загружал plaintext `password` из JSON-конфига
в память. `redact()` удалял пароль только при сериализации на диск.

**Текущее состояние:** в [`src/config/serialize.ts`](../src/config/serialize.ts):
- `stripPassword` вынесена в отдельную функцию, используется и в `redact`, и в `parseConfig`.
- `parseConfig` теперь вызывает `stripPassword` для каждого пользователя —
  поле `password` отбрасывается при загрузке JSON.
- Legacy-поле `password` оставлено в `UserConfig` для обратной совместимости,
  но больше не попадает в память при парсинге.

**Проверка:** `bun run check` проходит (158 тестов, 0 fail). Добавлен
юнит-тест `parseConfig отбрасывает legacy plaintext password из JSON`.

**Вывод:** задача исправлена; plaintext-пароли не живут в памяти при загрузке конфига.

---

## #5. Seed-том с конфигом — реализован

**Было в ревью (🔴):** QEMU-тест создаёт FAT-образ с меткой `EXDBNEINCFG` и `config.json`,
ожидается подхват через kernel cmdline `exdbnein.config=auto` — в коде установщика этого нет.

**Текущее состояние:** функциональность реализована в LiveCD-overlay, а не в `src/`:

- [`livecd/build.sh`](../livecd/build.sh:51) — при `AUTOTEST=1` добавляет `exdbnein.config=auto`
  в командную строку ядра.
- [`livecd/rootfs/opt/exdbnein/autostart.sh`](../livecd/rootfs/opt/exdbnein/autostart.sh:25) —
  парсит `/proc/cmdline`, находит seed-том по метке через `blkid -L EXDBNEINCFG`
  (fallback — `/dev/disk/by-label/`), монтирует read-only, запускает
  `exdbnein --config <seed>/config.json --unattended --force`, дублирует вывод на ttyS0
  и пишет `[exdbnein] RESULT=OK|FAIL`.
- Запуск на tty1 при старте LiveCD — через systemd unit в [`livecd/rootfs/etc/systemd/system`](../livecd/rootfs/etc/systemd/system).

**Проверка:** [`scripts/qemu-test.sh`](../scripts/qemu-test.sh:149) создаёт seed-том
(`mkfs.vfat -n EXDBNEINCFG` + `mcopy`) и ожидает `RESULT=OK` из автозапуска.

**Вывод:** задача решена; новых работ не требуется. При изменении механизма
передачи конфига (например, перенос поиска seed-тома в сам установщик)
необходимо сохранить совместимость с этим скриптом.

---

## #14. Неиспользуемый импорт `tmpdir` — ложное срабатывание

**Было в ревью (🟢):** импорт `import { tmpdir } from "node:os";` в `src/index.ts` — избыточен.

**Текущее состояние:** ревью само оговорилось, что импорт используется:
в [`src/index.ts`](../src/index.ts:13) `DRAFT_FILE = join(tmpdir(), "exdbnein-last.json")`.
Импорт корректный и необходимый.

**Вывод:** пункт закрыт как ложное срабатывание.

---

## #15. `EMBEDDED_PROFILES_YAML` без явного типа — уже аннотирован

**Было в ревью (🟢):** генерируемый `embedded-data.generated.ts` не содержит явной аннотации типа.

**Текущее состояние:** файл [`src/profiles/embedded-data.generated.ts`](../src/profiles/embedded-data.generated.ts:4)
содержит явную аннотацию:

```ts
export const EMBEDDED_PROFILES_YAML: Record<string, string> = { ... };
```

**Вывод:** задача решена при генерации; аннотация добавлена в шаблон
[`scripts/embed-profiles.ts`](../scripts/embed-profiles.ts).

---

## Сводка

| ID | Причина закрытия |
|----|------------------|
| #1 | `isLive`-параметр в `hasLiveMountpoint`/`listDisks`; `--force` показывает диски хоста |
| #2 | `aptListsFresh` проверяет `*_Release`/`*_InRelease` вместо любых файлов |
| #3 | `onStepDone` перемещён в ветку `else` (continue), не вызывается при `back` |
| #4 | `parseConfig` вызывает `stripPassword`; plaintext не попадает в память |
| #5 | Реализовано в `livecd/rootfs/opt/exdbnein/autostart.sh` |
| #14 | Ложное срабатывание — импорт используется |
| #15 | Явная аннотация добавлена в генератор |