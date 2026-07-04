import { Calendar, ChevronDown, List, Type, type LucideIcon } from "lucide-react";
import type { FrontmatterValue } from "../markdown";
import { isDateLikeValue } from "./dates";
import type { DatabaseRow } from "./types";
import type { FieldType } from "./viewConfig";

export interface ColumnMeta {
  key: string;
  type: FieldType;
  options: string[];
}

const SELECT_MAX_UNIQUE = 12;
const SELECT_MAX_RATIO = 0.5;
const DATE_KEY_HINTS = new Set(["fecha", "date", "due", "scheduled"]);

export function parseMultiSelectValue(
  value: FrontmatterValue | undefined,
): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).replace(/^#/, "").trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((s) => s.replace(/^#/, "").trim())
    .filter(Boolean);
}

function collectStringValues(values: FrontmatterValue[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (Array.isArray(v)) out.push(...v.map(String));
    else if (v != null && v !== "") out.push(String(v));
  }
  return out;
}

function inferDateColumn(key: string, rows: DatabaseRow[]): boolean {
  if (DATE_KEY_HINTS.has(key.toLowerCase())) return true;
  const values = rows
    .map((r) => r.data[key])
    .filter((v) => v != null && v !== "");
  if (values.length === 0) return false;
  const dateCount = values.filter((v) => isDateLikeValue(v)).length;
  return dateCount / values.length >= 0.8;
}

export function inferColumnMeta(key: string, rows: DatabaseRow[]): ColumnMeta {
  const values = rows
    .map((r) => r.data[key])
    .filter((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));

  if (inferDateColumn(key, rows)) {
    return { key, type: "date", options: [] };
  }

  if (key === "tags") {
    const options = new Set<string>();
    for (const r of rows) {
      for (const t of parseMultiSelectValue(r.data[key])) options.add(t);
    }
    return { key, type: "multi_select", options: [...options].sort() };
  }

  const arrayCount = values.filter((v) => Array.isArray(v)).length;
  if (values.length > 0 && arrayCount / values.length >= 0.5) {
    const options = new Set<string>();
    for (const r of rows) {
      for (const t of parseMultiSelectValue(r.data[key])) options.add(t);
    }
    return { key, type: "multi_select", options: [...options].sort() };
  }

  const strings = collectStringValues(values);
  const unique = new Set(strings);
  if (
    unique.size > 0 &&
    unique.size <= SELECT_MAX_UNIQUE &&
    strings.length >= 2 &&
    unique.size / strings.length <= SELECT_MAX_RATIO
  ) {
    return { key, type: "select", options: [...unique].sort() };
  }

  return { key, type: "text", options: [] };
}

export function getEffectiveColumnMeta(
  key: string,
  rows: DatabaseRow[],
  overrides: Record<string, FieldType>,
): ColumnMeta {
  const override = overrides[key];
  const inferred = inferColumnMeta(key, rows);
  if (!override) return inferred;

  if (override === inferred.type) return inferred;
  if (override === "select" || override === "multi_select") {
    return { key, type: override, options: inferred.options };
  }
  return { key, type: override, options: [] };
}

export function inferAllColumnMeta(
  keys: string[],
  rows: DatabaseRow[],
  overrides: Record<string, FieldType> = {},
): Record<string, ColumnMeta> {
  const meta: Record<string, ColumnMeta> = {};
  for (const key of keys) meta[key] = getEffectiveColumnMeta(key, rows, overrides);
  return meta;
}

/** Componente de icono (lucide) para cada tipo de campo. */
export function fieldTypeIcon(type: FieldType): LucideIcon {
  switch (type) {
    case "select":
      return ChevronDown;
    case "multi_select":
      return List;
    case "date":
      return Calendar;
    default:
      return Type;
  }
}

export function fieldTypeLabel(type: FieldType | "auto"): string {
  switch (type) {
    case "auto":
      return "Auto";
    case "select":
      return "Select";
    case "multi_select":
      return "Multi";
    case "date":
      return "Fecha";
    default:
      return "Texto";
  }
}
