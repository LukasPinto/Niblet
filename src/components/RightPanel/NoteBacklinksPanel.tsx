import { useNotesStore } from "../../stores/notesStore";
import { useLinksStore } from "../../stores/linksStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { selectActiveNoteTab } from "../../stores/tabSelectors";
import { linkDisplayLabel } from "../../lib/linkParser";
import { sourceLabel } from "../../lib/taskParser";
import { useNoteLinkInteractions } from "../../hooks/useNoteLinkInteractions";

/** Enlaces entrantes y salientes de la nota activa. */
export default function NoteBacklinksPanel({ variant = "panel" }: { variant?: "panel" | "floating" }) {
  const activeNotePath = useTabsStore((s) => {
    const tab = selectActiveNoteTab(s.tabs, s.activeTabId);
    return tab?.path ?? null;
  });

  const entryRelPath = useNotesStore((s) => {
    if (!activeNotePath) return null;
    return s.notes.find((n) => n.path === activeNotePath)?.rel_path ?? null;
  });
  const openByRelPath = useNotesStore((s) => s.openByRelPath);
  const outgoingFor = useLinksStore((s) => s.outgoingFor);
  const backlinksFor = useLinksStore((s) => s.backlinksFor);
  const scanning = useLinksStore((s) => s.scanning);
  const noteBacklinksCollapsed = useUiStore((s) => s.noteBacklinksCollapsed);
  const setCollapsed = useUiStore((s) => s.setNoteBacklinksCollapsed);
  const collapsed = variant === "floating" ? false : noteBacklinksCollapsed;
  const linkHover = useNoteLinkInteractions(entryRelPath ?? "");

  if (!entryRelPath || !activeNotePath) return null;

  const outgoing = outgoingFor(entryRelPath);
  const backlinks = backlinksFor(entryRelPath);
  const resolvedOutgoing = outgoing.filter((l) => l.resolvedRelPath);
  const unresolvedOutgoing = outgoing.filter((l) => !l.resolvedRelPath);
  const total = backlinks.length + outgoing.length;

  const body =
    total === 0 ? (
      <p className="empty-hint">
        Sin enlaces. Usa <code>[[Nota]]</code> o <code>[texto](nota.md)</code>.
      </p>
    ) : (
      <>
        {backlinks.length > 0 && (
          <div className="backlinks-section">
            <div className="backlinks-section-title">Enlaces entrantes</div>
            <div
              className="backlinks-list"
              onMouseOver={linkHover.onMouseOver}
              onMouseMove={linkHover.onMouseMove}
              onMouseOut={linkHover.onMouseOut}
            >
              {backlinks.map((link) => (
                <button
                  key={`${link.sourceRelPath}:${link.line}:${link.rawTarget}`}
                  type="button"
                  className="backlink"
                  data-rel={link.sourceRelPath}
                  onClick={() => void openByRelPath(link.sourceRelPath)}
                >
                  <span className="backlink-arrow">↩</span>
                  <span className="backlink-text">{sourceLabel(link.sourceRelPath)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {outgoing.length > 0 && (
          <div className="backlinks-section">
            <div className="backlinks-section-title">Enlaces salientes</div>
            <div
              className="backlinks-list"
              onMouseOver={linkHover.onMouseOver}
              onMouseMove={linkHover.onMouseMove}
              onMouseOut={linkHover.onMouseOut}
            >
              {resolvedOutgoing.map((link) => (
                <button
                  key={`out-${link.line}:${link.rawTarget}`}
                  type="button"
                  className="backlink backlink--out"
                  data-rel={link.resolvedRelPath ?? undefined}
                  onClick={() => {
                    if (link.resolvedRelPath) void openByRelPath(link.resolvedRelPath);
                  }}
                >
                  <span className="backlink-arrow">→</span>
                  <span className="backlink-text">{linkDisplayLabel(link)}</span>
                </button>
              ))}
              {unresolvedOutgoing.map((link) => (
                <span
                  key={`un-${link.line}:${link.rawTarget}`}
                  className="backlink backlink--unresolved"
                  title="Nota no encontrada en el vault"
                >
                  <span className="backlink-arrow">→</span>
                  <span className="backlink-text">{linkDisplayLabel(link)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </>
    );

  if (variant === "floating") {
    return <div className="rp-float-panel-inner">{body}</div>;
  }

  return (
    <div className="side-card">
      <div className="side-head-row">
        <div className="side-head">
          Enlaces
          {scanning && <span className="side-head-muted"> …</span>}
        </div>
        <button
          type="button"
          className="side-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expandir enlaces" : "Colapsar enlaces"}
          aria-expanded={!collapsed}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!collapsed && body}
    </div>
  );
}
