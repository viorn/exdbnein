/**
 * Один файл для записи в целевую систему. Путь — относительно корня целевой системы:
 * writer добавляет префикс точки монтирования (P7.1): `/etc/x` → `/mnt/etc/x`.
 */
export interface ProfileFile {
  path: string;
  content: string;
  /** Права доступа в формате "0644". */
  mode: string;
}

/**
 * Команда, выполняемая в chroot целевой системы (P7.1): видит корень целевой системы
 * напрямую (`/etc/x`), в отличие от файлов, которые пишутся с префиксом /mnt.
 */
export interface ProfileCommand {
  cmd: string;
  description?: string;
  /** Не прерывать установку при ошибке выполнения. */
  optional?: boolean;
}

/** Сырой (не разрешённый) профиль из YAML. */
export interface Profile {
  name: string;
  description?: string;
  /** Имя или список имён родительских профилей. */
  extends?: string | string[];
  packages: string[];
  services: string[];
  commands: ProfileCommand[];
  files: ProfileFile[];
}

/** Профиль после резолва наследования (плоский список, порядок применения сохранён). */
export interface ResolvedProfile {
  name: string;
  packages: string[];
  services: string[];
  commands: ProfileCommand[];
  files: ProfileFile[];
  /** Цепочка предков от дальних к ближним (без самого профиля). */
  parents: string[];
}

/** Объединение нескольких выбранных профилей. */
export interface MergedProfiles {
  packages: string[];
  services: string[];
  commands: ProfileCommand[];
  files: ProfileFile[];
}
