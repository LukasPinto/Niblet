import { useEffect, useMemo, useRef, useState } from "react";
import { useVaultStore, lastSegment } from "../../stores/vaultStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useSyncStore } from "../../stores/syncStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { getAccount } from "../../lib/onedrive";
import { openDailyNote } from "../../lib/dailyNotes";
import {
  CalendarDays,
  CheckSquare,
  Database,
  FilePlus,
  FolderPlus,
  FolderOpen,
  Settings,
  RefreshCw,
  X,
} from "lucide-react";
import FolderTree from "./FolderTree";
import CreateInVaultPopover from "./CreateInVaultPopover";

export default function Sidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tasks = useTasksStore((s) => s.tasks);
  const conflicts = useTasksStore((s) => s.conflicts);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const openDatabaseTab = useTabsStore((s) => s.openDatabaseTab);
  const openTasksTab = useTabsStore((s) => s.openTasksTab);
  const activeTab = useTabsStore((s) => s.activeTab());
  const togglePalette = useUiStore((s) => s.togglePalette);
  const openConflict = useUiStore((s) => s.openConflict);
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const remoteFolder = useVaultStore((s) => s.config.onedrive?.remoteFolder);
  const lastSync = useVaultStore((s) => s.config.onedrive?.lastSync);
  const syncStatus = useSyncStore((s) => s.status);
  const syncError = useSyncStore((s) => s.error);
  const runSync = useSyncStore((s) => s.runSync);
  const [connected, setConnected] = useState(false);
  const [createKind, setCreateKind] = useState<"note" | "folder" | null>(null);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  const folderBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!vaultPath || !remoteFolder?.trim()) {
      setConnected(false);
      return;
    }
    getAccount().then((a) => setConnected(!!a));
  }, [vaultPath, remoteFolder]);

  const pendingTasks = useMemo(
    () => tasks.filter((t) => !t.done).length,
    [tasks],
  );

  const vaultName = vaultPath ? lastSegment(vaultPath) : "Vault";
  const hasConflicts = conflicts.length > 0;
  const syncWarn = hasConflicts || syncStatus === "error";

  let syncLabel = "Sincronizado";
  if (syncStatus === "syncing") syncLabel = "Sincronizando…";
  else if (syncStatus === "error") syncLabel = "Error de sync";
  else if (hasConflicts) syncLabel = `${conflicts.length} conflicto(s)`;

  let vaultSub = "Vault local";
  if (connected) {
    if (syncStatus === "syncing") vaultSub = "Sincronizando…";
    else if (syncStatus === "error") vaultSub = "Error de sync";
    else if (hasConflicts) vaultSub = `${conflicts.length} conflicto(s)`;
    else vaultSub = "Sincronizado · OneDrive";
  }

  const syncTitle =
    syncStatus === "error"
      ? syncError ?? "Error"
      : lastSync
        ? `Última sync: ${new Date(lastSync).toLocaleString()}`
        : connected
          ? "Sin sincronizar aún"
          : "Todo sincronizado";

  return (
    <aside className="sidebar">
      <div className="vault">
        <div className="vault-badge">{vaultName.charAt(0).toUpperCase()}</div>
        <div className="vault-meta">
          <span className="vault-name">{vaultName}</span>
          <span className="vault-sub">{vaultSub}</span>
        </div>
        <div className="vault-menu-wrap">
          <button
            className="icon-btn"
            title="Opciones del vault"
            aria-haspopup="menu"
            aria-expanded={vaultMenuOpen}
            onClick={() => setVaultMenuOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {vaultMenuOpen && (
            <>
              <div
                className="vault-menu-backdrop"
                onClick={() => setVaultMenuOpen(false)}
              />
              <div className="vault-menu" role="menu">
                <button
                  type="button"
                  className="vault-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setVaultMenuOpen(false);
                    void useVaultStore.getState().openVault();
                  }}
                >
                  <FolderOpen style={{ width: 16, height: 16 }} /> Abrir otro vault…
                </button>
                {recentVaults.filter((r) => r.path !== vaultPath).length > 0 && (
                  <>
                    <div className="vault-menu-sep" />
                    <div className="vault-menu-label">Recientes</div>
                    {recentVaults
                      .filter((r) => r.path !== vaultPath)
                      .map((r) => (
                        <button
                          key={r.path}
                          type="button"
                          className="vault-menu-item vault-menu-recent"
                          role="menuitem"
                          title={r.path}
                          onClick={() => {
                            setVaultMenuOpen(false);
                            void useVaultStore.getState().openRecentVault(r.path);
                          }}
                        >
                          <span className="vault-menu-recent-badge">
                            {r.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="vault-menu-recent-name">{r.name}</span>
                        </button>
                      ))}
                    <div className="vault-menu-sep" />
                  </>
                )}
                <button
                  type="button"
                  className="vault-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setVaultMenuOpen(false);
                    useVaultStore.getState().closeVault();
                  }}
                >
                  <X style={{ width: 16, height: 16 }} /> Cerrar vault
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="search" onClick={() => togglePalette(true)}>
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <span>Buscar o saltar a…</span>
        <kbd>Ctrl K</kbd>
      </div>

      <nav className="nav">
        <button
          className="nav-item"
          onClick={() => void openDailyNote()}
          title="Abrir nota de hoy (Ctrl+D)"
        >
          <span className="ni-ico"><CalendarDays /></span>
          <span className="ni-label">Nota de hoy</span>
        </button>
        <button
          className={`nav-item ${view === "note" && activeTab?.kind === "tasks" ? "active" : ""}`}
          onClick={() => void openTasksTab()}
        >
          <span className="ni-ico"><CheckSquare /></span>
          <span className="ni-label">Mis tareas</span>
          {pendingTasks > 0 && <span className="pill-count">{pendingTasks}</span>}
        </button>
        <button
          className={`nav-item ${view === "note" && activeTab?.kind === "database" && activeTab.folder === null ? "active" : ""}`}
          onClick={() => openDatabaseTab(null)}
        >
          <span className="ni-ico"><Database /></span>
          <span className="ni-label">Base de datos</span>
        </button>

        {vaultPath && (
          <div className="nav-section-head">
            <span className="nav-section">Carpetas</span>
            <span className="nav-section-actions">
              <button
                ref={noteBtnRef}
                type="button"
                className="nav-section-btn"
                title="Nueva nota…"
                aria-label="Nueva nota"
                aria-expanded={createKind === "note"}
                onClick={() =>
                  setCreateKind((k) => (k === "note" ? null : "note"))
                }
              >
                <FilePlus style={{ width: 16, height: 16 }} />
              </button>
              <button
                ref={folderBtnRef}
                type="button"
                className="nav-section-btn"
                title="Nueva carpeta…"
                aria-label="Nueva carpeta"
                aria-expanded={createKind === "folder"}
                onClick={() =>
                  setCreateKind((k) => (k === "folder" ? null : "folder"))
                }
              >
                <FolderPlus style={{ width: 16, height: 16 }} />
              </button>
            </span>
          </div>
        )}
        <FolderTree />
        <CreateInVaultPopover
          kind="note"
          anchorRef={noteBtnRef}
          open={createKind === "note"}
          onClose={() => setCreateKind(null)}
        />
        <CreateInVaultPopover
          kind="folder"
          anchorRef={folderBtnRef}
          open={createKind === "folder"}
          onClose={() => setCreateKind(null)}
        />
      </nav>

      <div className="sidebar-foot">
        <button
          className={`nav-item ${view === "settings" ? "active" : ""}`}
          onClick={() => setView("settings")}
        >
          <span className="ni-ico"><Settings /></span>
          <span className="ni-label">Ajustes</span>
        </button>
        <div className="sync-row">
          <button
            type="button"
            className={`sync-chip ${syncWarn ? "has-conflicts" : ""} ${syncStatus === "syncing" ? "syncing" : ""}`}
            onClick={() => hasConflicts && openConflict(conflicts[0])}
            title={hasConflicts ? "Resolver conflictos" : syncTitle}
          >
            <span className="dot" />
            {syncLabel}
          </button>
          {connected && (
            <button
              type="button"
              className="sync-chip-btn"
              disabled={syncStatus === "syncing"}
              onClick={() => runSync()}
              title="Sincronizar con OneDrive ahora"
            >
              <RefreshCw style={{ width: 15, height: 15 }} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
