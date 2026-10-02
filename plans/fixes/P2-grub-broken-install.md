# P2 · #7 — `isGrubInstalled` не проверяет битый/неполный GRUB

| | |
|---|---|
| ID | #7 |
| Приоритет | 🟡 Средний (P2) |
| Статус | Частично исправлено |
| Затрагиваемые файлы | [`src/system/configure.ts:505`](../src/system/configure.ts:505) — `isGrubInstalled`; [`src/system/configure.ts:534`](../src/system/configure.ts:534) — `planBootloader` |
| Индекс | [README.md](./README.md) |

## Проблема (из ревью)

Установка GRUB проверялась по наличию файлов `grubx64.efi` (UEFI) или `grub.cfg`
(BIOS). При битой/частичной записи файл существует, но `grub-install` пропускается →
система не загрузится.

## Текущее состояние (актуализация 2026-10-02)

**Основная рекомендация ревью уже внедрена:**

```ts
export async function isGrubInstalled(firmware: Firmware, root = TARGET_ROOT): Promise<boolean> {
  const version = await exec(inChroot(["grub-install", "--version"], root), { allowFailure: true });
  if (version.code !== 0) return false;                    // ← grub-install отсутствует
  if (firmware === "uefi") {
    return Bun.file(`${root}/boot/efi/EFI/exdbnein/grubx64.efi`).exists();
  }
  return Bun.file(`${root}/boot/grub/grub.cfg`).exists();
}
```

Теперь «пакет не установлен» детектируется через `grub-install --version`.

**Осталось (узкие кейсы):**

1. **BIOS:** `grub-pc` установлен → `grub-install --version` возвращает 0. Если при
   прошлом запуске postinst успел сгенерировать `/boot/grub/grub.cfg`, но запись
   MBR/бутсектора не удалась (или run прерван между ними), `grub.cfg` существует →
   `grub-install` в устройство пропускается → машина не грузится.
2. **UEFI:** `grubx64.efi` существует, но повреждён (обрыв записи в ESP) —
   пропуск переустановки.

## Рекомендуемое исправление

Проверять факт записи загрузчика, а не только наличие файлов:

- **BIOS:** проверить сигнатуру в бутсекторе: `dd if=<device> bs=440 count=1 | grep GRUB`
  или `grub-bios-setup --dry-run`; при отсутствии — планировать `grub-install`.
- **UEFI:** помимо файла — проверить валидность через `grub-file --is-x86-multiboot2`
  (если доступен), либо сверить размер/хеш файла с ожидаемым, либо проверять NVRAM
  через `efibootmgr` (но fallback-copy `EFI/BOOT/BOOTX64.EFI` в QEMU не создаёт
  NVRAM-записи — учитывать это).

Альтернатива: для BIOS всегда выполнять `grub-install` повторно при re-entry
(это идемпотентно и дешево), если существуют признаки незавершённой установки
(наличие пакета, но отсутствие boot-сигнатуры).

## Критерии приёмки

- [ ] Юнит-тест: UEFI — `grubx64.efi` отсутствует → `isGrubInstalled` = false.
- [ ] Юнит-тест: BIOS — пакет установлен, `grub.cfg` есть, но в бутсекторе нет
      сигнатуры GRUB → `isGrubInstalled` = false (plan содержит `grub-install`).
- [ ] Валидная установка GRUB по-прежнему не перепланируется повторно (идемпотентность).
- [ ] `scripts/qemu-test.sh` (BIOS + UEFI) проходит после исправления.
- [ ] `bun run check` проходит.