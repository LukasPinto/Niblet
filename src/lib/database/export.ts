import { displayValue } from "../markdown";
import type { ColumnMeta } from "./fieldTypes";
import { NOTE_COLUMN } from "./types";
import type { DatabaseRow } from "./types";
import { columnLabel } from "./types";

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cellExportValue(row: DatabaseRow, column: string): string {
  if (column === NOTE_COLUMN) return row.name;
  return displayValue(row.data[column]);
}

export function exportRowsToCsv(
  rows: DatabaseRow[],
  columns: string[],
  _columnMeta: Record<string, ColumnMeta>,
): string {
  const cols = [NOTE_COLUMN, ...columns];
  const header = cols.map((c) => escapeCsvCell(columnLabel(c))).join(",");
  const body = rows
    .map((row) =>
      cols.map((c) => escapeCsvCell(cellExportValue(row, c))).join(","),
    )
    .join("\n");
  return `\uFEFF${header}\n${body}`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
