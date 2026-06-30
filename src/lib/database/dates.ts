import type { FrontmatterValue } from "../markdown";
import { displayValue } from "../markdown";

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{4}-\d{2}-\d{2}T/,
  /^\d{2}\/\d{2}\/\d{4}$/,
  /^\d{2}-\d{2}-\d{4}$/,
];

export function parseDateValue(value: FrontmatterValue | undefined): Date | null {
  if (value == null || value === "") return null;
  const s = displayValue(value).trim();
  if (!s) return null;
  if (!DATE_PATTERNS.some((p) => p.test(s))) {
    const d = Date.parse(s);
    return Number.isNaN(d) ? null : new Date(d);
  }
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : new Date(d);
}

export function isDateLikeValue(value: FrontmatterValue | undefined): boolean {
  return parseDateValue(value) !== null;
}

export function dateToInputValue(value: FrontmatterValue | undefined): string {
  const d = parseDateValue(value);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
