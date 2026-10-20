import { en } from "@/lib/i18n/en";
import type { MessageKey, Translate } from "@/lib/i18n";
import type { RowMessage } from "./students";

/** Turns a stored row message (code + parameters) into text in the user's language. */
export function describeMessage(t: Translate, m: RowMessage): string {
  const key = `imp.msg.${m.code}`;
  const field = m.field ? t(`imp.field.${m.field}` as MessageKey) : "";
  if (!(key in en)) return m.code;
  return t(key as MessageKey, { field, ...(m.params ?? {}) });
}
