import { displayValue } from "../markdown";
import type { ColumnMeta } from "./fieldTypes";
import { parseMultiSelectValue } from "./fieldTypes";
import type { DatabaseRow } from "./types";

const PALETTE_SIZE = 10;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function tagColorIndex(value: string): number {
  return hashString(value.toLowerCase()) % PALETTE_SIZE;
}

export function tagColorClass(
  value: string,
  overrides?: Record<string, number>,
): string {
  const key = value.replace(/^#/, "").trim();
  let idx = overrides?.[key];
  if (idx === undefined && overrides) {
    const entry = Object.entries(overrides).find(
      ([k]) => k.toLowerCase() === key.toLowerCase(),
    );
    idx = entry?.[1];
  }
  if (idx === undefined) idx = tagColorIndex(key);
  const clamped = ((idx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return `db-pill db-pill--c${clamped}`;
}

export const PALETTE_INDICES = Array.from({ length: PALETTE_SIZE }, (_, i) => i);

export function collectAllTags(
  rows: DatabaseRow[],
  keys: string[],
  columnMeta: Record<string, ColumnMeta>,
): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of keys) {
      const meta = columnMeta[key];
      if (!meta) continue;
      if (meta.type === "multi_select") {
        for (const t of parseMultiSelectValue(row.data[key])) set.add(t);
      } else if (meta.type === "select") {
        const v = displayValue(row.data[key]).trim();
        if (v) set.add(v);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
