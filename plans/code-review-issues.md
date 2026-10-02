# Ревью кодовой базы exdbnein — найденные проблемы

Дата: 2026-10-02
Автор: ревью архитектуры кода

> Статус: все проблемы не исправлены, требуют triage и назначения.

---

## 🔴 Критические

### 1. 🔴 LiveCD-носитель — блокировка всех дисков вне LiveCD

**Файл:** [`src/system/disks.ts:73`](../src/system/disks.ts:73)
**Функция:** `hasLiveMountpoint`

**Описание:**
Функция исключает диски, у которых хотя бы один mountpoint — `"/"`, `/run/live*`, `/cdrom` или `/media/*`. При запуске вне LiveCD с `--force` (разработка, QEMU-тест) системный корень смонтирован в `/` — **все** диски кроме пустых/съёмных будут исключены. Пользователь не сможет выбрать целевой диск.

**Воспроизведение:**
```bash
bun run src/index.ts --force
# → "No suitable disks found (LiveCD medium and current system disk excluded)"
```

**Рекомендация:**
Вне LiveCD не исключать диски по `/` — использовать маркер `/etc/exdbnein-live` для определения LiveCD-носителя.

---

### 2. 🔴 `planAptUpdate` — ложная идемпотентность при частичных списках

**Файл:** [`src/system/base.ts:135`](../src/system/base.ts:135)
**Функция:** `planAptUpdate`

**Описание:**
Проверяет наличие файлов в `/var/lib/apt/lists`. Если `apt-get update` был прерван (частичная загрузка), файлы присутствуют, но списки неполные. `apt-get install` позже упадёт с `404` для части пакетов. Idempotency **ошибочно пропускает** повторный `apt-get update`.

**Рекомендация:**
Проверять наличие Release-файла (например, `/var/lib/apt/lists/*_Release`) или всегда запускать `apt-get update`, если с момента последнего обновления прошло >1 часа.

---

### 3. 🔴 `onStepDone` вызывается при навигации `back` — неконсистентный черновик

**Файл:** [`src/ui/wizard.ts:50`](../src/ui/wizard.ts:50)

**Описание:**
После каждого шага вызывается `onStepDone` — при `back` туда-же сохраняется черновик с неконсистентным конфигом. Если после нажатия `← Back` произойдёт сбой, черновик будет восстановлен в неполном состоянии.

Дополнительно: при `back` на **первом шаге** `stack` пуст → `prev === undefined` → `i` не меняется → зацикливание с повторными `onStepDone`.

**Воспроизведение:**
1. Запустить установщик
2. Шаг "Target disk" → выбрать диск → Enter
3. Нажать `← Back` (возврат на шаг диска)
4. Нажать Ctrl+C
5. При следующем запуске выбрать "Restore" → конфиг с частичным `disk.device`, но без layout/filesystem

**Рекомендация:**
Вызывать `onStepDone` только при `continue`, не при `back`:
```ts
if (result.type === "back") {
  const prev = stack.pop();
  if (prev !== undefined) i = prev;
} else {
  await options.onStepDone?.(step, config); // только тут
  stack.push(i);
  i++;
}
```

---

### 4. 🔴 Plaintext-пароль не очищается в памяти

**Файл:** [`src/config/types.ts:34`](../src/config/types.ts:34) — поле `password?: string`
**Файл:** [`src/config/serialize.ts:4`](../src/config/serialize.ts:4) — `redact()`

**Описание:**
Пароль вводится пользователем, сохраняется в `UserConfig.password`, хэшируется, но plaintext остаётся в памяти до конца сессии. При дампе памяти (core dump) — утечка пароля. `redact()` удаляет только при сериализации в JSON.

**Рекомендация:**
Очищать `password` сразу после вычисления хэша: `delete user.password` / `user.password = undefined` — и не ждать сериализации.

---

### 5. 🔴 Seed-том с конфигом не читается установщиком

**Файл:** [`src/index.ts`](../src/index.ts) — не реализовано

**Описание:**
QEMU-тест ([`scripts/qemu-test.sh`](../scripts/qemu-test.sh)) создаёт FAT-образ с меткой `EXDBNEINCFG`, содержащий `config.json`. Ожидается, что kernel cmdline `exdbnein.config=auto` или аналогичный механизм подхватит этот конфиг. Однако **в коде установщика этого нет** — нет поиска seed-тома, нет парсинга `exdbnein.config`.

**Где должно быть:**
- Либо в initramfs-хуке (live-boot) — копирует config.json из seed-тома в известное место
- Либо в `src/index.ts` — findmnt/lsblk по метке `EXDBNEINCFG` → loadConfig

**Без этой функциональности автоматическая установка (--unattended) не работает — QEMU-прогон будет ждать ввода в /dev/tty1.**

**Рекомендация:**
Добавить в `src/system/environment.ts` или отдельный модуль `src/system/seed.ts` функцию обнаружения seed-тома:
```ts
export async function findSeedConfig(): Promise<string | null> {
  // lsblk → поиск раздела с LABEL=EXDBNEINCFG
  // mount → чтение config.json
  // return content | null
}
```

---

## 🟡 Средние

### 6. 🟡 `isDiskPrepared` — нет проверки GPT/MBR

