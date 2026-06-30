import { displayValue } from "../markdown";
import { parseDateValue, startOfDay } from "./dates";
import type { ColumnMeta } from "./fieldTypes";
import { parseMultiSelectValue } from "./fieldTypes";
import { NOTE_COLUMN } from "./types";
import type { DatabaseRow } from "./types";
import type { FilterGroup, FilterRule, SortState } from "./viewConfig";
import { columnLabel } from "./types";

function cellText(row: DatabaseRow, column: string): string {
  if (column === NOTE_COLUMN) return row.name;
  return displayValue(row.data[column]);
}

function cellTags(row: DatabaseRow, column: string): string[] {
  return parseMultiSelectValue(row.data[column]);
}

function isEmpty(row: DatabaseRow, column: string, meta?: ColumnMeta): boolean {
  if (column === NOTE_COLUMN) return !row.name.trim();
  const v = row.data[column];
  if (v == null || v === "") return true;
  if (meta?.type === "multi_select") return cellTags(row, column).length === 0;
  if (meta?.type === "date") return parseDateValue(v) === null;
  return !cellText(row, column).trim();
}

function matchDateRule(
  row: DatabaseRow,
  column: string,
  op: FilterRule["operator"],
  value: string,
): boolean {
  const cell = parseDateValue(row.data[column]);
  if (op === "is_empty") return cell === null;
  if (op === "not_empty") return cell !== null;
  const filter = parseDateValue(value);
  if (!filter || !cell) return false;
  const ct = startOfDay(cell);
  const ft = startOfDay(filter);
  if (op === "on") return ct === ft;
  if (op === "before") return ct < ft;
  if (op === "after") return ct > ft;
  return true;
}

function matchRule(
  row: DatabaseRow,
  rule: FilterRule,
  columnMeta: Record<string, ColumnMeta>,
): boolean {
  const meta = columnMeta[rule.column];
  const op = rule.operator;
  const val = rule.value.trim().toLowerCase();

  if (op === "is_empty") return isEmpty(row, rule.column, meta);
  if (op === "not_empty") return !isEmpty(row, rule.column, meta);

  if (meta?.type === "date") {
    return matchDateRule(row, rule.column, op, rule.value);
  }

  if (rule.column === NOTE_COLUMN || meta?.type === "text" || !meta) {
    const text = cellText(row, rule.column).toLowerCase();
    if (op === "contains") return text.includes(val);
    if (op === "not_contains") return !text.includes(val);
    return true;
  }

  if (meta.type === "select") {
    const text = cellText(row, rule.column).toLowerCase();
    if (op === "is") return text === val;
    if (op === "is_not") return text !== val;
    return true;
  }

  if (meta.type === "multi_select") {
    const tags = cellTags(row, rule.column).map((t) => t.toLowerCase());
    if (op === "contains") return tags.some((t) => t.includes(val) || val.includes(t));
    if (op === "not_contains") return !tags.some((t) => t.includes(val) || val.includes(t));
    return true;
  }

  return true;
}

function matchGroup(
  row: DatabaseRow,
  group: FilterGroup,
  columnMeta: Record<string, ColumnMeta>,
): boolean {
  const parts: boolean[] = [];
  for (const rule of group.rules) {
    parts.push(matchRule(row, rule, columnMeta));
  }
  for (const sub of group.groups ?? []) {
    parts.push(matchGroup(row, sub, columnMeta));
  }
  if (parts.length === 0) return true;
  return group.combinator === "or"
    ? parts.some(Boolean)
    : parts.every(Boolean);
}

export function applyFilters(
  rows: DatabaseRow[],
  filterRoot: FilterGroup,
  columnMeta: Record<string, ColumnMeta>,
): DatabaseRow[] {
  const hasRules =
    filterRoot.rules.length > 0 || (filterRoot.groups?.length ?? 0) > 0;
  if (!hasRules) return rows;
  return rows.filter((row) => matchGroup(row, filterRoot, columnMeta));
}

function sortValue(row: DatabaseRow, key: string, meta?: ColumnMeta): string {
  if (key === NOTE_COLUMN) return row.name;
  const v = row.data[key];
  if (meta?.type === "date") {
    const d = parseDateValue(v);
    return d ? String(d.getTime()).padStart(16, "0") : "";
  }
  if (Array.isArray(v)) return v.join(", ");
  return displayValue(v);
}

export function applySort(
  rows: DatabaseRow[],
  sort: SortState,
  columnMeta: Record<string, ColumnMeta>,
): DatabaseRow[] {
  if (!sort.key || !sort.dir) return rows;
  const key = sort.key;
  const meta = columnMeta[key];
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key, meta).toLowerCase();
    const bv = sortValue(b, key, meta).toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export function nextSortState(
  current: SortState,
  column: string,
): SortState {
  if (current.key !== column) return { key: column, dir: "asc" };
  if (current.dir === "asc") return { key: column, dir: "desc" };
  return { key: null, dir: null };
}

export function operatorsForColumn(
  column: string,
  meta?: ColumnMeta,
): FilterRule["operator"][] {
  if (column === NOTE_COLUMN) {
    return ["contains", "not_contains", "is_empty", "not_empty"];
  }
  if (meta?.type === "date") {
    return ["on", "before", "after", "is_empty", "not_empty"];
  }
  if (!meta || meta.type === "text") {
    return ["contains", "not_contains", "is_empty", "not_empty"];
  }
  if (meta.type === "select") {
    return ["is", "is_not", "is_empty", "not_empty"];
  }
  return ["contains", "not_contains", "is_empty"];
}

export function operatorLabel(op: FilterRule["operator"]): string {
  const labels: Record<FilterRule["operator"], string> = {
    contains: "contiene",
    not_contains: "no contiene",
    is_empty: "está vacío",
    not_empty: "no está vacío",
    is: "es",
    is_not: "no es",
    on: "es",
    before: "antes de",
    after: "después de",
  };
  return labels[op];
}

export function filterChipLabel(
  rule: FilterRule,
  meta?: ColumnMeta,
): string {
  const col = columnLabel(rule.column);
  const op = operatorLabel(rule.operator);
  if (rule.operator === "is_empty" || rule.operator === "not_empty") {
    return `${col} ${op}`;
  }
  if (meta?.type === "date" && rule.value) {
    return `${col} ${op} ${rule.value}`;
  }
  return `${col} ${op}${rule.value ? ` ${rule.value}` : ""}`;
}

export function filterGroupChipLabel(group: FilterGroup, depth = 0): string[] {
  const labels: string[] = [];
  for (const r of group.rules) labels.push(filterChipLabel(r));
  for (const sub of group.groups ?? []) {
    const subLabels = filterGroupChipLabel(sub, depth + 1);
    if (subLabels.length > 0) {
      labels.push(`(${sub.combinator.toUpperCase()}: ${subLabels.join(", ")})`);
    }
  }
  return labels;
}
