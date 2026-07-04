import { useEffect, useRef, useState } from "react";
import { Notebook } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useVaultStore } from "./stores/vaultStore";
import { useNotesStore } from "./stores/notesStore";
import { useTasksStore } from "./stores/tasksStore";
import { useLinksStore } from "./stores/linksStore";
import { useUiStore } from "./stores/uiStore";
import Sidebar from "./components/Sidebar/Sidebar";
import TopBar from "./components/TopBar/TopBar";
import CommandPalette from "./components/CommandPalette/CommandPalette";
import NoteView from "./components/Editor/NoteView";
import NoteTabBar from "./components/Editor/NoteTabBar";
import { TasksTabPanels } from "./components/TasksPanel/TasksPanel";
import DatabaseTabPanels from "./components/DatabaseView/DatabaseView";
import ImageTabPanels from "./components/Editor/ImageView";
import Settings from "./components/Settings/Settings";
import ConflictModal from "./components/Settings/ConflictModal";
import ContextMenu from "./components/ContextMenu/ContextMenu";
import RightPanel from "./components/RightPanel/RightPanel";
import { useSyncStore } from "./stores/syncStore";
import { getAccount } from "./lib/onedrive";
import { useTabsStore } from "./stores/tabsStore";
import { openDailyNote } from "./lib/dailyNotes";
import { initWorkspacePersistence } from "./stores/workspaceStore";
import LinkHoverPreview from "./components/Editor/LinkHoverPreview";
import Welcome from "./components/Welcome/Welcome";

function CloneBanner() {
  const cloneProgress = useVaultStore((s) => s.cloneProgress);
  if (!cloneProgress) return null;

  if (!cloneProgress.active) {
    return (
      <div className="clone-banner clone-banner--error">
        <span>Error al descargar el vault: {cloneProgress.error}</span>
      </div>
    );
  }

  const { done, total } = cloneProgress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="clone-banner">
      <div className="clone-banner__bar" style={{ width: `${pct}%` }} />
      <span className="clone-banner__text">
        {total === 0
          ? "Conectando con OneDrive…"
          : `Descargando vault remoto… ${done} / ${total} archivos`}
      </span>
    </div>
  );
}

export default function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const applyToDom = useVaultStore((s) => s.applyToDom);
  const view = useUiStore((s) => s.view);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const tabCount = useTabsStore((s) => s.tabs.length);

  const refreshNotes = useNotesStore((s) => s.refreshNotes);
  const refreshTasks = useTasksStore((s) => s.refreshTasks);
  const refreshConflicts = useTasksStore((s) => s.refreshConflicts);
  const refreshLinks = useLinksStore((s) => s.refreshLinks);

  const [booting, setBooting] = useState(true);

  // Aplicar tema/acento por defecto al arrancar.
  useEffect(() => {
    applyToDom();
  }, [applyToDom]);

  // Marcar macOS para ajustar espacio de semáforos en el topbar.
  useEffect(() => {
    if (navigator.userAgent.includes("Mac")) {
      document.documentElement.classList.add("macos");
    }
  }, []);

  // Reabrir automáticamente el último vault usado (persistido en localStorage).
  useEffect(() => {
    initWorkspacePersistence();
    useVaultStore
      .getState()
      .initVault()
      .finally(() => setBooting(false));
  }, []);

  // Cuando se abre/cambia el vault: cargar notas, tareas y conflictos.
  useEffect(() => {
    if (!vaultPath) return;
    refreshNotes();
    refreshTasks();
    refreshConflicts();
  }, [vaultPath, refreshNotes, refreshTasks, refreshConflicts]);

  const notesCount = useNotesStore((s) => s.notes.length);
  useEffect(() => {
    if (!vaultPath || notesCount === 0) return;
    void refreshLinks();
  }, [vaultPath, notesCount, refreshLinks]);

  // Atajo global Ctrl/Cmd+K para la paleta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void openDailyNote();
      }
      if (e.key === "Escape") togglePalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  // Sync al abrir vault + intervalo configurable.
  const onedrive = useVaultStore((s) => s.config.onedrive);
  const runSync = useSyncStore((s) => s.runSync);
  useEffect(() => {
    if (!vaultPath || !onedrive?.remoteFolder) return;
    let cancelled = false;
    let intervalId: number | undefined;

    const setup = async () => {
      const account = await getAccount();
      if (!account || cancelled) return;
      if (onedrive.autoSync) void runSync();
      const mins = onedrive.syncIntervalMinutes ?? 0;
      if (mins > 0) {
        intervalId = window.setInterval(() => {
          void runSync();
        }, mins * 60 * 1000);
      }
    };
    void setup();

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [
    vaultPath,
    onedrive?.autoSync,
    onedrive?.remoteFolder,
    onedrive?.syncIntervalMinutes,
    runSync,
  ]);

  // Watcher del vault (OneDrive sync externo) → refrescar con debounce.
  const debounce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!vaultPath) return;
    const un = listen("vault-changed", () => {
      window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(() => {
        refreshNotes();
        refreshTasks();
        refreshConflicts();
        useLinksStore.getState().scheduleRefresh();
      }, 400);
    });
    return () => {
      un.then((f) => f());
    };
  }, [vaultPath, refreshNotes, refreshTasks, refreshConflicts]);

  if (booting) {
    return (
      <div className="app" style={{ gridTemplateColumns: "1fr" }}>
        <div className="center-state">
          <div className="cs-emoji"><Notebook style={{ width: 44, height: 44 }} /></div>
          <p className="muted">Cargando Niblet…</p>
        </div>
      </div>
    );
  }

  if (!vaultPath) {
    return (
      <div className="app" style={{ gridTemplateColumns: "1fr" }}>
        <Welcome />
      </div>
    );
  }

  return (
    <div className={`app${rightPanelOpen ? " rp-open" : ""}`}>
      <Sidebar />
      <main className="main">
        <TopBar />
        {tabCount > 0 && view === "note" && <NoteTabBar />}
        <CloneBanner />
        <div className="canvas">
          {view === "note" && (
            <>
              <NoteView />
              <DatabaseTabPanels />
              <ImageTabPanels />
              <TasksTabPanels />
            </>
          )}
          {view === "settings" && <Settings />}
        </div>
      </main>
      <RightPanel />
      <LinkHoverPreview />
      <CommandPalette />
      <ConflictModal />
      <ContextMenu />
    </div>
  );
}
