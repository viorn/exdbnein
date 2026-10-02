import {
  type ConfirmOptions,
  confirm as clackConfirm,
  multiselect as clackMultiselect,
  password as clackPassword,
  select as clackSelect,
  text as clackText,
  isCancel,
  type MultiSelectOptions,
  type Option,
  type PasswordOptions,
  type SelectOptions,
  type TextOptions,
} from "@clack/prompts";
import { CancelledError } from "./errors.ts";

export async function text(opts: TextOptions): Promise<string> {
  const value = await clackText(opts);
  if (isCancel(value)) throw new CancelledError();
  return value;
}

export async function password(opts: PasswordOptions): Promise<string> {
  const value = await clackPassword(opts);
  if (isCancel(value)) throw new CancelledError();
  return value;
}

export async function select<Value>(opts: SelectOptions<Value>): Promise<Value> {
  const value = await clackSelect(opts);
  if (isCancel(value)) throw new CancelledError();
  return value as Value;
}

export async function multiselect<Value>(opts: MultiSelectOptions<Value>): Promise<Value[]> {
  const value = await clackMultiselect(opts);
  if (isCancel(value)) throw new CancelledError();
  return value as Value[];
}

export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  const value = await clackConfirm(opts);
  if (isCancel(value)) throw new CancelledError();
  return value;
}

/** Value of the "← Back" option in select/multiselect. */
export const BACK = "__back__";

/** Checks that the user chose "← Back". */
export function isBack(value: unknown): boolean {
  return value === BACK;
}

/** The "← Back" option to add to the options of select lists. */
export function backOption(label = "← Back"): Option<string> {
  return { value: BACK, label, hint: "to previous step" };
}

export type { Option };
