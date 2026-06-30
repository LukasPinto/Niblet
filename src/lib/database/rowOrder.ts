import type { DatabaseRow } from "./types";
import type { SortState } from "./viewConfig";

export function applyRowOrder(
  rows: DatabaseRow[],
  rowOrder: string[],
  sort: SortState,
): DatabaseRow[] {
  if (sort.key && sort.dir) return rows;
  if (rowOrder.length === 0) return rows;

  const index = new Map(rowOrder.map((p, i) => [p, i]));
  return [...rows].sort((a, b) => {
    const ai = index.get(a.path);
    const bi = index.get(b.path);
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.name.localeCompare(b.name);
  });
}
