import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, CheckSquare, Link2, X } from "lucide-react";
import { useUiStore, type FloatingPanelKind } from "../../stores/uiStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useNotesStore } from "../../stores/notesStore";
import { useLinksStore } from "../../stores/linksStore";
import {
  activeNoteTabEqual,
  selectActiveNoteTab,
} from "../../stores/tabSelectors";
import { parseNoteTasks } from "../../lib/noteTasks";
import MiniCalendar from "./MiniCalendar";
import NoteTasksPanel from "./NoteTasksPanel";
import NoteBacklinksPanel from "./NoteBacklinksPanel";

const FLOAT_TITLES: Record<FloatingPanelKind, string> = {
  calendar: "Calendario",
  tasks: "Tareas de esta nota",
  backlinks: "Enlaces",
};

const FLOAT_WIDTH: Record<FloatingPanelKind, number> = {
  calendar: 248,
  tasks: 288,
  backlinks: 300,
};

export default function FloatingPanelShortcuts() {
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const view = useUiStore((s) => s.view);
  const floatingPanel = useUiStore((s) => s.floatingPanel);
  const toggleFloatingPanel = useUiStore((s) => s.toggleFloatingPanel);
  const closeFloatingPanel = useUiStore((s) => s.closeFloatingPanel);

  const activeNote = useTabsStore(
    (s) => selectActiveNoteTab(s.tabs, s.activeTabId),
    activeNoteTabEqual,
  );
  const noteContent = activeNote?.content ?? "";
  const entryRelPath = useNotesStore((s) => {
    if (!activeNote?.path) return null;
    return s.notes.find((n) => n.path === activeNote.path)?.rel_path ?? null;
  });
  const outgoingFor = useLinksStore((s) => s.outgoingFor);
  const backlinksFor = useLinksStore((s) => s.backlinksFor);

  const rootRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Partial<Record<FloatingPanelKind, HTMLButtonElement>>>({});
  const popoverRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const noteTabActive = !!activeNote?.path;
  const taskCount = useMemo(() => parseNoteTasks(noteContent).length, [noteContent]);
  const linkCount = useMemo(() => {
    if (!entryRelPath) return 0;
    return backlinksFor(entryRelPath).length + outgoingFor(entryRelPath).length;
  }, [entryRelPath, backlinksFor, outgoingFor]);

  const reposition = useCallback(() => {
    if (!floatingPanel) {
      setMenuPos(null);
      return;
    }
    const btn = btnRefs.current[floatingPanel];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = FLOAT_WIDTH[floatingPanel];
    const margin = 8;
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    setMenuPos({
      top: rect.bottom + 6,
      left,
      width,
    });
  }, [floatingPanel]);

  useEffect(() => {
    reposition();
  }, [floatingPanel, reposition]);

  useEffect(() => {
    if (!floatingPanel) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popoverRef.current?.contains(t)) {
        closeFloatingPanel();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFloatingPanel();
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
  }, [floatingPanel, closeFloatingPanel, reposition]);

  useEffect(() => {
    if (floatingPanel === "tasks" && !noteTabActive) closeFloatingPanel();
    if (floatingPanel === "backlinks" && !noteTabActive) closeFloatingPanel();
  }, [floatingPanel, noteTabActive, closeFloatingPanel]);

  if (rightPanelOpen || view !== "note") return null;

  const setBtnRef = (kind: FloatingPanelKind) => (el: HTMLButtonElement | null) => {
    if (el) btnRefs.current[kind] = el;
    else delete btnRefs.current[kind];
  };

  const popover =
    floatingPanel && menuPos
      ? createPortal(
          <div
            ref={popoverRef}
            className="rp-float-popover"
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
          >
            <div className="rp-float-popover-head">
              <span>{FLOAT_TITLES[floatingPanel]}</span>
              <button
                type="button"
                className="rp-float-popover-close"
                onClick={closeFloatingPanel}
                title="Cerrar"
                aria-label="Cerrar panel flotante"
              >
                <X size={14} />
              </button>
            </div>
            <div className="rp-float-popover-body">
              {floatingPanel === "calendar" && <MiniCalendar />}
              {floatingPanel === "tasks" && noteTabActive && (
                <NoteTasksPanel variant="floating" />
              )}
              {floatingPanel === "backlinks" && noteTabActive && (
                <NoteBacklinksPanel variant="floating" />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="seg rp-float-shortcuts" ref={rootRef}>
        <button
          ref={setBtnRef("calendar")}
          type="button"
          className={`seg-btn ${floatingPanel === "calendar" ? "active" : ""}`}
          title="Calendario"
          aria-expanded={floatingPanel === "calendar"}
          onClick={() => toggleFloatingPanel("calendar")}
        >
          <Calendar />
        </button>
        {noteTabActive && (
          <button
            ref={setBtnRef("tasks")}
            type="button"
            className={`seg-btn ${floatingPanel === "tasks" ? "active" : ""}`}
            title="Tareas de esta nota"
            aria-expanded={floatingPanel === "tasks"}
            onClick={() => toggleFloatingPanel("tasks")}
          >
            <CheckSquare />
            {taskCount > 0 && <span className="rp-float-badge">{taskCount}</span>}
          </button>
        )}
        {noteTabActive && (
          <button
            ref={setBtnRef("backlinks")}
            type="button"
            className={`seg-btn ${floatingPanel === "backlinks" ? "active" : ""}`}
            title="Enlaces de esta nota"
            aria-expanded={floatingPanel === "backlinks"}
            onClick={() => toggleFloatingPanel("backlinks")}
          >
            <Link2 />
            {linkCount > 0 && <span className="rp-float-badge">{linkCount}</span>}
          </button>
        )}
      </div>
      {popover}
    </>
  );
}
