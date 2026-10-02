# Закрытые пункты ревью — уже исправлены или ложные срабатывания

> Актуализация: 2026-10-02. Эти пункты закрываются без правок кода —
> каждый снабжён доказательством в текущем кодовой базе.

---

## #1. LiveCD-носитель блокирует все диски вне LiveCD — исправлено

**Было в ревью (🔴):** `hasLiveMountpoint` помечал диск как `isLiveMedium`,
если у него был mountpoint `"/"`, `/run/live*`, `/cdrom` или `/media/*`.
При запуске вне LiveCD с `--force` системный корень смонтирован в `/` —
**все** диски, кроме пустых/съёмных, исключались.

**Текущее состояние:** в [`src/system/disks.ts`](../src/system/disks.ts) добавлен
параметр `isLive` в `hasLiveMountpoint`/`toDiskInfo`/`parseLsblkOutput`.
Функция `listDisks()` вызывает `isLiveEnvironment()` (проверка маркера
`/etc/exdbnein-live`) и передаёт результат вниз. Когда `isLive` = `false`,
исключаются только `/cdrom` и `/media/*` — диск хоста с `/` остаётся доступным.

**Проверка:** `bun run check` проходит (155 тестов, 375 expect), включая 3 новых
юнит-теста на `isLive=true/false` режимы.

**Вывод:** задача исправлена; `--force` на машине разработчика показывает диски хоста.

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
| #5 | Реализовано в `livecd/rootfs/opt/exdbnein/autostart.sh` |
| #14 | Ложное срабатывание — импорт используется |
| #15 | Явная аннотация добавлена в генератор |