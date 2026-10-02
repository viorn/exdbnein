# P3 · #13 — `swapPartition` попадает в `swapsForTarget` дважды

| | |
|---|---|
| ID | #13 |
| Приоритет | 🟢 Косметический (P3) |
| Статус | Открыто |
| Затрагиваемые файлы | [`src/system/finalize.ts:25`](../src/system/finalize.ts:25) — `swapsForTarget`; [`src/install/index.ts:76`](../src/install/index.ts:76) — передача `extra` |
| Индекс | [README.md](./README.md) |

## Проблема

```ts
export function swapsForTarget(swaps: string[], device: string, extra: string[] = []): string[] {
  const wanted = new Set<string>(extra.filter(Boolean));
  for (const swap of swaps) {
    if (device && swap.startsWith(device)) wanted.add(swap);
  }
  return [...wanted];
}
```

`swapPartition` передаётся как `extra` (для keep-layout) и одновременно фильтруется
по префиксу `device` (если swap-раздел находится на целевом диске). Set дедуплицирует,
поэтому функционально всё корректно, но логика двойного попадания сбивает с толку.

## Текущее состояние (актуализация 2026-10-02)

Вызов: [`src/install/index.ts:76`](../src/install/index.ts:76)

```ts
const extra = config.disk.swapPartition ? [config.disk.swapPartition] : [];
await swapoffTarget(config.disk.device, extra);
```

`extra` оправдан только для keep-layout (swap-раздел вне целевого диска).
Для auto/manual-layout `swapPartition` не задаётся вовсе.

## Рекомендуемое исправление

Уточнить контракт, чтобы источник был единственным:

- Для keep-layout — использовать только `extra`.
- Для auto/manual — только `device`-префикс.

Вариант: вынести решение о том, какие swap-устройства «наши», в чистую функцию
`targetSwapDevices(config, swaps)`, которая смотрит на `layout`:

```ts
export function targetSwapDevices(
  config: InstallConfig,
  swaps: string[],
): string[] {
  if (config.disk.layout === "keep" && config.disk.swapPartition) {
    return config.disk.swapPartition;
  }
  return swaps.filter((s) => s.startsWith(config.disk.device));
}
```

## Критерии приёмки

- [ ] Логика отбора swap-устройств определяется ровно одним источником.
- [ ] Юнит-тесты: keep-layout со swap вне целевого диска — включается;
      auto-layout — только разделы целевого диска.
- [ ] `bun run check` проходит.