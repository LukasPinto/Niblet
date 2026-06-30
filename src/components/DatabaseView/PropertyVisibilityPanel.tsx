import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ColumnMeta } from "../../lib/database/fieldTypes";
import { fieldTypeIcon, fieldTypeLabel } from "../../lib/database/fieldTypes";
import { columnLabel } from "../../lib/database/types";
import type { FieldType } from "../../lib/database/viewConfig";

interface Props {
  columns: string[];
  columnMeta: Record<string, ColumnMeta>;
  columnOrder: string[];
  hiddenColumns: string[];
  fieldTypeOverrides: Record<string, FieldType>;
  onReorder: (order: string[]) => void;
  onToggleHidden: (key: string, hidden: boolean) => void;
  onTypeOverride: (key: string, type: FieldType | "auto") => void;
  onHideAll: () => void;
  onShowAll: () => void;
}

export function PropertyVisibilityPanel({
  columns,
  columnMeta,
  columnOrder,
  hiddenColumns,
  fieldTypeOverrides,
  onReorder,
  onToggleHidden,
  onTypeOverride,
  onHideAll,
  onShowAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  const ordered = useMemoOrder(columns, columnOrder);
  const hiddenSet = new Set(hiddenColumns);
  const filtered = ordered.filter((c) =>
    columnLabel(c).toLowerCase().includes(query.trim().toLowerCase()),
  );

  const reposition = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = 300;
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
  }, [open, query, filtered.length, reposition]);

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

  const finishDrag = (from: number, to: number) => {
    if (from === to) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="db-prop-panel"
          style={{
            position: "fixed",
            left: menuPos?.left ?? -9999,
            top: menuPos?.top ?? -9999,
            width: menuPos?.width ?? 300,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          <div className="db-prop-head">Mostradas en tabla</div>
          <input
            className="db-prop-search"
            type="text"
            placeholder="Buscar propiedad…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="db-prop-actions">
            <button type="button" onClick={onHideAll}>
              Ocultar todas
            </button>
            <button type="button" onClick={onShowAll}>
              Mostrar todas
            </button>
          </div>
          <div className="db-prop-list">
            {filtered.map((key) => {
              const idx = ordered.indexOf(key);
              const meta = columnMeta[key];
              const visible = !hiddenSet.has(key);
              return (
                <div
                  key={key}
                  className={`db-prop-item${dragIdx === idx ? " dragging" : ""}${dropIdx === idx ? " drop-target" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropIdx(idx);
                  }}
                  onDragLeave={() => setDropIdx(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx != null) finishDrag(dragIdx, idx);
                    setDragIdx(null);
                    setDropIdx(null);
                  }}
                >
                  <span
                    className="db-prop-drag"
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDropIdx(null);
                    }}
                  >
                    ⠿
                  </span>
                  <span className="db-prop-type">{fieldTypeIcon(meta?.type ?? "text")}</span>
                  <span className="db-prop-name">{columnLabel(key)}</span>
                  <select
                    className="db-prop-type-select"
                    value={fieldTypeOverrides[key] ?? "auto"}
                    onChange={(e) =>
                      onTypeOverride(key, e.target.value as FieldType | "auto")
                    }
                    title="Tipo de propiedad"
                  >
                    {(["auto", "text", "select", "multi_select", "date"] as const).map(
                      (t) => (
                        <option key={t} value={t}>
                          {fieldTypeLabel(t)}
                        </option>
                      ),
                    )}
                  </select>
                  <button
                    type="button"
                    className={`db-prop-eye${visible ? "" : " off"}`}
                    title={visible ? "Ocultar" : "Mostrar"}
                    onClick={() => onToggleHidden(key, visible)}
                  >
                    {visible ? "👁" : "👁‍🗨"}
                  </button>
                </div>
              );
            })}
          </div>
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
          ⚙ Propiedades
        </button>
      </div>
      {menu}
    </>
  );
}

function useMemoOrder(columns: string[], columnOrder: string[]): string[] {
  const known = columnOrder.filter((c) => columns.includes(c));
  const rest = columns.filter((c) => !known.includes(c));
  return [...known, ...rest];
}
