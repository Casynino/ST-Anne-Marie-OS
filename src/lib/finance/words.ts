/*
 * An amount written out in words, as on the school's paper receipts ("The sum of TZS One Million Eight Hundred ... and Fifty Eight Cents").
 * Pure; English and Kiswahili. Amounts are whole cents (integers), never floating point.
 */

const EN_UNITS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const EN_SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${EN_UNITS[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(EN_TENS[Math.floor(n / 10)]!); n %= 10; if (n) parts.push(EN_UNITS[n]!); }
  else if (n > 0) parts.push(EN_UNITS[n]!);
  return parts.join(" ");
}

export function numberToWordsEn(n: number): string {
  if (n === 0) return "Zero";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) groups.unshift([enBelowThousand(chunk), EN_SCALES[scale]].filter(Boolean).join(" "));
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(" ");
}

const SW_UNITS = ["", "moja", "mbili", "tatu", "nne", "tano", "sita", "saba", "nane", "tisa"];
const SW_TENS = ["", "kumi", "ishirini", "thelathini", "arobaini", "hamsini", "sitini", "sabini", "themanini", "tisini"];

function swBelowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`mia ${SW_UNITS[Math.floor(n / 100)]}`); n %= 100; }
  if (n >= 10) { parts.push(SW_TENS[Math.floor(n / 10)]!); n %= 10; }
  if (n > 0) parts.push(SW_UNITS[n]!);
  return parts.join(" na ");
}

export function numberToWordsSw(n: number): string {
  if (n === 0) return "sifuri";
  const billions = Math.floor(n / 1_000_000_000), millions = Math.floor((n % 1_000_000_000) / 1_000_000), thousands = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  const parts: string[] = [];
  if (billions) parts.push(`bilioni ${swBelowThousand(billions)}`);
  if (millions) parts.push(`milioni ${swBelowThousand(millions)}`);
  if (thousands) parts.push(`elfu ${swBelowThousand(thousands)}`);
  if (rest) parts.push(swBelowThousand(rest));
  return parts.join(" na ");
}

/** "TZS One Million Eight Hundred Eighty One Thousand Six Hundred Eighty Eight and Fifty Eight Cents Only" (cents only when there are some). */
export function amountInWords(cents: number, currency: string, locale: "EN" | "SW"): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const frac = Math.abs(cents) % 100;
  if (locale === "SW") {
    const main = numberToWordsSw(whole);
    const out = frac ? `${main} na senti ${numberToWordsSw(frac)}` : main;
    return `${currency} ${out.charAt(0).toUpperCase()}${out.slice(1)} tu`;
  }
  const out = frac ? `${numberToWordsEn(whole)} and ${numberToWordsEn(frac)} Cents` : numberToWordsEn(whole);
  return `${currency} ${out} Only`;
}
