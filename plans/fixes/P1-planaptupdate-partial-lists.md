# P1 · #2 — `planAptUpdate`: ложная идемпотентность при частичных списках

| | |
|---|---|
| ID | #2 |
| Приоритет | 🔴 Критический (P1) |
| Статус | ✅ Закрыто |
| Затрагиваемые файлы | [`src/system/base.ts:135`](../src/system/base.ts:135) — `planAptUpdate`; [`src/system/base.ts:80`](../src/system/base.ts:80) — `aptListsFresh` |
| Индекс | [README.md](./README.md) |

## Проблема

`planAptUpdate` пропускает `apt-get update`, если в
`/mnt/var/lib/apt/lists` есть хотя бы один файл:

```ts
export async function planAptUpdate(): Promise<PlannedAction[]> {
  if (await dirHasFiles(`${TARGET_ROOT}/var/lib/apt/lists`)) return [];
  ...
}
```

Если `apt-get update` был прерван (частичная загрузка), файлы присутствуют,
но списки неполные. Последующий `apt-get install` упадёт с `404` для части пакетов.
Идемпотентность **ошибочно пропускает** повторный `apt-get update`.

## Воспроизведение

1. Установка прерывается во время `apt-get update` (Ctrl+C / падение сети / timeout).
2. Повторный запуск установщика (re-entry): `/mnt/var/lib/apt/lists` непустой →
   `planAptUpdate` возвращает `[]`.
3. `apt-get install` (essential packages / kernel / stage 6) получает `404 Not Found`
   для пакетов, которых нет в обрезанных списках.

## Текущее состояние (актуализация 2026-10-02)

Код не менялся: проверка по-прежнему `dirHasFiles`, порог таймаута
`APT_UPDATE_TIMEOUT_MS` есть только у самого действия, но не у решения о пропуске.

---

## Закрытие (2026-10-03)

`dirHasFiles` заменена на `aptListsFresh(root)`, которая проверяет наличие
`*_Release` или `*_InRelease` файлов — признак успешного завершения `apt-get update`.
Частичные списки (только `.lz4`) больше не блокируют повторный запуск.

Критерии приёмки:
- [x] `bun run check` проходит (158 тестов, 0 fail).
- [x] Добавлен юнит-тест на экспортируемую функцию и таймаут.