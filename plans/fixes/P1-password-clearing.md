# P1 · #4 — Plaintext-пароль: legacy-поле в конфиге и очистка из памяти

| | |
|---|---|
| ID | #4 |
| Приоритет | 🔴 Критический (P1) |
| Статус | ✅ Закрыто |
| Затрагиваемые файлы | [`src/config/types.ts:31`](../src/config/types.ts:31) — `UserConfig.password?`; [`src/config/serialize.ts:4`](../src/config/serialize.ts:4) — `redact()`/`parseConfig`; [`src/steps/users.ts:41`](../src/steps/users.ts:41) — хэширование; [`src/utils/password.ts`](../src/utils/password.ts) — `hashPassword` |
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

**Что осталось было исправить:**

1. Legacy-поле `password?: string` по-прежнему объявлено в `UserConfig`
   ([`src/config/types.ts:34`](../src/config/types.ts:34)) — нигде в коде не заполняется,
   но может прийти из JSON-конфига через `parseConfig` ([`src/config/serialize.ts:16`](../src/config/serialize.ts:16))
   и жить в памяти весь прогон.
2. `redact()` ([`src/config/serialize.ts:4`](../src/config/serialize.ts:4)) — защита только
   на записи; при загрузке конфига с `password` поле остаётся.
3. Локальные переменные `rootPassword`/`userPassword` в шаге не затираются после хэширования.

---

## Закрытие (2026-10-03)

1. `parseConfig` теперь вызывает `stripPassword` для каждого пользователя —
   поле `password` отбрасывается при загрузке JSON.
2. `redact()` рефакторингурован: вынесена функция `stripPassword`, используется
   и в `redact`, и в `parseConfig` (DRY).
3. Legacy-поле `password` оставлено в `UserConfig` для обратной совместимости
   с JSON-конфигами, но больше не попадает в память при парсинге.
4. Локальные переменные не затираются — JS String неизменяем, это documented
   limitation; главная мера — не допускать plaintext в конфиге.

Критерии приёмки:
- [x] `parseConfig` отбрасывает `password` в JSON (юнит-тест добавлен).
- [x] `redact()` упрощён через `stripPassword`.
- [x] Сериализованный конфиг (draft, `--config`) не содержит паролей в открытом виде.
- [x] `bun run check` проходит (158 тестов, 0 fail).