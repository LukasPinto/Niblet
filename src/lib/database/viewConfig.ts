export type FieldType = "text" | "select" | "multi_select" | "date";

export type TextFilterOp = "contains" | "not_contains" | "is_empty" | "not_empty";
export type SelectFilterOp = "is" | "is_not" | "is_empty" | "not_empty";
export type MultiSelectFilterOp = "contains" | "not_contains" | "is_empty";
export type DateFilterOp = "before" | "after" | "on" | "is_empty" | "not_empty";
export type FilterOperator =
  | TextFilterOp
  | SelectFilterOp
  | MultiSelectFilterOp
  | DateFilterOp;

export interface FilterRule {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  id: string;
  combinator: "and" | "or";
  rules: FilterRule[];
  groups?: FilterGroup[];
}

export interface SortState {
  key: string | null;
  dir: "asc" | "desc" | null;
}

export type FieldTypeOverride = FieldType | "auto";

export interface DatabaseViewConfig {
  columnOrder: string[];
  hiddenColumns: string[];
  columnWidths: Record<string, number>;
  filterRoot: FilterGroup;
  sort: SortState;
  rowOrder: string[];
  fieldTypeOverrides: Record<string, FieldType>;
  tagColors: Record<string, number>;
  /** Rightmost frozen column in display order (inclusive). */
  freezeUntil: string | null;
}

export interface DatabaseViewsFile {
  views: Record<string, DatabaseViewConfig>;
}

export { DB_VIEWS_REL } from "../vaultPaths";

export function newFilterGroupId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultFilterRoot(): FilterGroup {
  return { id: newFilterGroupId(), combinator: "and", rules: [], groups: [] };
}

export function defaultViewConfig(): DatabaseViewConfig {
  return {
    columnOrder: [],
    hiddenColumns: [],
    columnWidths: {},
    filterRoot: defaultFilterRoot(),
    sort: { key: null, dir: null },
    rowOrder: [],
    fieldTypeOverrides: {},
    tagColors: {},
    freezeUntil: null,
  };
}

export function mergeViewConfig(
  stored: Partial<DatabaseViewConfig> | undefined,
): DatabaseViewConfig {
  const base = defaultViewConfig();
  if (!stored) return base;
  return {
    columnOrder: stored.columnOrder ?? base.columnOrder,
    hiddenColumns: stored.hiddenColumns ?? base.hiddenColumns,
    columnWidths: stored.columnWidths ?? base.columnWidths,
    filterRoot: stored.filterRoot
      ? { ...stored.filterRoot, groups: stored.filterRoot.groups ?? [] }
      : base.filterRoot,
    sort: stored.sort ?? base.sort,
    rowOrder: stored.rowOrder ?? base.rowOrder,
    fieldTypeOverrides: stored.fieldTypeOverrides ?? base.fieldTypeOverrides,
    tagColors: stored.tagColors ?? base.tagColors,
    freezeUntil: stored.freezeUntil ?? base.freezeUntil,
  };
}

export function countFilterRules(root: FilterGroup): number {
  let n = root.rules.length;
  for (const g of root.groups ?? []) n += countFilterRules(g);
  return n;
}

export function flattenFilterRules(root: FilterGroup): FilterRule[] {
  const out = [...root.rules];
  for (const g of root.groups ?? []) out.push(...flattenFilterRules(g));
  return out;
}
