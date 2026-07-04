import { useMemo } from "react";
import { CheckSquare, Table as TableIcon } from "lucide-react";
import { useVaultStore, type AccentName } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore, type ViewName } from "../../stores/uiStore";
import {
  breadcrumbsForDatabase,
  breadcrumbsForImage,
  breadcrumbsForNote,
  navigateBreadcrumbTarget,
  type BreadcrumbSegment,
} from "../../lib/breadcrumbs";
import { dailyNoteRelPath, openDailyNote, isDailyNoteRel, sameRelPath } from "../../lib/dailyNotes";

const ACCENTS: { name: AccentName; color: string }[] = [
  { name: "blue", color: "#2383e2" },
  { name: "teal", color: "#0f7b6c" },
  { name: "amber", color: "#c47b00" },
  { name: "rose", color: "#c0392b" },
];

const VIEW_TITLES: Record<ViewName, string> = {
  note: "Nota actual",
  tasks: "Mis tareas",
  base: "Base de datos",
  settings: "Ajustes",
};

function BreadcrumbTrail({
  segments,
  dirty,
  onNavigate,
}: {
  segments: BreadcrumbSegment[];
  dirty?: boolean;
  onNavigate: (seg: BreadcrumbSegment) => void;
}) {
  return (
    <div className="crumbs">
      {segments.map((seg, i) => (
        <span key={`${seg.label}-${i}`} className="crumb-wrap">
          {i > 0 && <span className="sep">/</span>}
          {seg.target ? (
            <button
              type="button"
              className="crumb-btn"
              title={
                seg.target.type === "note"
                  ? `Abrir nota ${seg.label}`
                  : seg.target.type === "folder"
                    ? `Abrir carpeta ${seg.label}`
                    : seg.label
              }
              onClick={() => onNavigate(seg)}
            >
              {seg.label}
            </button>
          ) : (
            <span className="cur">
              {seg.label}
              {dirty ? " •" : ""}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function TopBar() {
  const config = useVaultStore((s) => s.config);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const openDatabaseTab = useTabsStore((s) => s.openDatabaseTab);
  const openImageTab = useTabsStore((s) => s.openImageTab);
  const openTasksTab = useTabsStore((s) => s.openTasksTab);

  const activeTab = useTabsStore((s) => s.activeTab());
  const notes = useNotesStore((s) => s.notes);
  const images = useNotesStore((s) => s.images);
  const openByRelPath = useNotesStore((s) => s.openByRelPath);

  const dirty = activeTab?.kind === "note" ? (activeTab.dirty ?? false) : false;

  const toggleTheme = () =>
    updateConfig({ theme: config.theme === "dark" ? "light" : "dark" });

  const segments = useMemo((): BreadcrumbSegment[] => {
    if (view === "settings") return [{ label: VIEW_TITLES.settings, target: null }];

    if (view === "note" && activeTab?.kind === "tasks") {
      return [{ label: VIEW_TITLES.tasks, target: null }];
    }
    if (view === "note" && activeTab?.kind === "database") {
      return breadcrumbsForDatabase(activeTab.folder ?? null, notes);
    }
    if (view === "note" && activeTab?.kind === "note") {
      const entry = notes.find((n) => n.path === activeTab.path);
      if (entry) return breadcrumbsForNote(entry.rel_path, notes);
      return [{ label: "Sin nota", target: null }];
    }
    if (view === "note" && activeTab?.kind === "image" && activeTab.path) {
      const entry = images.find((i) => i.path === activeTab.path);
      if (entry) return breadcrumbsForImage(entry.rel_path, notes);
      return [{ label: "Imagen", target: null }];
    }

    return [{ label: VIEW_TITLES.note, target: null }];
  }, [view, activeTab, notes, images]);

  const onNavigate = (seg: BreadcrumbSegment) => {
    if (!seg.target) return;
    void navigateBreadcrumbTarget(seg.target, {
      setView,
      openByRelPath,
      openDatabaseTab,
      openImageTab,
      notes,
      images,
    });
  };

  const editorActive = view === "note";
  const dbTabActive = activeTab?.kind === "database";
  const todayDailyRel = dailyNoteRelPath(
    config.dailyNotesFolder,
    config.dailyNotesDateFormat,
    new Date(),
  );
  const activeNotePath =
    activeTab?.kind === "note" && activeTab.path
      ? activeTab.path.replace(/\\/g, "/")
      : null;
  const activeEntry = activeNotePath
    ? notes.find((n) => n.path === activeNotePath)
    : undefined;
  const onDailyNote =
    editorActive &&
    activeTab?.kind === "note" &&
    !!activeEntry &&
    isDailyNoteRel(activeEntry.rel_path, config.dailyNotesFolder);
  const todayDailyActive =
    onDailyNote &&
    !!activeEntry &&
    sameRelPath(activeEntry.rel_path, todayDailyRel);

  return (
    <header className="topbar" data-tauri-drag-region>
      <BreadcrumbTrail
        segments={segments}
        dirty={view === "note" && activeTab?.kind === "note" && dirty}
        onNavigate={onNavigate}
      />

      <div className="top-actions">
        <div className="seg">
          <button
            className={`seg-btn ${onDailyNote ? "active" : ""}${todayDailyActive ? " daily-today-btn" : ""}`}
            title="Nota de hoy (Ctrl+D)"
            onClick={() => void openDailyNote()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </button>
          <button
            className={`seg-btn ${editorActive && activeTab?.kind === "tasks" ? "active" : ""}`}
            title="Tareas"
            onClick={() => void openTasksTab()}
          >
            <CheckSquare />
          </button>
          <button
            className={`seg-btn ${editorActive && dbTabActive ? "active" : ""}`}
            title="Base de datos"
            onClick={() => void openDatabaseTab(null)}
          >
            <TableIcon />
          </button>
        </div>

        <button className="icon-btn" title="Cambiar tema" onClick={toggleTheme}>
          <svg viewBox="0 0 24 24">
            <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
          </svg>
        </button>

        <div className="accent-dots" title="Color de acento">
          {ACCENTS.map((a) => (
            <button
              key={a.name}
              className={`ad ${config.accent === a.name ? "sel" : ""}`}
              style={{ ["--c" as string]: a.color }}
              onClick={() => updateConfig({ accent: a.name })}
            />
          ))}
        </div>
      </div>
    </header>
  );
}