**Файл:** [`src/system/disks.ts:236`](../src/system/disks.ts:236)

**Описание:**
Проверяет готовность диска по наличию `/mnt` в mountpoints раздела. Если разметка прервалась после `mkfs` до `mount`, `isDiskPrepared` возвращает `false`, и parted снова попытается создать таблицу разделов — это вызовет ошибку (таблица уже есть).

**Рекомендация:**
Добавить проверку через `parted -s <device> print` или существование GPT/MBR-сигнатуры.

---

### 7. 🟡 `isGrubInstalled` не проверяет битый/неполный GRUB

**Файл:** [`src/system/configure.ts:461`](../src/system/configure.ts:461)

**Описание:**
Проверяет установку GRUB по наличию файла `grubx64.efi` (UEFI) или `grub.cfg` (BIOS). При битой/частичной записи файл существует, но grub-install будет пропущен. Система не загрузится.

**Рекомендация:**
Не полагаться на idempotency по файлам — проверять через `grub-install --version` или `efibootmgr`.

---

### 8. 🟡 `exec` без `setsid` — процессы-сироты при Ctrl+C

**Файл:** [`src/system/exec.ts:26`](../src/system/exec.ts:26)

**Описание:**
`exec()` (не `runLong()`) запускает команды через `Bun.spawn()` без `setsid`. При Ctrl+C сигнал не доходит до дочерних процессов (parted, mkfs), остаются сиротами. `runLong()` корректно использует `setsid`.

**Рекомендация:**
Добавить `setsid` во все вызовы `exec` для системных команд (partition, format, mount), либо перевести их на `runLong`.

---

### 9. 🟡 vfat (ESP) получает `pass=1` в fstab

**Файл:** [`src/system/fstab.ts:74`](../src/system/fstab.ts:74)

**Описание:**
ESP (vfat) получает `pass=1` в fstab. По стандарту корень проверяется с `pass=1`, всё остальное — с `pass=2`. Ошибка не приводит к фатальным последствиям, т.к. `/boot/efi` не участвует в раннем fsck, но не соответствует FHS.

**Рекомендация:**
Изменить `pass` для vfat на `2`.

---

### 10. 🟡 SSH-ключи: полная перезапись вместо добавления

**Файл:** [`src/system/configure.ts:320`](../src/system/configure.ts:320)

**Описание:**
`authorized_keys` сравнивается и перезаписывается целиком. При нескольких `UserConfig` для одного пользователя или при повторном запуске с новыми ключами — старые теряются.

**Документировать:** что `sshKeys` — это полный список, а не дополнение.

---

### 11. 🟡 `exec()` — не квотит shell-аргументы

**Файл:** [`src/system/exec.ts:47`](../src/system/exec.ts:47)

**Описание:**
`shell()` передаёт строку через `sh -c <command>`. Если `command` содержит пользовательский ввод, shell-инъекция возможна. На практике используется только для констант (`id -u`, `command -v`).

**Рекомендация:**
Добавить предупреждение в документацию функции.

---

## 🟢 Косметические

### 12. 🟢 Переэкспорт `EMBEDDED_PROFILES_YAML`

**Файл:** [`src/profiles/embedded.ts:8`](../src/profiles/embedded.ts:8)

**Описание:**
`EMBEDDED_PROFILES_YAML` импортируется и тут же реэкспортируется — избыточно. Можно удалить строку, т.к. экспорт уже есть в `embedded-data.generated.ts` при его импорте в `index.ts`.

---

### 13. 🟢 `swapPartition` попадает в `swapsForTarget` дважды

**Файл:** [`src/system/finalize.ts:25`](../src/system/finalize.ts:25)

**Описание:**
`swapPartition` передаётся как `extra` и одновременно фильтруется по префиксу `device`. Set дедуплицирует, но логика сбивает с толку.

**Рекомендация:**
Для `keep` layout — использовать только `extra`, для auto/manual — только `device`-префикс.

---

### 14. 🟢 Неиспользуемый импорт в `src/index.ts:1`

**Файл:** [`src/index.ts:1`](../src/index.ts:1)

```ts
import { tmpdir } from "node:os";
```

Используется, на самом деле, в строке 13 для `DRAFT_FILE`. Всё корректно.

---

### 15. 🟢 `EMBEDDED_PROFILES_YAML` не типизирован явно

**Файл:** [`src/profiles/embedded-data.generated.ts`](../src/profiles/embedded-data.generated.ts)

Генерируемый файл не содержит явной аннотации типа. TypeScript выводит `Record<string, string>`, что корректно, но можно указать явно для читаемости.

---

## 📊 Итог по приоритетам

| Категория | Количество |
|-----------|-----------:|
| 🔴 Критические | 5 |
| 🟡 Средние | 6 |
| 🟢 Косметические | 4 |

> 🔴 **Критические** — блокируют корректную работу в сценариях: запуск вне LiveCD (`--force`), повторный запуск после сбоя, автоустановка через seed-том, утечка пароля.
>
> 🟡 **Средние** — снижают надёжность, идемпотентность, безопасность на граничных случаях.
>
> 🟢 **Косметические** — не влияют на работу, но желательны к исправлению для чистоты кода.