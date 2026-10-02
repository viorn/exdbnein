# P1 · #2 — `planAptUpdate`: ложная идемпотентность при частичных списках

| | |
|---|---|
| ID | #2 |
| Приоритет | 🔴 Критический (P1) |
| Статус | Открыто |
| Затрагиваемые файлы | [`src/system/base.ts:135`](../src/system/base.ts:135) — `planAptUpdate`; [`src/system/base.ts:71`](../src/system/base.ts:71) — `dirHasFiles` |
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

## Рекомендуемое исправление

Проверять признак полного обновления, а не наличие любых файлов:

```ts
/** Release-файлы после успешного apt-get update: /var/lib/apt/lists/*_Release. */
async function aptListsFresh(root: string): Promise<boolean> {
  try {
    const entries = await readdir(`${root}/var/lib/apt/lists`);
    // Частичные списки содержат только .lz4/.diff_Index, но не *_Release.
    return entries.some((name) => name.endsWith("_Release") || name.endsWith("_InRelease"));
  } catch {
    return false;
  }
}
```

Вариант 2 (проще и надёжнее): всегда запускать `apt-get update`, если с момента
последнего обновления прошло больше часа:

```ts
const mtime = (await stat(`${root}/var/lib/apt/lists/...`).catch(() => null))?.mtimeMs;
```

Рекомендуется комбинация: файл `_Release`/`_InRelease` И возраст списков < 1 часа.

## Критерии приёмки

- [ ] Юнит-тест: `planAptUpdate` возвращает действие, если в `lists` только `.lz4`-файлы
      без `*_Release`.
- [ ] Юнит-тест: `planAptUpdate` возвращает `[]`, если `*_Release` присутствует
      и свежий.
- [ ] Ручной сценарий: прервать первый прогон на `apt-get update`, повторный запуск
      снова выполняет `apt-get update` и установка завершается без 404.
- [ ] `bun run check` проходит.