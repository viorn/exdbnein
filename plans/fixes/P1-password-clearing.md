# P1 · #4 — Plaintext-пароль: legacy-поле в конфиге и очистка из памяти

| | |
|---|---|
| ID | #4 |
| Приоритет | 🔴 Критический (P1) |
| Статус | Частично исправлено |
| Затрагиваемые файлы | [`src/config/types.ts:31`](../src/config/types.ts:31) — `UserConfig.password?`; [`src/config/serialize.ts:4`](../src/config/serialize.ts:4) — `redact()`; [`src/steps/users.ts:41`](../src/steps/users.ts:41) — хэширование; [`src/utils/password.ts`](../src/utils/password.ts) — `hashPassword` |
| Индекс | [README.md](./README.md) |

## Проблема (из ревью)

Пароль вводится пользователем, хранится в `UserConfig.password`, хэшируется,
но plaintext остаётся в памяти до конца сессии → утечка при дампе памяти
(core dump). `redact()` удаляет пароль только при сериализации в JSON.

## Текущее состояние (актуализация 2026-10-02)

**Часть проблемы устранена:** шаг [`src/steps/users.ts`](../src/steps/users.ts) больше
**не кладёт plaintext в конфиг** — он хэширует сразу и сохраняет только hash:

```ts
users.push({
  username,
  passwordHash: await hashPassword(userPassword),  // plaintext не сохраняется
  sudo,
  sshKeys: [],
});
config.rootPasswordHash = await hashPassword(rootPassword);
```

**Что осталось:**

1. Legacy-поле `password?: string` по-прежнему объявлено в `UserConfig`
   ([`src/config/types.ts:34`](../src/config/types.ts:34)) — нигде в коде не заполняется,
   но может прийти из JSON-конфига через `parseConfig` ([`src/config/serialize.ts:16`](../src/config/serialize.ts:16))
   и жить в памяти весь прогон.
2. `redact()` ([`src/config/serialize.ts:4`](../src/config/serialize.ts:4)) — защита только
   на записи; при загрузке конфига с `password` поле остаётся.
3. Локальные переменные `rootPassword`/`userPassword` в шаге не затираются после хэширования.

## Рекомендуемое исправление

1. **Удалить legacy-поле** `password` из `UserConfig` — оно не используется;
   конфиг должен содержать только `passwordHash`.
2. `parseConfig` **отбрасывать** поле `password` (или валидатор должен отклонять
   конфиги с plaintext-паролями): конфигурация не должна принимать секреты в открытом виде.
3. `redact()` оставить как defense-in-depth (или убрать вместе с полем).
4. Опционально: затирать локальные строки после хэширования:

```ts
const hash = await hashPassword(userPassword);
// строка userPassword не может быть надёжно стёрта в JS —
// как минимум не держать её дольше шага и не логировать.
```

Полностью гарантировать стирание строк в JS нельзя — это documented limitation,
поэтому главная мера — **не допускать plaintext в конфиге** (пункты 1–2).

## Критерии приёмки

- [ ] В `UserConfig` нет поля `password`.
- [ ] `parseConfig` отбрасывает/отклоняет `password` в JSON (тест: конфиг с
      `users[].password` либо игнорируется, либо падает с понятной ошибкой валидации).
- [ ] `redact()` упрощён или удалён без потери функциональности.
- [ ] Сериализованный конфиг (draft, `--config`) не содержит паролей в открытом виде.
- [ ] `bun run check` проходит.