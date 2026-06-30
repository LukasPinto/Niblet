import { useCallback, useEffect, useRef } from "react";
import type { Block, TableData } from "../../lib/blockParser";
import { normalizeTableRows } from "../../lib/blockParser";

interface Props {
  block: Block;
  onChange: (id: string, table: TableData) => void;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export default function TableBlockView({ block, onChange }: Props) {
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const data = block.table ?? { rows: [["", "", ""], ["", "", ""]], headerRow: true };
  const rows = normalizeTableRows(data.rows);
  const cols = rows[0]?.length ?? 1;
  const headerRow = data.headerRow;
  const canRemoveRow = rows.length > 1;
  const canRemoveCol = cols > 1;

  const emit = useCallback(
    (nextRows: string[][], nextHeader = headerRow) => {
      onChange(block.id, {
        rows: normalizeTableRows(nextRows),
        headerRow: nextHeader,
      });
    },
    [block.id, headerRow, onChange],
  );

  const updateCell = (r: number, c: number, value: string) => {
    const next = rows.map((row, ri) =>
      ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row,
    );
    emit(next);
  };

  const addRow = () => {
    emit([...rows, Array(cols).fill("")]);
  };

  const addCol = () => {
    emit(rows.map((row) => [...row, ""]));
  };

  const removeRow = (index: number) => {
    if (!canRemoveRow) return;
    emit(rows.filter((_, i) => i !== index));
  };

  const removeCol = (index: number) => {
    if (!canRemoveCol) return;
    emit(rows.map((row) => row.filter((_, i) => i !== index)));
  };

  const focusCell = (r: number, c: number) => {
    cellRefs.current.get(`${r}-${c}`)?.focus();
  };

  const onCellKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      let nr = r;
      let nc = c + dir;
      if (nc >= cols) {
        nr += 1;
        nc = 0;
      } else if (nc < 0) {
        nr -= 1;
        nc = cols - 1;
      }
      if (nr >= 0 && nr < rows.length) {
        focusCell(nr, nc);
      } else if (dir > 0 && nr >= rows.length) {
        addRow();
        setTimeout(() => focusCell(rows.length, 0), 0);
      }
    }
  };

  useEffect(() => {
    for (const [key, el] of cellRefs.current.entries()) {
      const [rs, cs] = key.split("-").map(Number);
      const expected = rows[rs]?.[cs] ?? "";
      if (el.textContent !== expected) el.textContent = expected;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const cellEditor = (r: number, c: number) => (
    <div
      className="block-table-cell-edit"
      contentEditable
      suppressContentEditableWarning
      ref={(el) => {
        if (el) cellRefs.current.set(`${r}-${c}`, el);
        else cellRefs.current.delete(`${r}-${c}`);
      }}
      onInput={(e) => updateCell(r, c, e.currentTarget.textContent ?? "")}
      onKeyDown={(e) => onCellKeyDown(e, r, c)}
    />
  );

  return (
    <div className="block block-table">
      <div className="block-table-scroll">
        <table className="block-table-grid">
          {headerRow && rows.length > 0 && (
            <thead>
              <tr>
                {rows[0].map((_, c) => (
                  <th key={c}>
                    <div className="block-table-col-wrap">
                      {canRemoveCol && (
                        <button
                          type="button"
                          className="block-table-del-col"
                          aria-label="Eliminar columna"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => removeCol(c)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                      {cellEditor(0, c)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.slice(headerRow ? 1 : 0).map((_, ri) => {
              const r = ri + (headerRow ? 1 : 0);
              return (
                <tr key={r} className="block-table-row">
                  {rows[r].map((_, c) => (
                    <td key={c}>
                      {c === 0 && canRemoveRow && (
                        <button
                          type="button"
                          className="block-table-del-row"
                          aria-label="Eliminar fila"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => removeRow(r)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                      {cellEditor(r, c)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="block-table-bar">
        <button type="button" className="block-table-bar-btn" onClick={addRow}>
          + Fila
        </button>
        <button type="button" className="block-table-bar-btn" onClick={addCol}>
          + Columna
        </button>
      </div>
    </div>
  );
}
