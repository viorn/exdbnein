# P3 · #12 — Переэкспорт `EMBEDDED_PROFILES_YAML`

| | |
|---|---|
| ID | #12 |
| Приоритет | 🟢 Косметический (P3) |
| Статус | Открыто |
| Затрагиваемые файлы | [`src/profiles/embedded.ts:5`](../src/profiles/embedded.ts:5) |
| Индекс | [README.md](./README.md) |

## Проблема

В [`src/profiles/embedded.ts:1`](../src/profiles/embedded.ts:1) `EMBEDDED_PROFILES_YAML`
импортируется, а в [`src/profiles/embedded.ts:5`](../src/profiles/embedded.ts:5) тут же
реэкспортируется:

```ts
import { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";
...
export { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";
```

Строка реэкспорта избыточна, если экспорт уже обеспечивается импортом с `export`
или если `index.ts` реэкспортирует весь модуль. Нужно проверить, кто использует
`EMBEDDED_PROFILES_YAML` из `embedded.ts`.

## Текущее состояние (актуализация 2026-10-02)

Оба оператора на месте. Функции модуля используют локальный импорт —
реэкспорт нужен только если внешние модули обращаются к символу через `embedded.ts`.

## Рекомендуемое исправление

1. Найти использование `EMBEDDED_PROFILES_YAML` вне `embedded.ts`
   (`src/profiles/index.ts` и др.).
2. Если символ нигде не нужен из этого модуля — удалить строку реэкспорта.
3. Если нужен — заменить дублирующий импорт+реэкспорт на один:

```ts
export { EMBEDDED_PROFILES_YAML } from "./embedded-data.generated.ts";
```

и внутри модуля использовать этот же символ.

## Критерии приёмки

- [ ] Нет дублирования импорт/реэкспорт одного символа.
- [ ] `bun run typecheck` проходит (символ доступен там, где используется).
- [ ] `bun run lint` проходит.