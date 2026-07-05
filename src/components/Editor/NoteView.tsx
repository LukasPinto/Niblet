import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore } from "../../stores/tabsStore";
import { noteTabId } from "../../stores/tabsStore";
import {
  noteTabFieldsEqual,
  selectNoteTabByPath,
} from "../../stores/tabSelectors";
import {
  CalendarDays,
  Eye,
  FileText,
  Pencil,
  Smile,
  Table as TableIcon,
  Tag,
} from "lucide-react";
import MarkdownEditor from "./MarkdownEditor";
import BlockEditor from "./BlockEditor";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  renderMarkdown,
  displayValue,
} from "../../lib/markdown";
import { buildNoteIndex, resolveNoteTarget } from "../../lib/linkParser";
import { useVaultStore, type NoteEditorMode } from "../../stores/vaultStore";
import {
  useNoteLinkInteractions,
  interceptPreviewLinkMouseDown,
} from "../../hooks/useNoteLinkInteractions";
import { prefetchMarkdownImages } from "../../lib/imageCache";
import { warmBlocksCache } from "../../lib/blockParser";

function getNoteScrollCanvas(section: HTMLElement | null): HTMLElement | null {
  return section?.closest(".canvas") as HTMLElement | null;
}

/** Proporción 0–1 del scroll actual (canvas o, en Markdown, el scroller de CM). */
function captureNoteScrollRatio(section: HTMLElement | null): number {
  const canvas = getNoteScrollCanvas(section);
  if (!canvas) return 0;

  const cmScroller = section?.querySelector<HTMLElement>(".cm-scroller");
  if (cmScroller) {
    const cmMax = cmScroller.scrollHeight - cmScroller.clientHeight;
    if (cmMax > 1) return cmScroller.scrollTop / cmMax;
  }

  const max = canvas.scrollHeight - canvas.clientHeight;
  return max > 0 ? canvas.scrollTop / max : 0;
}

function restoreNoteScrollRatio(section: HTMLElement | null, ratio: number) {
  const canvas = getNoteScrollCanvas(section);
  if (!canvas) return;

  const max = canvas.scrollHeight - canvas.clientHeight;
  canvas.scrollTop = ratio * max;

  const cmScroller = section?.querySelector<HTMLElement>(".cm-scroller");
  if (cmScroller) {
    const cmMax = cmScroller.scrollHeight - cmScroller.clientHeight;
    if (cmMax > 1) cmScroller.scrollTop = ratio * cmMax;
  }
}

function PropRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-k">{icon} {label}</span>
      <span className="prop-v">{value}</span>
    </div>
  );
}

function NoteModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: NoteEditorMode;
  onModeChange: (m: NoteEditorMode) => void;
}) {
  return (
    <div className="seg" role="tablist" aria-label="Modo de edición">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "blocks"}
        className={`seg-btn ${mode === "blocks" ? "active" : ""}`}
        onClick={() => onModeChange("blocks")}
      >
        <TableIcon /> Bloques
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "edit"}
        className={`seg-btn ${mode === "edit" ? "active" : ""}`}
        onClick={() => onModeChange("edit")}
      >
        <Pencil /> Markdown
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "preview"}
        className={`seg-btn ${mode === "preview" ? "active" : ""}`}
        onClick={() => onModeChange("preview")}
      >
        <Eye /> Vista
      </button>
    </div>
  );
}

