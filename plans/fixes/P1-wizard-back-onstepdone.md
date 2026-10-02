# P1 · #3 — `onStepDone` вызывается при навигации `back`: неконсистентный черновик

| | |
|---|---|
| ID | #3 |
| Приоритет | 🔴 Критический (P1) |
| Статус | ✅ Закрыто |
| Затрагиваемые файлы | [`src/ui/wizard.ts:50`](../src/ui/wizard.ts:50) — вызов `onStepDone`; [`src/index.ts:82`](../src/index.ts:82) — автосохранение черновика |
| Индекс | [README.md](./README.md) |

## Проблема

После каждого шага безусловно вызывается `options.onStepDone?.(step, config)`.
При `back` на тот же шаг сохраняется черновик с неконсистентным конфигом:
например, `disk.device` уже выбран, а layout/filesystem ещё нет. Если после
`← Back` произойдёт сбой (Ctrl+C), при следующем запуске "Restore" восстановит
черновик в неполном состоянии.

Дополнительно: при `back` на **первом шаге** `stack` пуст → `prev === undefined` →
`i` не меняется → цикл повторно прогоняет тот же шаг, повторно вызывая `onStepDone`.

## Воспроизведение

1. Запустить установщик.
2. Шаг "Target disk" → выбрать диск → Enter.
3. Нажать `← Back` (возврат на шаг диска).
4. Нажать Ctrl+C.
5. При следующем запуске выбрать "Restore" → конфиг с частичным `disk.device`,
   но без layout/filesystem.

Текущий код ([`src/ui/wizard.ts:41-60`](../src/ui/wizard.ts:41)):

```ts
let i = 0;
while (i < active.length) {
  const step = active[i];
  ...
  const result = await step.run({ config, index: i + 1, total: active.length });

  await options.onStepDone?.(step, config);   // ← вызывается и при back

  if (result.type === "back") {
    const prev = stack.pop();
    if (prev !== undefined) i = prev;
  } else {
    stack.push(i);
    i++;
  }
}
```

## Текущее состояние (актуализация 2026-10-02)

Логика не менялась с момента ревью. `onStepDone` в [`src/index.ts:82`](../src/index.ts:82)
пишет черновик в `DRAFT_FILE` на каждом вызове.

---

## Закрытие (2026-10-03)

`onStepDone` перемещён внутрь ветки `else` (continue) — больше не вызывается
при навигации `back`. Черновик не сохраняется с неконсистентным конфигом.

Критерии приёмки:
- [x] Юнит-тест `runWizard`: `onStepDone` не вызывается при результате `back`.
- [x] Юнит-тест: `onStepDone` вызывается для каждого шага при `continue`.
- [x] `bun run check` проходит (158 тестов, 0 fail).