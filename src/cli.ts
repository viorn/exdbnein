export interface CliOptions {
  /** Path to the config file for loading/saving. */
  config?: string;
  /** Directory with YAML profiles. */
  profilesDir: string;
  /** Unattended mode without questions. */
  unattended: boolean;
  /** Allow running outside the LiveCD (for development). */
  force: boolean;
  help: boolean;
}

const DEFAULT_PROFILES_DIR = "profiles";

const HELP = `exdbnein — console Debian installer

Usage:
  exdbnein [options]

Options:
  -c, --config <file>       Load/save the configuration as JSON
  -p, --profiles-dir <dir>  Directory with YAML profiles (default: ${DEFAULT_PROFILES_DIR})
  -y, --unattended          Unattended mode: no questions, use the loaded config
  -f, --force               Allow running outside the LiveCD (for development)
  -h, --help                Show this help
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
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function helpText(): string {
  return HELP;
}
