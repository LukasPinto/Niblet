import { useNotesStore } from "../../stores/notesStore";
import { useLinksStore } from "../../stores/linksStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { linkDisplayLabel } from "../../lib/linkParser";
import { sourceLabel } from "../../lib/taskParser";
import { useNoteLinkInteractions } from "../../hooks/useNoteLinkInteractions";

/** Enlaces entrantes y salientes de la nota activa. */
export default function NoteBacklinksPanel() {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const path = activeTab?.kind === "note" ? activeTab.path : undefined;

  const entry = useNotesStore((s) =>
    path ? s.notes.find((n) => n.path === path) : undefined,
  );
  const openByRelPath = useNotesStore((s) => s.openByRelPath);
  const outgoingFor = useLinksStore((s) => s.outgoingFor);
  const backlinksFor = useLinksStore((s) => s.backlinksFor);
  const scanning = useLinksStore((s) => s.scanning);
  const collapsed = useUiStore((s) => s.noteBacklinksCollapsed);
  const setCollapsed = useUiStore((s) => s.setNoteBacklinksCollapsed);
  const linkHover = useNoteLinkInteractions(entry?.rel_path ?? "");

  if (!entry || !path) return null;

  const outgoing = outgoingFor(entry.rel_path);
  const backlinks = backlinksFor(entry.rel_path);
  const resolvedOutgoing = outgoing.filter((l) => l.resolvedRelPath);
  const unresolvedOutgoing = outgoing.filter((l) => !l.resolvedRelPath);
  const total = backlinks.length + outgoing.length;

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
      {!collapsed &&
        (total === 0 ? (
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
        ))}
    </div>
  );
}
