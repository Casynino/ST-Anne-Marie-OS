/**
 * Normalises phone numbers to E.164. Tanzanian numbers may be typed as
 * 0712 345 678, 712345678, 255712345678 or +255712345678. Returns null if invalid.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (raw.startsWith("+") && !digits.startsWith("255")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  let national: string;
  if (digits.startsWith("255") && digits.length === 12) national = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 10) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  else return null;
  return /^[2-9]\d{8}$/.test(national) ? `+255${national}` : null;
}

export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 ? v : null;
}

/** Login identifier: an email address or a phone number. */
export function normalizeIdentifier(input: string): string | null {
  return input.includes("@") ? normalizeEmail(input) : normalizePhone(input);
}
