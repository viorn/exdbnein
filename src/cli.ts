export interface CliOptions {
  /** Путь к файлу конфигурации для загрузки/сохранения. */
  config?: string;
  /** Каталог с YAML-профилями. */
  profilesDir: string;
  /** Авторежим без вопросов. */
  unattended: boolean;
  /** Разрешить запуск вне LiveCD (для разработки). */
  force: boolean;
  help: boolean;
}

const DEFAULT_PROFILES_DIR = "profiles";

const HELP = `exdbnein — консольный установщик Debian

Использование:
  exdbnein [опции]

Опции:
  -c, --config <file>       Загрузить/сохранить конфигурацию в JSON
  -p, --profiles-dir <dir>  Каталог с YAML-профилями (по умолчанию: ${DEFAULT_PROFILES_DIR})
  -y, --unattended          Авторежим: без вопросов, использовать загруженный конфиг
  -f, --force               Разрешить запуск вне LiveCD (для разработки)
  -h, --help                Показать эту справку
`;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    profilesDir: DEFAULT_PROFILES_DIR,
    unattended: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-c":
      case "--config":
        options.config = argv[++i];
        break;
      case "-p":
      case "--profiles-dir":
        options.profilesDir = argv[++i] ?? DEFAULT_PROFILES_DIR;
        break;
      case "-y":
      case "--unattended":
        options.unattended = true;
        break;
      case "-f":
      case "--force":
        options.force = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  return options;
}

export function helpText(): string {
  return HELP;
}