function NoteEditorInstance({ path }: { path: string }) {
  const tabFields = useTabsStore(
    (s) => selectNoteTabByPath(s.tabs, path),
    noteTabFieldsEqual,
  );
  const setTabContent = useTabsStore((s) => s.setTabContent);
  const saveTab = useTabsStore((s) => s.saveTab);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const entryMeta = useNotesStore(
    (s) => {
      const e = s.notes.find((n) => n.path === path);
      return e ? { name: e.name, rel_path: e.rel_path } : null;
    },
    (a, b) => a?.name === b?.name && a?.rel_path === b?.rel_path,
  );
  const notesRevision = useNotesStore((s) => s.notes.length);

  const mode = useVaultStore((s) => s.config.noteEditorMode);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const openByRelPath = useNotesStore((s) => s.openByRelPath);
  const noteSectionRef = useRef<HTMLElement>(null);
  const pendingScrollRatioRef = useRef<number | null>(null);

  const setMode = useCallback(
    (m: NoteEditorMode) => {
      if (m !== mode) {
        pendingScrollRatioRef.current = captureNoteScrollRatio(noteSectionRef.current);
      }
      void updateConfig({ noteEditorMode: m });
    },
    [mode, updateConfig],
  );

  const [html, setHtml] = useState("");
  const previewKeyRef = useRef("");
  const isActive = activeTabId === noteTabId(path);
  const content = tabFields?.content ?? "";
  const dirty = tabFields?.dirty ?? false;
  const contentEpoch = tabFields?.contentEpoch ?? 0;

  const { data, content: body } = useMemo(
    () => parseFrontmatter(content),
    [content],
  );
  const dataRef = useRef(data);
  dataRef.current = data;

  const onBlockChange = useCallback(
    (markdownBody: string) => {
      setTabContent(path, stringifyFrontmatter(dataRef.current, markdownBody));
    },
    [path, setTabContent],
  );

  const linkHover = useNoteLinkInteractions(entryMeta?.rel_path ?? "");

  // Precarga bloques e imágenes al abrir la nota (no en cada tecla).
  useEffect(() => {
    if (!isActive || !vaultPath) return;
    warmBlocksCache(body);
    prefetchMarkdownImages(body, vaultPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir/cambiar nota
  }, [isActive, path, vaultPath]);

  // Vista previa: precalentar en Bloques/Markdown; al abrir Vista ya está lista.
  useEffect(() => {
    if (!isActive) return;
    const notes = useNotesStore.getState().notes;
    const key = `${vaultPath ?? ""}\0${notes.length}\0${body}`;
    if (previewKeyRef.current === key) return;

    let alive = true;
    const delay = mode === "preview" ? 0 : mode === "edit" ? 400 : 700;
    const timer = window.setTimeout(() => {
      renderMarkdown(body, vaultPath ?? undefined, notes).then((h) => {
        if (!alive) return;
        previewKeyRef.current = key;
        setHtml(h);
      });
    }, delay);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [isActive, mode, body, vaultPath, notesRevision]);

  // Al cambiar de Bloques / Markdown / Vista el alto del contenido cambia; si se
  // conserva scrollTop en píxeles, la vista salta (p. ej. del final de Markdown al
  // medio de Bloques). Restauramos la misma proporción de scroll.
  useLayoutEffect(() => {
    if (!isActive) return;
    const ratio = pendingScrollRatioRef.current;
    if (ratio === null) return;

    const section = noteSectionRef.current;
    if (!section) return;

    const apply = () => restoreNoteScrollRatio(section, ratio);

    apply();
    const raf = requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });

    const doc = section.querySelector(".doc");
    const ro = new ResizeObserver(() => apply());
    if (doc) ro.observe(doc);

    const timer = window.setTimeout(() => {
      apply();
      pendingScrollRatioRef.current = null;
      ro.disconnect();
    }, 500);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [isActive, mode, html, body]);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const copyBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".md-code-copy-btn");
      if (copyBtn) {
        e.preventDefault();
        const code = copyBtn.closest("pre")?.querySelector("code");
        if (!code) return;
        navigator.clipboard
          .writeText(code.textContent ?? "")
          .then(() => {
            const prev = copyBtn.textContent;
            copyBtn.textContent = "✓ Copiado";
            window.setTimeout(() => {
              copyBtn.textContent = prev;
            }, 1400);
          })
          .catch(() => {});
        return;
      }

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

      const index = buildNoteIndex(useNotesStore.getState().notes);
      const resolved = resolveNoteTarget(href, entryMeta?.rel_path ?? "", index);
      if (resolved) {
        e.preventDefault();
        void openByRelPath(resolved);
      }
    },
    [entryMeta?.rel_path, openByRelPath],
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

  if (!tabFields || !entryMeta) return null;

  const tags = data.tags
    ? (Array.isArray(data.tags) ? data.tags : [data.tags])
    : [];

  return (
    <section className="view view-note" ref={noteSectionRef}>
      <article className="doc">
        <div className="doc-icon"><CalendarDays style={{ width: 34, height: 34 }} /></div>
        <input
          className="doc-title"
          value={entryMeta.name}
          readOnly
          spellCheck={false}
        />

        <div className="props">
          {data.fecha && <PropRow icon={<CalendarDays />} label="Fecha" value={displayValue(data.fecha)} />}
          <PropRow
            icon={<Tag />}
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
          {data.animo && <PropRow icon={<Smile />} label="Ánimo" value={displayValue(data.animo)} />}
        </div>

        <div className="note-mode-inline" style={{ width: "fit-content", marginBottom: 16 }}>
          <NoteModeSwitcher mode={mode} onModeChange={setMode} />
        </div>

        <div hidden={mode !== "edit"}>
          <MarkdownEditor
            value={content}
            visible={mode === "edit"}
            noteRelPath={entryMeta.rel_path}
            onChange={(c) => setTabContent(path, c)}
            onSave={() => saveTab(path)}
          />
        </div>

        {isActive && (
          <BlockEditor
            content={body}
            noteKey={path}
            contentEpoch={contentEpoch}
            active={mode === "blocks"}
            onChange={onBlockChange}
          />
        )}

        <div
          hidden={mode !== "preview"}
          className="md-preview"
          aria-busy={mode === "preview" && !html}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={onPreviewClick}
          onMouseDown={(e) =>
            interceptPreviewLinkMouseDown(
              e,
              useNotesStore.getState().notes,
              entryMeta.rel_path,
              openByRelPath,
            )
          }
          onMouseOver={linkHover.onMouseOver}
          onMouseMove={linkHover.onMouseMove}
          onMouseOut={linkHover.onMouseOut}
        />
      </article>
      {/* En portal: dentro de .view (que anima `transform` al entrar) el
          position:fixed se ancla al contenedor animado en vez del viewport y
          la barra salta de sitio durante el fade al cambiar de nota. */}
      {isActive &&
        createPortal(
          <div className="note-mode-float">
            <NoteModeSwitcher mode={mode} onModeChange={setMode} />
          </div>,
          document.body,
        )}
    </section>
  );
}

const MemoNoteEditorInstance = memo(NoteEditorInstance);

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
        <div className="cs-emoji"><FileText style={{ width: 44, height: 44 }} /></div>
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
          {tab.path && <MemoNoteEditorInstance path={tab.path} />}
        </div>
      ))}
    </>
  );
}
