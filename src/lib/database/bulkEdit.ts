import {
  parseFrontmatter,
  stringifyFrontmatter,
  type Frontmatter,
} from "../markdown";
import type { ColumnMeta } from "./fieldTypes";
import { parseMultiSelectValue } from "./fieldTypes";
import type { DatabaseRow } from "./types";
import { dateToInputValue } from "./dates";
import type { FieldType } from "./viewConfig";

export function valueForBulkWrite(
  raw: string,
  fieldType: FieldType,
  clear: boolean,
): Frontmatter[string] | undefined {
  if (clear) return undefined;
  const trimmed = raw.trim();
  if (fieldType === "multi_select") {
    return parseMultiSelectValue(trimmed || raw);
  }
  return trimmed;
}

export async function applyBulkFieldUpdate(
  rows: DatabaseRow[],
  paths: Set<string>,
  key: string,
  value: string,
  fieldType: FieldType,
  clear: boolean,
  write: (path: string, content: string) => Promise<void>,
): Promise<DatabaseRow[]> {
  const nextRows = [...rows];
  for (let i = 0; i < nextRows.length; i++) {
    const row = nextRows[i];
    if (!paths.has(row.path)) continue;

    const newData: Frontmatter = { ...row.data };
    const written = valueForBulkWrite(value, fieldType, clear);
    if (written === undefined) {
      delete newData[key];
    } else {
      newData[key] = written;
    }

    const { content } = parseFrontmatter(row.raw);
    const updated = stringifyFrontmatter(newData, content);
    await write(row.path, updated);
    nextRows[i] = { ...row, raw: updated, data: newData };
  }
  return nextRows;
}

export function commitCellValue(
  key: string,
  draft: string,
  fieldType: FieldType,
  existing: Frontmatter,
): Frontmatter {
  const newData: Frontmatter = { ...existing };
  const normalized = draft.replace(/^\s+|\s+$/g, "");
  if (normalized === "") {
    delete newData[key];
  } else if (fieldType === "multi_select") {
    newData[key] = parseMultiSelectValue(draft);
  } else {
    newData[key] = normalized;
  }
  return newData;
}

export function draftFromCell(
  key: string,
  data: Frontmatter,
  fieldType: FieldType,
): string {
  const v = data[key];
  if (fieldType === "date") return dateToInputValue(v);
  if (fieldType === "multi_select") {
    return parseMultiSelectValue(v).join(", ");
  }
  if (Array.isArray(v)) return v.join(", ");
  return v != null ? String(v) : "";
}

export function getFieldTypeForKey(
  key: string,
  columnMeta: Record<string, ColumnMeta>,
): FieldType {
  return columnMeta[key]?.type ?? "text";
}
