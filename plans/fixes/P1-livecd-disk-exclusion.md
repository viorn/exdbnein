# P1 · #1 — LiveCD-носитель блокирует все диски вне LiveCD

| | |
|---|---|
| ID | #1 |
| Приоритет | 🔴 Критический (P1) |
| Статус | ✅ Закрыто |
| Затрагиваемые файлы | [`src/system/disks.ts:74`](../src/system/disks.ts:74) — `hasLiveMountpoint`; [`src/steps/disk.ts:97`](../src/steps/disk.ts:97) — фильтр кандидатов; [`src/system/environment.ts:7`](../src/system/environment.ts:7) — `LIVE_MARKER` |
| Индекс | [README.md](./README.md) |

## Проблема

`hasLiveMountpoint` помечает диск как `isLiveMedium`, если у него есть mountpoint
`"/"`, `/run/live*`, `/cdrom` или `/media/*`. При запуске вне LiveCD с `--force`
(разработка, QEMU-тест на хосте) системный корень смонтирован в `/` — **все** диски,
кроме пустых/съёмных, будут исключены. Пользователь не сможет выбрать целевой диск.

## Воспроизведение

```bash
bun run src/index.ts --force
# → "No suitable disks found (LiveCD medium and current system disk excluded)"
```

В [`src/steps/disk.ts:97`](../src/steps/disk.ts:97) фильтрация безусловная:
`disks.filter((disk) => !disk.isLiveMedium)`.

## Текущее состояние (актуализация 2026-10-02)

- Появился маркер `LIVE_MARKER = "/etc/exdbnein-live"` и `isLiveEnvironment()`
  ([`src/system/environment.ts:7`](../src/system/environment.ts:7)) — но он используется
  только в pre-flight `checkEnvironment` ([`src/index.ts:56`](../src/index.ts:56)),
  а не в определении `isLiveMedium`.
- Рекомендация ревью (использовать маркер для определения LiveCD-носителя)
  реализована **только частично**: на уровне окружения, не на уровне исключения дисков.
- Функция `hasLiveMountpoint` по-прежнему исключает диск с монтированием `/`.

## Рекомендуемое исправление

1. Передать знание об окружении в определение `isLiveMedium`:

```ts
// disks.ts
export interface ListDisksOptions {
  /** Вне LiveCD (--force) корень хоста не считается LiveCD-носителем. */
  isLive: boolean;
}

function hasLiveMountpoint(node: LsblkNode, isLive: boolean): boolean {
  const mounts = collectMountpoints(node);
  if (!isLive) {
    // Вне LiveCD исключаем только съёмные носители (/media/*) и /cdrom.
    return mounts.some((m) => m === "/cdrom" || m.startsWith("/media/"));
  }
  return mounts.some(
    (m) => m === "/" || m.startsWith("/run/live") || m === "/cdrom" || m.startsWith("/media/"),
  );
}
```

2. В `listDisks()` определить `isLive = await isLiveEnvironment()` (передать параметром),
   чтобы не ломать чистые функции `toDiskInfo`/`parseLsblkOutput` — для них добавить
   параметр `isLive` со значением по умолчанию `true` (тесты не меняются).

3. Учесть, что при настоящем LiveCD корень (`/`) смонтирован с LiveCD-носителя —
   комбинация маркера `/etc/exdbnein-live` + mountpoint `/` даёт надёжную детекцию
   носителя, при этом диск хоста при `--force` остаётся доступным.

## Критерии приёмки

- [x] `bun run src/index.ts --force` на машине разработчика показывает диски хоста
      в списке выбора (в т.ч. системный диск).
- [x] В LiveCD образе (сборка [`livecd/build.sh`](../livecd/build.sh)) LiveCD-носитель
      по-прежнему исключается из списка.
- [x] Юнит-тесты `parseLsblkOutput`/`toDiskInfo` обновлены под новый параметр
      и покрывают оба режима (`isLive: true/false`).
- [x] `bun run check` проходит.

---

## Закрытие (2026-10-02)

Реализовано: `hasLiveMountpoint(node, isLive)`, `toDiskInfo(node, isLive)`,
`parseLsblkOutput(json, isLive)` (default `true`), `listDisks()` вызывает
`isLiveEnvironment()` и передаёт результат. 3 новых юнит-теста.
`bun run check` — 155 тестов, 0 fail.