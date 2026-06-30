import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PALETTE_INDICES, tagColorClass } from "../../lib/database/tagColors";

interface Props {
  tags: string[];
  tagColors: Record<string, number>;
  onChange: (tag: string, index: number | null) => void;
}

export function TagColorsPanel({ tags, tagColors, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  const reposition = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = 320;
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
  }, [open, tags.length, reposition]);

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

  const overrideCount = Object.keys(tagColors).length;

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="db-tag-colors-panel"
          style={{
            position: "fixed",
            left: menuPos?.left ?? -9999,
            top: menuPos?.top ?? -9999,
            width: menuPos?.width ?? 320,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          <div className="db-tag-colors-head">Colores de tags</div>
          <p className="db-tag-colors-hint muted">
            También puedes clic derecho o el botón ○ en una pill de la tabla.
          </p>
          {tags.length === 0 ? (
            <p className="db-tag-colors-empty muted">No hay tags en esta vista.</p>
          ) : (
            <ul className="db-tag-colors-list">
              {tags.map((tag) => {
                const current = tagColors[tag];
                return (
                  <li key={tag} className="db-tag-colors-row">
                    <span className={tagColorClass(tag, tagColors)}>{tag}</span>
                    <div className="db-tag-colors-swatches">
                      {PALETTE_INDICES.map((i) => (
                        <button
                          key={i}
                          type="button"
                          className={`db-tag-color-swatch${current === i ? " sel" : ""}`}
                          title={`Color ${i + 1}`}
                          onClick={() => onChange(tag, i)}
                        >
                          <span
                            className={tagColorClass(`preview-${i}`, {
                              [`preview-${i}`]: i,
                            })}
                          />
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`db-tag-color-auto-sm${current === undefined ? " sel" : ""}`}
                        title="Automático"
                        onClick={() => onChange(tag, null)}
                      >
                        A
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
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
          Colores
          {overrideCount > 0 && (
            <span className="db-toolbar-badge">{overrideCount}</span>
          )}
        </button>
      </div>
      {menu}
    </>
  );
}
