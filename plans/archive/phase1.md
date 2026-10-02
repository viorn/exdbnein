# Этап 1 — Ядро TUI и модель конфигурации

Статус: ✅ завершён (коммит 7ebb290).
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
- Тесты: exec, config, cli, password, wizard, review

## Хвосты этапа 1 — закрыты

### P1.1 ✅ Честный авторежим `--unattended`
Шаги сбора пропускаются через `Step.skip` в [`src/steps/index.ts`](../src/steps/index.ts:22);
при неполном конфиге ревью падает со списком недостающих полей и подсказкой про `--config`.
Проверено smoke-тестами: полный конфиг + `--unattended` — ноль вопросов; неполный — ошибка + exit 1.

### P1.2 ✅ Единообразная навигация «назад»
Общий хелпер `BACK`/`backOption`/`isBack` в [`src/ui/prompts.ts`](../src/ui/prompts.ts:44);
«← Назад» добавлен во все шаги (disk, locale, network, users, profiles, review).
Ограничение: back только в фазе A; в фазе B линейный раннер без возвратов (см. P4.3 в phase4).

### P1.3 ✅ Автосохранение черновика
Черновик `exdbnein-last.json` в `$TMPDIR` сохраняется после каждого шага
([`src/index.ts`](../src/index.ts:13)); при старте без `--config` предлагается восстановление.

## Критерии готовности

- [x] Авторежим с полным конфигом не задаёт ни одного вопроса; с неполным — понятная ошибка.
- [x] «Назад» работает во всех шагах единообразно; после ревью возврата нет.
- [x] Краш без `--config` не теряет ввод (черновик восстанавливается).
- [x] `bun run check` зелёный (37 тестов).