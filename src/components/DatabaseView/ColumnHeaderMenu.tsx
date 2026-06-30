import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { columnLabel } from "../../lib/database/types";
import type { SortState } from "../../lib/database/viewConfig";

type MenuMode = "main" | "insert";

interface Props {
  column: string;
  anchorRect: DOMRect;
  sort: SortState;
  isFrozen: boolean;
  canInsertLeft: boolean;
  canInsertRight: boolean;
  canHide: boolean;
  onClose: () => void;
  onSort: (dir: "asc" | "desc" | null) => void;
  onFreeze: () => void;
  onUnfreeze: () => void;
  onHide: () => void;
  onInsert: (side: "left" | "right", name: string) => void;
}

export function ColumnHeaderMenu({
  column,
  anchorRect,
  sort,
  isFrozen,
  canInsertLeft,
  canInsertRight,
  canHide,
  onClose,
  onSort,
  onFreeze,
  onUnfreeze,
  onHide,
  onInsert,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<MenuMode>("main");
  const [insertSide, setInsertSide] = useState<"left" | "right">("right");
  const [name, setName] = useState("");

  const sortedHere = sort.key === column && sort.dir;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (mode === "insert") setTimeout(() => inputRef.current?.focus(), 20);
  }, [mode]);

  const width = 220;
  const left = Math.min(anchorRect.left, window.innerWidth - width - 8);
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 280);

  const startInsert = (side: "left" | "right") => {
    setInsertSide(side);
    setName("");
    setMode("insert");
  };

  const submitInsert = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onInsert(insertSide, trimmed);
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="db-col-menu"
      style={{ left, top, width }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="db-col-menu-head">{columnLabel(column)}</div>
      {mode === "insert" ? (
        <div className="db-col-menu-naming">
          <p className="db-col-menu-hint">
            Insertar a la {insertSide === "left" ? "izquierda" : "derecha"}
          </p>
          <input
            ref={inputRef}
            className="db-col-menu-input"
            placeholder="Nombre de la propiedad…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitInsert();
              if (e.key === "Escape") setMode("main");
            }}
          />
          <div className="db-col-menu-naming-actions">
            <button type="button" className="db-col-menu-btn-action" onClick={() => setMode("main")}>
              Atrás
            </button>
            <button
              type="button"
              className="db-col-menu-btn-action primary"
              onClick={submitInsert}
              disabled={!name.trim()}
            >
              Crear
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`db-col-menu-item${sort.dir === "asc" && sortedHere ? " active" : ""}`}
            onClick={() => {
              onSort("asc");
              onClose();
            }}
          >
            <span className="db-col-menu-ico">↑</span>
            Ordenar ascendente
          </button>
          <button
            type="button"
            className={`db-col-menu-item${sort.dir === "desc" && sortedHere ? " active" : ""}`}
            onClick={() => {
              onSort("desc");
              onClose();
            }}
          >
            <span className="db-col-menu-ico">↓</span>
            Ordenar descendente
          </button>
          {sortedHere && (
            <button
              type="button"
              className="db-col-menu-item"
              onClick={() => {
                onSort(null);
                onClose();
              }}
            >
              <span className="db-col-menu-ico">×</span>
              Quitar orden
            </button>
          )}
          <hr className="db-col-menu-sep" />
          {isFrozen ? (
            <button
              type="button"
              className="db-col-menu-item"
              onClick={() => {
                onUnfreeze();
                onClose();
              }}
            >
              <span className="db-col-menu-ico">📌</span>
              Descongelar
            </button>
          ) : (
            <button
              type="button"
              className="db-col-menu-item"
              onClick={() => {
                onFreeze();
                onClose();
              }}
            >
              <span className="db-col-menu-ico">📌</span>
              Congelar
            </button>
          )}
          {canHide && (
            <>
              <hr className="db-col-menu-sep" />
              <button
                type="button"
                className="db-col-menu-item"
                onClick={() => {
                  onHide();
                  onClose();
                }}
              >
                <span className="db-col-menu-ico">👁</span>
                Ocultar
              </button>
            </>
          )}
          {(canInsertLeft || canInsertRight) && <hr className="db-col-menu-sep" />}
          {canInsertLeft && (
            <button
              type="button"
              className="db-col-menu-item"
              onClick={() => startInsert("left")}
            >
              <span className="db-col-menu-ico">←</span>
              Insertar a la izquierda
            </button>
          )}
          {canInsertRight && (
            <button
              type="button"
              className="db-col-menu-item"
              onClick={() => startInsert("right")}
            >
              <span className="db-col-menu-ico">→</span>
              Insertar a la derecha
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
