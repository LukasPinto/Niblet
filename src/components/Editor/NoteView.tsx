import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useVaultStore, type NoteEditorMode } from "../../stores/vaultStore";
import MarkdownEditor from "./MarkdownEditor";
import BlockEditor from "./BlockEditor";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  renderMarkdown,
  displayValue,
} from "../../lib/markdown";
import { buildNoteIndex, resolveNoteTarget } from "../../lib/linkParser";
import { noteTabId } from "../../stores/tabsStore";
import {
  useNoteLinkInteractions,
  interceptPreviewLinkMouseDown,
} from "../../hooks/useNoteLinkInteractions";

function PropRow({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-k">{icon} {label}</span>
      <span className="prop-v">{value}</span>
    </div>
  );
}

function NoteEditorInstance({ path }: { path: string }) {
  const tab = useTabsStore((s) => s.getNoteTab(path));
  const setTabContent = useTabsStore((s) => s.setTabContent);
  const saveTab = useTabsStore((s) => s.saveTab);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const entry = useNotesStore((s) => s.notes.find((n) => n.path === path));
  const notes = useNotesStore((s) => s.notes);
  const openByRelPath = useNotesStore((s) => s.openByRelPath);

  const mode = useVaultStore((s) => s.config.noteEditorMode);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const setMode = (m: NoteEditorMode) => updateConfig({ noteEditorMode: m });

  const [html, setHtml] = useState("");
  const isActive = activeTabId === noteTabId(path);
  const content = tab?.content ?? "";
  const dirty = tab?.dirty ?? false;

  const { data, content: body } = useMemo(
    () => parseFrontmatter(content),
    [content],
  );

  const linkHover = useNoteLinkInteractions(entry?.rel_path ?? "");

  useEffect(() => {
    if (!isActive || mode !== "preview") return;
    let alive = true;
    renderMarkdown(body, vaultPath ?? undefined, notes).then((h) => {
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [isActive, mode, body, vaultPath, notes]);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;

      if (href.startsWith("note:")) {
        e.preventDefault();
        void openByRelPath(decodeURIComponent(href.slice(5)));
        return;
      }
      if (href.startsWith("note-unresolved:") || anchor.classList.contains("wikilink--unresolved")) {
        e.preventDefault();
        return;
      }
      if (/^https?:/i.test(href) || href.startsWith("mailto:")) return;

      const index = buildNoteIndex(notes);
      const resolved = resolveNoteTarget(href, entry?.rel_path ?? "", index);
      if (resolved) {
        e.preventDefault();
        void openByRelPath(resolved);
      }
    },
    [entry?.rel_path, notes, openByRelPath],
  );

  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!isActive || !dirty) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTab(path);
    }, 800);
    return () => window.clearTimeout(saveTimer.current);
  }, [content, dirty, isActive, path, saveTab]);

  if (!tab || !entry) return null;

  const tags = data.tags
    ? (Array.isArray(data.tags) ? data.tags : [data.tags])
    : [];

  return (
    <section className="view view-note">
      <article className="doc">
        <div className="doc-icon">🗓️</div>
        <input
          className="doc-title"
          value={entry.name}
          readOnly
          spellCheck={false}
        />

        <div className="props">
          {data.fecha && <PropRow icon="📅" label="Fecha" value={displayValue(data.fecha)} />}
          <PropRow
            icon="🏷️"
            label="Tags"
            value={
              tags.length ? (
                <span className="tags">
                  {tags.map((t) => (
                    <em key={t} className="tag">#{String(t).replace(/^#/, "")}</em>
                  ))}
                </span>
              ) : (
                <span className="muted">—</span>
              )
            }
          />
          {data.animo && <PropRow icon="😀" label="Ánimo" value={displayValue(data.animo)} />}
        </div>

        <div className="seg" style={{ width: "fit-content", marginBottom: 16 }}>
          <button
            className={`seg-btn ${mode === "blocks" ? "active" : ""}`}
            onClick={() => setMode("blocks")}
          >
            ⊞ Bloques
          </button>
          <button
            className={`seg-btn ${mode === "edit" ? "active" : ""}`}
            onClick={() => setMode("edit")}
          >
            ✎ Markdown
          </button>
          <button
            className={`seg-btn ${mode === "preview" ? "active" : ""}`}
            onClick={() => setMode("preview")}
          >
            👁 Vista
          </button>
        </div>

        {mode === "edit" && (
          <MarkdownEditor
            value={content}
            noteRelPath={entry.rel_path}
            onChange={(c) => setTabContent(path, c)}
            onSave={() => saveTab(path)}
          />
        )}
        {mode === "blocks" && (
          <BlockEditor
            content={body}
            noteKey={path}
            contentEpoch={tab.contentEpoch ?? 0}
            onChange={(b) => setTabContent(path, stringifyFrontmatter(data, b))}
          />
        )}
        {mode === "preview" && (
          <div
            className="md-preview"
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={onPreviewClick}
            onMouseDown={(e) =>
              interceptPreviewLinkMouseDown(e, notes, entry.rel_path, openByRelPath)
            }
            onMouseOver={linkHover.onMouseOver}
            onMouseMove={linkHover.onMouseMove}
            onMouseOut={linkHover.onMouseOut}
          />
        )}
      </article>
    </section>
  );
}

export default function NoteView() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const noteTabs = tabs.filter((t) => t.kind === "note");

  if (noteTabs.length === 0) {
    const active = tabs.find((t) => t.id === activeTabId);
    if (
      active?.kind === "database" ||
      active?.kind === "image" ||
      active?.kind === "tasks"
    )
      return null;
    return (
      <div className="center-state">
        <div className="cs-emoji">📝</div>
        <h2>Ninguna nota abierta</h2>
        <p className="muted">Abre una nota desde las carpetas del menú lateral o usa Ctrl+K.</p>
      </div>
    );
  }

  return (
    <>
      {noteTabs.map((tab) => (
        <div
          key={tab.id}
          className="note-tab-panel"
          hidden={tab.id !== activeTabId}
        >
          {tab.path && <NoteEditorInstance path={tab.path} />}
        </div>
      ))}
    </>
  );
}
