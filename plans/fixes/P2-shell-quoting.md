# P2 · #11 — `shell()` не квотит аргументы (документирование ограничения)

| | |
|---|---|
| ID | #11 |
| Приоритет | 🟡 Средний (P2) |
| Статус | Открыто |
| Затрагиваемые файлы | [`src/system/exec.ts:47`](../src/system/exec.ts:47) — `shell`; [`src/system/environment.ts:11`](../src/system/environment.ts:11) — вызов `id -u`; [`src/system/exec.ts:53`](../src/system/exec.ts:53) — `hasCommand` |
| Индекс | [README.md](./README.md) |

## Проблема

`shell()` передаёт строку через `sh -c <command>`:

```ts
export async function shell(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  return exec(["sh", "-c", command], options);
}
```

Если `command` содержит пользовательский ввод — возможна shell-инъекция.
На практике функция используется только для констант (`id -u`, `command -v <name>`),
но риск не задокументирован, и будущий вызов с пользовательскими данными
создаст уязвимость.

## Текущее состояние (актуализация 2026-10-02)

- Вызовы: [`src/system/environment.ts:11`](../src/system/environment.ts:11) (`id -u`),
  [`src/system/exec.ts:53`](../src/system/exec.ts:53) (`command -v <name>` — имя
  `name` приходит из константного кода).
- Рекомендация ревью — предупреждение в документации функции — не выполнена.

## Рекомендуемое исправление

1. Добавить JSDoc-предупреждение на `shell()`:

```ts
/**
 * Runs a command through `sh -c`. SECURITY: the string is passed to the shell
 * as-is — NEVER pass untrusted input (user-supplied values). For anything that
 * involves user data use `exec(command: string[])` instead (no shell involved).
 */
```

2. В `hasCommand` валидировать имя утилиты (например, `/^[a-zA-Z0-9_.-]+$/`),
   чтобы исключить инъекцию даже при случайном не-константном аргументе.

3. Audit-пункт: в коде не должно быть новых вызовов `shell()` с пользовательскими
   данными (добавить проверку на code review / biome rule, если возможно).

## Критерии приёмки

- [ ] JSDoc на `shell()` содержит предупреждение об инъекциях.
- [ ] `hasCommand` отклоняет имена с метасимволами (юнит-тест).
- [ ] Нет новых вызовов `shell()` с не-константными строками.
- [ ] `bun run check` проходит.