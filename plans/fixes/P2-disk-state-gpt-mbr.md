# P2 · #6 — `diskPreparationState` без проверки GPT/MBR: повторная деструктивная разметка

| | |
|---|---|
| ID | #6 |
| Приоритет | 🟡 Средний (P2) |
| Статус | Частично исправлено |
| Затрагиваемые файлы | [`src/system/disks.ts:254`](../src/system/disks.ts:254) — `DiskPreparationState`/`diskPreparationState`; [`src/install/disk.ts:57`](../src/install/disk.ts:57) — `prepareDiskStage`; [`src/system/disks.ts:389`](../src/system/disks.ts:389) — `layoutCommands` (parted mklabel) |
| Индекс | [README.md](./README.md) |

## Проблема (из ревью)

Проверка готовности диска основывалась на наличии `/mnt` в mountpoints.
Если разметка прервалась после `mkfs`, но до `mount`, состояние возвращалось
«не готово» → `parted mklabel` запускался снова и уничтожал уже созданную
таблицу разделов.

## Текущее состояние (актуализация 2026-10-02)

**Часть проблемы устранена** рефакторингом:

- Вместо бинарного `isDiskPrepared` появилось трёхзначное состояние
  `"none" | "partial" | "ready"` ([`src/system/disks.ts:262`](../src/system/disks.ts:262)).
- Состояние `partial` покрывает кейс «root смонтирован, но @home/@snapshots не смонтированы» —
  теперь выполняется восстановление монтирования, а не переразметка
  ([`src/install/disk.ts:74`](../src/install/disk.ts:74)).

**Что осталось (неисправлено):**

- Состояние диска определяется **только** по факту монтирования root в `/mnt`.
- Кейс «разметка выполнена (GPT/MBR + разделы + mkfs), но root не смонтирован»
  (обрыв между format и mount) возвращает `"none"` → [`prepareDiskStage`](../src/install/disk.ts:98)
  строит полный план, включая `parted -s <device> mklabel` — **уничтожение существующей
  таблицы разделов**.
- В unattended-режиме подтверждение не запрашивается — данные стираются молча.

## Воспроизведение

1. `--unattended` с config на устройстве `/dev/sda`.
2. Прервать процесс между `mkfs.btrfs` и `mount` (kill -9).
3. Повторный запуск: `diskPreparationState` → `"none"` (root не смонтирован).
4. Выполняется `parted -s /dev/sda mklabel gpt` → таблица разделов уничтожена,
   всё заново.

## Рекомендуемое исправление

Добавить в определение состояния проверку наличия сигнатуры разметки:

```ts
/** Есть ли на диске таблица разделов (GPT/MBR)? parted print -m, вторая строка. */
export async function diskHasPartitionTable(device: string): Promise<boolean> {
  const result = await exec(["parted", "-s", device, "print", "-m"], { allowFailure: true });
  if (result.code !== 0) return false; // нет таблицы или устройство без разметки
  return result.stdout.split("\n").some((line) => line.startsWith("BYT;"));
}
```

Ввести четвёртое состояние `"partitioned"` (таблица есть, root не смонтирован):

- `"partitioned"` → продолжать с этапа format/mount (не mklabel), либо требовать
  явного подтверждения переразметки;
- в unattended-режиме при `"partitioned"` — **не выполнять** mklabel без флага
  перезаписи.

Логика предлагается такая:

```ts
// none      — нет ни таблицы, ни монтирования → полный план (fresh install)
// partitioned — таблица есть, root не смонтирован → только format+mount, без mklabel
// partial   — root смонтирован, subvolumes отсутствуют → recovery
// ready     — всё на месте
```

## Критерии приёмки

- [ ] Юнит-тест `diskPreparationState`: диск с таблицей разделов, но без монтирования →
      `"partitioned"`, а не `"none"`.
- [ ] `planPartitionCommands` для `"partitioned"` не содержит `parted mklabel`
      (или содержит только при явном подтверждении).
- [ ] В unattended-режиме переразметка существующего диска без подтверждения невозможна.
- [ ] Сценарий обрыва «после mkfs» восстанавливается без потери данных (re-entry).
- [ ] `bun run check` проходит.