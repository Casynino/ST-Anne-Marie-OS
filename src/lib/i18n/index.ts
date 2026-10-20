import { en, type MessageKey } from "./en";
import { sw } from "./sw";

export type Locale = "EN" | "SW";
export type { MessageKey };
export const LOCALE_COOKIE = "sam_locale";

const dictionaries: Record<Locale, Record<MessageKey, string>> = { EN: en, SW: sw };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): Translate {
  const dict = dictionaries[locale];
  return (key, vars) => {
    let msg: string = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) msg = msg.replaceAll(`{${k}}`, String(v));
    return msg;
  };
}

export const isLocale = (v: unknown): v is Locale => v === "EN" || v === "SW";

/** Looks up a dynamic key (e.g. `student.status.${status}`) and falls back to the raw value. */
export function tDynamic(t: Translate, prefix: string, value: string): string {
  const key = `${prefix}.${value}` as MessageKey;
  return key in en ? t(key) : value;
}
