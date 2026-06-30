import {
  CHECK_COL_WIDTH,
  CHECK_COLUMN,
  DEFAULT_COL_WIDTH,
  DRAG_COL_WIDTH,
  DRAG_COLUMN,
  NOTE_COL_WIDTH,
  NOTE_COLUMN,
  TASKS_COL_WIDTH,
  TASKS_COLUMN,
} from "./types";

export function displayColumnKeys(visibleMetaColumns: string[]): string[] {
  return [
    DRAG_COLUMN,
    CHECK_COLUMN,
    NOTE_COLUMN,
    ...visibleMetaColumns,
    TASKS_COLUMN,
  ];
}

export function columnDefaultWidth(key: string): number {
  if (key === DRAG_COLUMN) return DRAG_COL_WIDTH;
  if (key === CHECK_COLUMN) return CHECK_COL_WIDTH;
  if (key === NOTE_COLUMN) return NOTE_COL_WIDTH;
  if (key === TASKS_COLUMN) return TASKS_COL_WIDTH;
  return DEFAULT_COL_WIDTH;
}

export function freezeColumnIndex(
  freezeUntil: string | null,
  visibleMetaColumns: string[],
): number {
  if (!freezeUntil) return -1;
  return displayColumnKeys(visibleMetaColumns).indexOf(freezeUntil);
}

export function isColumnFrozen(
  column: string,
  freezeUntil: string | null,
  visibleMetaColumns: string[],
): boolean {
  const untilIdx = freezeColumnIndex(freezeUntil, visibleMetaColumns);
  if (untilIdx < 0) return false;
  const colIdx = displayColumnKeys(visibleMetaColumns).indexOf(column);
  return colIdx >= 0 && colIdx <= untilIdx;
}

export function freezeLeftOffset(
  column: string,
  freezeUntil: string | null,
  visibleMetaColumns: string[],
  widthFor: (key: string) => number,
): number {
  if (!isColumnFrozen(column, freezeUntil, visibleMetaColumns)) return 0;
  let left = 0;
  for (const key of displayColumnKeys(visibleMetaColumns)) {
    if (key === column) break;
    left += widthFor(key);
  }
  return left;
}

export function previousFreezeColumn(
  column: string,
  visibleMetaColumns: string[],
): string | null {
  const cols = displayColumnKeys(visibleMetaColumns);
  const idx = cols.indexOf(column);
  if (idx <= 0) return null;
  return cols[idx - 1] ?? null;
}

export function canInsertLeft(column: string): boolean {
  if (column === DRAG_COLUMN || column === CHECK_COLUMN || column === NOTE_COLUMN) {
    return false;
  }
  return true;
}

export function canInsertRight(column: string): boolean {
  if (column === DRAG_COLUMN || column === CHECK_COLUMN || column === TASKS_COLUMN) {
    return false;
  }
  return true;
}

export function canHideColumn(column: string): boolean {
  if (
    column === DRAG_COLUMN ||
    column === CHECK_COLUMN ||
    column === NOTE_COLUMN ||
    column === TASKS_COLUMN
  ) {
    return false;
  }
  return true;
}

export function sanitizePropertyName(name: string): string {
  return name.trim().replace(/\s+/g, "_").replace(/[^\w\u00C0-\u024F-]/g, "");
}

export function insertColumnInOrder(
  order: string[],
  allMetaKeys: string[],
  refColumn: string,
  side: "left" | "right",
  newKey: string,
): string[] {
  const withoutNew = order.filter((k) => k !== newKey);
  const effective = [
    ...withoutNew.filter((k) => allMetaKeys.includes(k)),
    ...allMetaKeys.filter((k) => !withoutNew.includes(k)),
  ];

  if (refColumn === NOTE_COLUMN && side === "right") {
    return [newKey, ...withoutNew];
  }
  if (refColumn === TASKS_COLUMN && side === "left") {
    return [...withoutNew, newKey];
  }

  const orderIdx = withoutNew.indexOf(refColumn);
  if (orderIdx >= 0) {
    const next = [...withoutNew];
    next.splice(side === "left" ? orderIdx : orderIdx + 1, 0, newKey);
    return next;
  }

  const metaIdx = effective.indexOf(refColumn);
  if (metaIdx < 0) {
    return side === "left" ? [newKey, ...withoutNew] : [...withoutNew, newKey];
  }
  const next = [...effective];
  next.splice(side === "left" ? metaIdx : metaIdx + 1, 0, newKey);
  return next;
}
