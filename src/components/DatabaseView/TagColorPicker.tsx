import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PALETTE_INDICES, tagColorClass } from "../../lib/database/tagColors";

interface Props {
  anchor: DOMRect;
  tag: string;
  currentIndex: number | undefined;
  onPick: (index: number | null) => void;
  onClose: () => void;
}

export function TagColorPicker({ anchor, tag, currentIndex, onPick, onClose }: Props) {
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
      className="db-tag-color-picker"
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="db-tag-color-head">Color: {tag}</div>
      <div className="db-tag-color-swatches">
        {PALETTE_INDICES.map((i) => (
          <button
            key={i}
            type="button"
            className={`db-tag-color-swatch${currentIndex === i ? " sel" : ""}`}
            onClick={() => {
              onPick(i);
              onClose();
            }}
          >
            <span className={tagColorClass(`preview-${i}`, { [`preview-${i}`]: i })}>
              {i + 1}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="db-tag-color-auto"
        onClick={() => {
          onPick(null);
          onClose();
        }}
      >
        Automático
      </button>
    </div>,
    document.body,
  );
}
