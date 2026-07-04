import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import type { NoteEntry } from "../../lib/tauri";
import {
  countWikilinkMatches,
  filterNotesForWikilink,
  noteBreadcrumb,
} from "../../lib/wikilinkSuggest";

interface Props {
  left: number;
  top: number;
  notes: NoteEntry[];
  query: string;
  selectedIndex: number;
  excludeRelPath?: string;
  onSelect: (note: NoteEntry) => void;
  onHoverIndex: (index: number) => void;
  onClose: () => void;
}

export default function WikilinkSuggestPopover({
  left,
  top,
  notes,
  query,
  selectedIndex,
  excludeRelPath,
  onSelect,
  onHoverIndex,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const filtered = filterNotesForWikilink(notes, query, excludeRelPath);
  const totalMatches = countWikilinkMatches(notes, query, excludeRelPath);
  const moreCount = Math.max(0, totalMatches - filtered.length);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    let x = left;
    let y = top;
    if (x + width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - width - margin);
    }
    if (y + height > window.innerHeight - margin) {
      y = Math.max(margin, top - height - margin);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [left, top, filtered.length, query]);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="wikilink-picker"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="wikilink-picker-head">Enlace a nota</div>
      {filtered.length === 0 ? (
        <p className="wikilink-picker-empty">No hay notas que coincidan</p>
      ) : (
        <div className="wikilink-picker-list">
          {filtered.map((note, i) => (
            <button
              key={note.path}
              type="button"
              className={`wikilink-picker-item${i === selectedIndex ? " sel" : ""}`}
              onMouseEnter={() => onHoverIndex(i)}
              onClick={() => onSelect(note)}
            >
              <span className="wikilink-picker-ico"><FileText style={{ width: 16, height: 16 }} /></span>
              <span className="wikilink-picker-body">
                <span className="wikilink-picker-title">{note.name}</span>
                <span className="wikilink-picker-path">{noteBreadcrumb(note)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {moreCount > 0 && (
        <div className="wikilink-picker-more">… {moreCount} más</div>
      )}
    </div>,
    document.body,
  );
}
