import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FieldType } from "../../lib/database/viewConfig";

export interface EditAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  anchor: EditAnchor;
  fieldType: FieldType;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function DbCellEditor({
  anchor,
  fieldType,
  value,
  options,
  onChange,
  onCommit,
  onCancel,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.top, width: 0 });
  const [otherInput, setOtherInput] = useState("");

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const margin = 8;
    const width = Math.max(anchor.width, 280);
    pop.style.width = `${width}px`;
    pop.style.minHeight = "";

    if (fieldType === "text" && areaRef.current) {
      const area = areaRef.current;
      const maxH = Math.min(window.innerHeight * 0.55, 360);
      const minH = Math.max(anchor.height, 96);
      area.style.height = "0";
      area.style.height = `${Math.min(Math.max(area.scrollHeight, minH), maxH)}px`;
    }

    let left = anchor.left;
    let top = anchor.top;
    const rect = pop.getBoundingClientRect();

    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top, width });
    areaRef.current?.focus();
  }, [anchor, fieldType, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) onCommit();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCommit, onCancel]);

  const selectedMulti = new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const toggleMulti = (opt: string) => {
    const next = new Set(selectedMulti);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange([...next].join(", "));
  };

  const addMultiOther = () => {
    const t = otherInput.trim();
    if (!t) return;
    const next = new Set(selectedMulti);
    next.add(t);
    onChange([...next].join(", "));
    setOtherInput("");
  };

  const body =
    fieldType === "select" ? (
      <div className="db-cell-editor-select">
        <div className="db-cell-editor-options">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`db-cell-editor-opt${value.trim() === opt ? " sel" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
        <div className="db-cell-editor-other">
          <input
            type="text"
            placeholder="Otro valor…"
            value={otherInput}
            onChange={(e) => setOtherInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onChange(otherInput.trim());
              }
            }}
          />
          <button type="button" onClick={() => onChange(otherInput.trim())}>
            OK
          </button>
        </div>
      </div>
    ) : fieldType === "multi_select" ? (
      <div className="db-cell-editor-multi">
        <div className="db-cell-editor-pills">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`db-cell-editor-pill${selectedMulti.has(opt) ? " sel" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggleMulti(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
        <div className="db-cell-editor-other">
          <input
            type="text"
            placeholder="Añadir…"
            value={otherInput}
            onChange={(e) => setOtherInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMultiOther();
              }
            }}
          />
          <button type="button" onClick={addMultiOther}>
            +
          </button>
        </div>
      </div>
    ) : fieldType === "date" ? (
      <input
        ref={areaRef as unknown as React.RefObject<HTMLInputElement>}
        type="date"
        className="db-cell-edit db-cell-date-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
      />
    ) : (
      <textarea
        ref={areaRef}
        className="db-cell-edit"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onCommit();
          }
        }}
      />
    );

  return createPortal(
    <div
      ref={popRef}
      className="db-cell-popover"
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width || Math.max(anchor.width, 280),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {body}
    </div>,
    document.body,
  );
}
