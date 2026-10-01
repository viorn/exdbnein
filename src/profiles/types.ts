/** Один файл для записи в целевую систему (пути — относительно корня целевой системы). */
export interface ProfileFile {
  path: string;
  content: string;
  /** Права доступа в формате "0644". */
  mode: string;
}

/** Команда, выполняемая в chroot целевой системы. */
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
