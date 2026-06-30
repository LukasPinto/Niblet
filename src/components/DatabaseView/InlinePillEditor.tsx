import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  anchor: DOMRect;
  options: string[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function InlinePillEditor({ anchor, options, value, onSelect, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    let left = anchor.left;
    let top = anchor.bottom + 4;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - rect.height - 4);
    }
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="db-inline-pill-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`db-inline-pill-opt${opt === value ? " sel" : ""}`}
          onClick={() => {
            onSelect(opt);
            onClose();
          }}
        >
          {opt}
        </button>
      ))}
    </div>,
    document.body,
  );
}
