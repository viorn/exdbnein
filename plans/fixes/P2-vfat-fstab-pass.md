# P2 · #9 — vfat (ESP) получает `pass=1` в fstab

| | |
|---|---|
| ID | #9 |
| Приоритет | 🟡 Средний (P2) |
| Статус | Открыто |
| Затрагиваемые файлы | [`src/system/fstab.ts:71`](../src/system/fstab.ts:71) — `fstabDumpPass` |
| Индекс | [README.md](./README.md) |

## Проблема

ESP (vfat) получает `pass=1` в fstab:

```ts
export function fstabDumpPass(fstype: string, mountpoint: string): [number, number] {
  if (fstype === "btrfs" || fstype === "xfs" || fstype === "f2fs") return [0, 0];
  if (mountpoint === "/") return [0, 1];
  if (fstype === "vfat") return [0, 1];   // ← ESP получает pass=1
  if (fstype === "ext4") return [0, 2];
  return [0, 0];
}
```

По стандарту проверка файловой системы выполняется с `pass=1` для корня
и `pass=2` для остальных ФС. Ошибка не фатальна: `/boot/efi` не участвует
в раннем fsck, но не соответствует ожидаемому поведению и может вызывать
ложную проверку ESP при загрузке.

## Текущее состояние (актуализация 2026-10-02)

Код не менялся — ветка `if (fstype === "vfat") return [0, 1];` на месте
([`src/system/fstab.ts:74`](../src/system/fstab.ts:74)).

## Рекомендуемое исправление

Заменить `pass` для vfat на `2`:

```ts
if (fstype === "vfat") return [0, 2];
```

(Значение `dump` остаётся `0`.)

## Критерии приёмки

- [ ] Юнит-тест `fstabDumpPass("vfat", "/boot/efi")` возвращает `[0, 2]`.
- [ ] Юнит-тест: `fstabDumpPass("ext4", "/")` по-прежнему `[0, 1]`,
      `fstabDumpPass("ext4", "/home")` — `[0, 2]`.
- [ ] Сгенерированный fstab для UEFI-установки содержит `pass=2` для `/boot/efi`.
- [ ] `bun run check` проходит.