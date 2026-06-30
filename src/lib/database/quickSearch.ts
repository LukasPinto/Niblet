import { displayValue } from "../markdown";
import type { DatabaseRow } from "./types";

export function applyQuickSearch(rows: DatabaseRow[], query: string): DatabaseRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    if (row.name.toLowerCase().includes(q)) return true;
    for (const v of Object.values(row.data)) {
      const text = displayValue(v).toLowerCase();
      if (text.includes(q)) return true;
    }
    return false;
  });
}
