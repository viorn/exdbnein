# Этап 1 — Ядро TUI и модель конфигурации

Статус: ✅ завершён (осталось три хвоста, см. «Остатки»).
Источник анализа: [`plans/plan-analysis.md`](plan-analysis.md), раздел «Этап 1».

## Цель

Интерактивный визард, который собирает полный `InstallConfig` (фаза A двухфазной модели),
валидирует его, показывает план и умеет сохранять/загружать JSON-конфиг.

## Сделано

- Тип `InstallConfig` + `defaultConfig` — [`src/config/types.ts`](../src/config/types.ts:56)
- Каркас визарда с обработкой отмены Ctrl+C — [`src/ui/wizard.ts`](../src/ui/wizard.ts:31), [`src/ui/errors.ts`](../src/ui/errors.ts:2)
- Хелперы `ui/` с преобразованием `isCancel` в `CancelledError` — [`src/ui/prompts.ts`](../src/ui/prompts.ts:17)
- Сохранение/загрузка JSON, `redact` секретов — [`src/config/serialize.ts`](../src/config/serialize.ts:32)
- Экран-ревью с валидацией и подтверждением — [`src/steps/review.ts`](../src/steps/review.ts:23)
- Хеширование sha512-crypt через `openssl passwd -6 -stdin` — [`src/utils/password.ts`](../src/utils/password.ts:28)
- CLI: `--config`, `--profiles-dir`, `--unattended`, `--help` — [`src/cli.ts`](../src/cli.ts:25)
- Навигация «назад» (стек, `StepResult`) — [`src/ui/wizard.ts`](../src/ui/wizard.ts:37)
- Авто-подтверждение ревью в авторежиме — [`src/steps/review.ts`](../src/steps/review.ts:35)
- Тесты: [`tests/exec.test.ts`](../tests/exec.test.ts), [`tests/config.test.ts`](../tests/config.test.ts)

## Остатки (хвосты этапа 1)

### P1.1 🔴 Честный авторежим `--unattended`
Сейчас `--unattended` влияет только на ревью. Шаги disk/locale/network/users/profiles всё равно задают
вопросы даже при полном конфиге.
**Задача:** в [`src/steps/index.ts`](../src/steps/index.ts:22) задавать `Step.skip = (cfg) => cfg.unattended && поле уже заполнено`
для каждого шага. При неполном конфиге в авторежиме — понятная ошибка со списком недостающих полей.
Это обязательное условие для этапа 9 (QEMU-прогон).

### P1.2 🟡 Единообразная навигация «назад»
Back реализован только в [`disk.ts`](../src/steps/disk.ts:29) и [`users.ts`](../src/steps/users.ts:52) —
как ручная опция внутри `select`/`confirm`. locale/network/profiles/review «назад» не предлагают.
**Задача:** общий хелпер в `ui/` (например, последний пункт «← Назад» в селектах, пункт «вернуться
к шагу N» на ревью), привести все шаги к одному поведению.
**Ограничение:** back разрешён только в фазе A (до подтверждения на ревью). После выполнения
деструктивных операций возврат запрещён (см. P4.3 в phase4).

### P1.3 🟡 Автосохранение черновика
Без `--config` прогресс визарда нигде не сохраняется — краш теряет весь ввод
([`src/index.ts`](../src/index.ts:28) сохраняет только при заданном `--config`).
**Задача:** автосохранять `last.json` в `$TMPDIR`/`~/.cache/exdbnein/` после каждого шага;
при следующем запуске предлагать восстановить черновик.

## Критерии готовности

- `bun run start -- --config x.json --unattended` с полным конфигом не задаёт ни одного вопроса;
  с неполным — завершается понятной ошибкой.
- «Назад» работает во всех шагах единообразно; после ревью возврата нет.
- Краш визарда без `--config` не теряет ввод (черновик восстанавливается).
- `bun run check` зелёный.