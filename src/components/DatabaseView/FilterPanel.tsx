import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  filterChipLabel,
  operatorLabel,
  operatorsForColumn,
} from "../../lib/database/filters";
import type { ColumnMeta } from "../../lib/database/fieldTypes";
import { columnLabel, NOTE_COLUMN } from "../../lib/database/types";
import {
  countFilterRules,
  newFilterGroupId,
  type FilterGroup,
  type FilterRule,
} from "../../lib/database/viewConfig";

interface Props {
  columns: string[];
  columnMeta: Record<string, ColumnMeta>;
  filterRoot: FilterGroup;
  onChange: (root: FilterGroup) => void;
}

function newRuleId(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function RuleEditor({
  rule,
  filterableColumns,
  columnMeta,
  onUpdate,
  onRemove,
}: {
  rule: FilterRule;
  filterableColumns: string[];
  columnMeta: Record<string, ColumnMeta>;
  onUpdate: (patch: Partial<FilterRule>) => void;
  onRemove: () => void;
}) {
  const meta = columnMeta[rule.column];
  const ops = operatorsForColumn(rule.column, meta);
  const needsValue = rule.operator !== "is_empty" && rule.operator !== "not_empty";
  const isSelect = meta?.type === "select" && needsValue;
  const isDate = meta?.type === "date" && needsValue;

  return (
    <div className="db-filter-rule">
      <select
        value={rule.column}
        onChange={(e) => onUpdate({ column: e.target.value })}
      >
        {filterableColumns.map((c) => (
          <option key={c} value={c}>
            {columnLabel(c)}
          </option>
        ))}
      </select>
      <select
        value={rule.operator}
        onChange={(e) =>
          onUpdate({ operator: e.target.value as FilterRule["operator"] })
        }
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {operatorLabel(op)}
          </option>
        ))}
      </select>
      {needsValue &&
        (isSelect ? (
          <select value={rule.value} onChange={(e) => onUpdate({ value: e.target.value })}>
            <option value="">—</option>
            {meta.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : isDate ? (
          <input
            type="date"
            value={rule.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
          />
        ) : (
          <input
            type="text"
            value={rule.value}
            placeholder="Valor…"
            onChange={(e) => onUpdate({ value: e.target.value })}
          />
        ))}
      <button type="button" className="db-filter-remove" onClick={onRemove} title="Quitar">
        ×
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  filterableColumns,
  columnMeta,
  onChange,
  depth = 0,
}: {
  group: FilterGroup;
  filterableColumns: string[];
  columnMeta: Record<string, ColumnMeta>;
  onChange: (g: FilterGroup) => void;
  depth?: number;
}) {
  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    onChange({
      ...group,
      rules: group.rules.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (patch.column && patch.column !== r.column) {
          const meta = columnMeta[patch.column];
          const ops = operatorsForColumn(patch.column, meta);
          if (!ops.includes(next.operator)) next.operator = ops[0];
          next.value = "";
        }
        return next;
      }),
    });
  };

  const addRule = () => {
    const col = filterableColumns[0] ?? NOTE_COLUMN;
    const ops = operatorsForColumn(col, columnMeta[col]);
    onChange({
      ...group,
      rules: [
        ...group.rules,
        { id: newRuleId(), column: col, operator: ops[0], value: "" },
      ],
    });
  };

  const addSubgroup = () => {
    if (depth >= 1) return;
    onChange({
      ...group,
      groups: [
        ...(group.groups ?? []),
        { id: newFilterGroupId(), combinator: "or", rules: [], groups: [] },
      ],
    });
  };

  const updateSubgroup = (id: string, sub: FilterGroup) => {
    onChange({
      ...group,
      groups: (group.groups ?? []).map((g) => (g.id === id ? sub : g)),
    });
  };

  const removeSubgroup = (id: string) => {
    onChange({
      ...group,
      groups: (group.groups ?? []).filter((g) => g.id !== id),
    });
  };

  return (
    <div className={`db-filter-group${depth > 0 ? " nested" : ""}`}>
      <div className="db-filter-group-head">
        <span className="db-filter-group-label">
          {depth === 0 ? "Filtros" : "Subgrupo"}
        </span>
        <select
          className="db-filter-combinator"
          value={group.combinator}
          onChange={(e) =>
            onChange({ ...group, combinator: e.target.value as "and" | "or" })
          }
        >
          <option value="and">Y (AND)</option>
          <option value="or">O (OR)</option>
        </select>
      </div>
      {group.rules.length === 0 && (group.groups?.length ?? 0) === 0 && (
        <p className="db-filter-empty muted">Sin filtros activos</p>
      )}
      <div className="db-filter-rules">
        {group.rules.map((rule) => (
          <RuleEditor
            key={rule.id}
            rule={rule}
            filterableColumns={filterableColumns}
            columnMeta={columnMeta}
            onUpdate={(patch) => updateRule(rule.id, patch)}
            onRemove={() =>
              onChange({ ...group, rules: group.rules.filter((r) => r.id !== rule.id) })
            }
          />
        ))}
      </div>
      {(group.groups ?? []).map((sub) => (
        <div key={sub.id} className="db-filter-subgroup-wrap">
          <GroupEditor
            group={sub}
            filterableColumns={filterableColumns}
            columnMeta={columnMeta}
            onChange={(g) => updateSubgroup(sub.id, g)}
            depth={depth + 1}
          />
          <button
            type="button"
            className="db-filter-remove-sub"
            onClick={() => removeSubgroup(sub.id)}
          >
            Quitar subgrupo
          </button>
        </div>
      ))}
      <div className="db-filter-group-actions">
        <button type="button" className="db-filter-add" onClick={addRule}>
          + Regla
        </button>
        {depth < 1 && (
          <button type="button" className="db-filter-add" onClick={addSubgroup}>
            + Subgrupo
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterPanel({ columns, columnMeta, filterRoot, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  const filterableColumns = [NOTE_COLUMN, ...columns];
  const ruleCount = countFilterRules(filterRoot);

  const reposition = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = 400;
    const margin = 8;
    const menuHeight = menu?.offsetHeight ?? 360;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - menuHeight - 4);
    }
    setMenuPos({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    reposition();
  }, [open, ruleCount, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => reposition();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, reposition]);

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="db-filter-panel"
          style={{
            position: "fixed",
            left: menuPos?.left ?? -9999,
            top: menuPos?.top ?? -9999,
            width: menuPos?.width ?? 400,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          <GroupEditor
            group={filterRoot}
            filterableColumns={filterableColumns}
            columnMeta={columnMeta}
            onChange={onChange}
          />
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="db-toolbar-item" ref={rootRef}>
        <button
          ref={btnRef}
          type="button"
          className="db-toolbar-btn"
          onClick={() => setOpen((v) => !v)}
        >
          Filtro
          {ruleCount > 0 && <span className="db-toolbar-badge">{ruleCount}</span>}
        </button>
      </div>
      {menu}
    </>
  );
}

export { filterChipLabel };
