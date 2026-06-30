import type { ColumnMeta } from "../../lib/database/fieldTypes";
import { columnLabel } from "../../lib/database/types";
import type { FieldType } from "../../lib/database/viewConfig";

interface Props {
  count: number;
  columns: string[];
  columnMeta: Record<string, ColumnMeta>;
  fieldKey: string;
  value: string;
  clear: boolean;
  busy: boolean;
  onFieldChange: (key: string) => void;
  onValueChange: (value: string) => void;
  onClearChange: (clear: boolean) => void;
  onApply: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

export function BulkEditBar({
  count,
  columns,
  columnMeta,
  fieldKey,
  value,
  clear,
  busy,
  onFieldChange,
  onValueChange,
  onClearChange,
  onApply,
  onDelete,
  onClearSelection,
}: Props) {
  const meta = columnMeta[fieldKey];
  const fieldType: FieldType = meta?.type ?? "text";

  return (
    <div className="db-bulk-bar">
      <span className="db-bulk-count">
        {count} nota{count !== 1 ? "s" : ""} seleccionada{count !== 1 ? "s" : ""}
      </span>
      <select
        className="db-bulk-field"
        value={fieldKey}
        onChange={(e) => onFieldChange(e.target.value)}
      >
        {columns.map((c) => (
          <option key={c} value={c}>
            {columnLabel(c)}
          </option>
        ))}
      </select>
      <label className="db-bulk-clear">
        <input
          type="checkbox"
          checked={clear}
          onChange={(e) => onClearChange(e.target.checked)}
        />
        Limpiar campo
      </label>
      {!clear &&
        (fieldType === "select" ? (
          <select
            className="db-bulk-value"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
          >
            <option value="">—</option>
            {(meta?.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : fieldType === "date" ? (
          <input
            className="db-bulk-value"
            type="date"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
          />
        ) : (
          <input
            className="db-bulk-value"
            type="text"
            placeholder={
              fieldType === "multi_select" ? "valores, separados, por coma" : "Valor…"
            }
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
          />
        ))}
      <button
        type="button"
        className="db-bulk-apply"
        disabled={busy || (!clear && !value.trim())}
        onClick={onApply}
      >
        Aplicar
      </button>
      <button
        type="button"
        className="db-bulk-delete"
        disabled={busy}
        onClick={onDelete}
      >
        Eliminar
      </button>
      <button type="button" className="db-bulk-dismiss" onClick={onClearSelection}>
        ✕
      </button>
    </div>
  );
}
