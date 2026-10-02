/**
 * One file to write into the target system. The path is relative to the target
 * system root: the writer adds the mount point prefix (P7.1): `/etc/x` → `/mnt/etc/x`.
 */
export interface ProfileFile {
  path: string;
  content: string;
  /** Permissions in "0644" format. */
  mode: string;
}

/**
 * Command executed in the target system chroot (P7.1): it sees the target system
 * root directly (`/etc/x`), unlike files which are written with the /mnt prefix.
 */
export interface ProfileCommand {
  cmd: string;
  description?: string;
  /** Do not interrupt the installation on a run failure. */
  optional?: boolean;
}

/** Raw (unresolved) profile from YAML. */
export interface Profile {
  name: string;
  description?: string;
  /** Name or list of names of parent profiles. */
  extends?: string | string[];
  packages: string[];
  services: string[];
  commands: ProfileCommand[];
  files: ProfileFile[];
}

/** Profile after resolving inheritance (flat list, application order preserved). */
export interface ResolvedProfile {
  name: string;
  packages: string[];
  services: string[];
  commands: ProfileCommand[];
  files: ProfileFile[];
  /** Ancestor chain from farthest to nearest (without the profile itself). */
  parents: string[];
}

/** Merge of several selected profiles. */
export interface MergedProfiles {
  packages: string[];
  services: string[];
  commands: ProfileCommand[];
  files: ProfileFile[];
}
