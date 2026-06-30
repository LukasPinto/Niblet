import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CODE_LANGUAGE_OPTIONS,
  codeLanguageLabel,
} from "../../lib/codeLanguages";

interface Props {
  value: string;
  onChange: (language: string) => void;
}

interface MenuPos {
  left: number;
  top: number;
  width: number;
}

function computeMenuPos(btn: HTMLElement, menu: HTMLElement | null): MenuPos {
  const rect = btn.getBoundingClientRect();
  const width = Math.max(260, rect.width);
  const margin = 8;
  const menuHeight = Math.max(menu?.offsetHeight ?? 0, 220);

  let left = rect.left;
  if (left + width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - width - margin);
  }
  if (left < margin) left = margin;

  let top = rect.bottom + 4;
  if (top + menuHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menuHeight - 4);
  }

  return { left, top, width };
}

function sameMenuPos(a: MenuPos | null, b: MenuPos): boolean {
  return !!a && a.left === b.left && a.top === b.top && a.width === b.width;
}

export default function CodeLanguagePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CODE_LANGUAGE_OPTIONS;
    return CODE_LANGUAGE_OPTIONS.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [query]);

  const repositionMenu = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = computeMenuPos(btn, menuRef.current);
    setMenuPos((prev) => (sameMenuPos(prev, next) ? prev : next));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    repositionMenu();
  }, [open, query, filtered.length, repositionMenu]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });

    const menu = menuRef.current;
    const ro = menu ? new ResizeObserver(() => repositionMenu()) : null;
    if (menu) ro?.observe(menu);

    const onReflow = () => repositionMenu();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, repositionMenu]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (lang: string) => {
    onChange(lang);
    setOpen(false);
    setQuery("");
  };

  const stopBubble = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="code-lang-menu code-lang-menu-portal"
          role="listbox"
          onMouseDown={stopBubble}
          onClick={stopBubble}
          style={{
            position: "fixed",
            left: menuPos?.left ?? 0,
            top: menuPos?.top ?? 0,
            width: menuPos?.width ?? 260,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          <input
            ref={inputRef}
            className="code-lang-search"
            type="text"
            placeholder="Buscar lenguaje…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) {
                e.preventDefault();
                pick(filtered[0].value);
              }
            }}
          />
          <div className="code-lang-list">
            {filtered.length === 0 ? (
              <div className="code-lang-empty muted">Sin resultados</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.value || "__plain"}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  className={`code-lang-item ${opt.value === value ? "sel" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(opt.value)}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div
        className="code-lang-picker"
        ref={rootRef}
        onMouseDown={stopBubble}
        onClick={stopBubble}
      >
        <button
          ref={btnRef}
          type="button"
          className="code-lang-btn"
          aria-expanded={open}
          aria-haspopup="listbox"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          {codeLanguageLabel(value)}
          <span className="code-lang-chevron">{open ? "▴" : "▾"}</span>
        </button>
      </div>
      {menu}
    </>
  );
}
