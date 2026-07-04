import { useRef, useState } from "react";
import { Cloud, FolderOpen, KeyRound, Notebook } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVaultStore, DEFAULT_ONEDRIVE } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useTasksStore } from "../../stores/tasksStore";
import {
  isConfigured,
  getAccount,
  startDeviceLogin,
  pollDeviceLogin,
  cloneVaultFromRemote,
  type DeviceCodeInfo,
} from "../../lib/onedrive";
import { createDirectory } from "../../lib/tauri";

type View = "home" | "auth" | "form";

export default function Welcome() {
  const openVault = useVaultStore((s) => s.openVault);
  const setVault = useVaultStore((s) => s.setVault);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const setCloneProgress = useVaultStore((s) => s.setCloneProgress);
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const openRecentVault = useVaultStore((s) => s.openRecentVault);
  const removeRecent = useVaultStore((s) => s.removeRecent);

  const [view, setView] = useState<View>("home");
  const [account, setAccount] = useState<string | null>(null);
  const [noClientId, setNoClientId] = useState(false);

  /* ---- Auth state ---- */
  const [device, setDevice] = useState<DeviceCodeInfo | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const pollTimer = useRef<number | undefined>(undefined);

  /* ---- Form state ---- */
  const [remoteName, setRemoteName] = useState("NibletVault");
  const [localPath, setLocalPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  /* ---- Handlers ---- */

  const handleRemoteClick = async () => {
    const [cfg, acc] = await Promise.all([isConfigured(), getAccount()]);
    if (!cfg) {
      setNoClientId(true);
      setView("auth");
      return;
    }
    setNoClientId(false);
    if (acc) {
      setAccount(acc);
      setView("form");
    } else {
      setView("auth");
    }
  };

  const startAuth = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const info = await startDeviceLogin();
      setDevice(info);
      await openUrl(info.verification_uri).catch(() => {});
      const startedAt = Date.now();
      const poll = async () => {
        if (Date.now() - startedAt > info.expires_in * 1000) {
          setAuthError("El código caducó. Inténtalo de nuevo.");
          setDevice(null);
          setAuthBusy(false);
          return;
        }
        try {
          const res = await pollDeviceLogin(info.device_code);
          if (res.startsWith("authorized:")) {
            const name = res.slice("authorized:".length);
            setAccount(name);
            setDevice(null);
            setAuthBusy(false);
            setView("form");
            return;
          }
          pollTimer.current = window.setTimeout(poll, info.interval * 1000);
        } catch (e) {
          setAuthError(e instanceof Error ? e.message : String(e));
          setDevice(null);
          setAuthBusy(false);
        }
      };
      pollTimer.current = window.setTimeout(poll, info.interval * 1000);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
      setAuthBusy(false);
    }
  };

  const pickDestination = async () => {
    const selected = await open({
      directory: true,
      title: "Elige dónde guardar el Vault",
    });
    if (typeof selected === "string") {
      setLocalPath(selected.replace(/\\/g, "/") + "/" + remoteName.trim());
    }
  };

  // Update the path suffix when the remote name changes (only if user hasn't
  // manually edited localPath beyond the auto-generated value).
  const handleRemoteNameChange = (name: string) => {
    setRemoteName(name);
    if (!localPath) return;
    const slash = localPath.lastIndexOf("/");
    if (slash !== -1) {
      setLocalPath(localPath.slice(0, slash + 1) + name);
    }
  };

  const handleClone = async () => {
    if (!localPath || !remoteName) return;
    setSubmitting(true);
    setCloneError(null);
    try {
      await createDirectory(localPath);
      await setVault(localPath);
      await updateConfig({
        onedrive: {
          ...DEFAULT_ONEDRIVE,
          remoteFolder: remoteName.trim(),
          accountName: account ?? "",
        },
      });
      // Arrancar la barra de progreso antes de que el componente se desmonte.
      setCloneProgress({ active: true, done: 0, total: 0, error: null });

      // La descarga sigue corriendo aunque el componente se desmonte.
      void cloneVaultFromRemote(
        remoteName.trim(),
        localPath,
        (done, total) => {
          useVaultStore
            .getState()
            .setCloneProgress({ active: true, done, total, error: null });
          if (done % 5 === 0 || done === total) {
            void useNotesStore.getState().refreshNotes();
          }
        },
      )
        .then(() => {
          useVaultStore.getState().setCloneProgress(null);
          void useNotesStore.getState().refreshNotes();
          void useTasksStore.getState().refreshTasks();
        })
        .catch((e: unknown) => {
          useVaultStore.getState().setCloneProgress({
            active: false,
            done: 0,
            total: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        });
    } catch (e) {
      setSubmitting(false);
      setCloneError(e instanceof Error ? e.message : String(e));
    }
  };

  /* ---- Render ---- */

  if (view === "home") {
    return (
      <div className="center-state">
        <div className="cs-emoji"><Notebook style={{ width: 44, height: 44 }} /></div>
        <h2>Bienvenido a Niblet</h2>
        <p className="muted" style={{ maxWidth: 400, marginBottom: 28 }}>
          Elige cómo quieres empezar.
        </p>
        <div className="welcome-cards">
          <button className="welcome-card" onClick={() => void openVault()}>
            <span className="wc-icon"><FolderOpen style={{ width: 30, height: 30 }} /></span>
            <span className="wc-title">Vault local</span>
            <span className="wc-desc">
              Abre una carpeta de tu equipo como Vault y sincroniza
              manualmente cuando quieras.
            </span>
          </button>
          <button
            className="welcome-card"
            onClick={() => void handleRemoteClick()}
          >
            <span className="wc-icon"><Cloud style={{ width: 30, height: 30 }} /></span>
            <span className="wc-title">Desde OneDrive</span>
            <span className="wc-desc">
              Descarga un Vault desde tu OneDrive y empieza a trabajar
              mientras los archivos llegan.
            </span>
          </button>
        </div>

        {recentVaults.length > 0 && (
          <div className="welcome-recents">
            <div className="welcome-recents-title">Vaults recientes</div>
            <ul className="welcome-recents-list">
              {recentVaults.map((r) => (
                <li key={r.path} className="welcome-recent">
                  <button
                    type="button"
                    className="welcome-recent-main"
                    title={`Abrir ${r.path}`}
                    onClick={() => void openRecentVault(r.path)}
                  >
                    <span className="welcome-recent-badge">
                      {r.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="welcome-recent-text">
                      <span className="welcome-recent-name">{r.name}</span>
                      <span className="welcome-recent-path">{r.path}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="welcome-recent-remove"
                    title="Quitar de recientes"
                    aria-label="Quitar de recientes"
                    onClick={() => removeRecent(r.path)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (view === "auth") {
    if (noClientId) {
      return (
        <div className="center-state">
          <div className="cs-emoji"><KeyRound style={{ width: 44, height: 44 }} /></div>
          <h2>Client ID requerido</h2>
          <p className="muted" style={{ maxWidth: 380 }}>
            Antes de conectarte a OneDrive necesitas registrar una aplicación
            en Azure y pegar el <strong>Client ID</strong> en{" "}
            <em>Ajustes → OneDrive</em>.
          </p>
          <button className="btn ghost" onClick={() => setView("home")}>
            ← Volver
          </button>
        </div>
      );
    }

    return (
      <div className="center-state">
        <div className="cs-emoji"><Cloud style={{ width: 44, height: 44 }} /></div>
        <h2>Conectar con OneDrive</h2>

        {!device && (
          <>
            <p className="muted" style={{ maxWidth: 380, marginBottom: 20 }}>
              Necesitas autorizar Niblet para acceder a tu OneDrive.
            </p>
            {authError && (
              <p className="muted" style={{ color: "var(--red)", marginBottom: 12 }}>
                {authError}
              </p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={() => setView("home")}>
                ← Volver
              </button>
              <button
                className="btn primary"
                onClick={() => void startAuth()}
                disabled={authBusy}
              >
                {authBusy ? "Iniciando…" : "Conectar con Microsoft"}
              </button>
            </div>
          </>
        )}

        {device && (
          <div className="od-devicecode" style={{ maxWidth: 360 }}>
            <p className="muted" style={{ marginBottom: 8 }}>
              Visita{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(device.verification_uri);
                }}
                style={{ color: "var(--accent)" }}
              >
                microsoft.com/devicelogin
              </a>{" "}
              e introduce este código:
            </p>
            <div className="od-code">{device.user_code}</div>
            <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>
              Esperando autorización…
            </p>
          </div>
        )}
      </div>
    );
  }

  /* ---- Form view ---- */
  return (
    <div className="center-state">
      <div className="cs-emoji"><Cloud style={{ width: 44, height: 44 }} /></div>
      <h2>Cargar Vault desde OneDrive</h2>
      {account && (
        <p className="muted" style={{ marginBottom: 20 }}>
          Conectado como <strong>{account}</strong>
        </p>
      )}

      <div className="welcome-form">
        <div className="wf-field">
          <label className="wf-label">
            Nombre del Vault en OneDrive
          </label>
          <input
            className="ctx-input"
            style={{ width: "100%" }}
            value={remoteName}
            onChange={(e) => handleRemoteNameChange(e.target.value)}
            placeholder="NibletVault"
            autoFocus
          />
          <span className="wf-hint">
            Carpeta en la raíz de tu OneDrive (p.ej.{" "}
            <code>OneDrive / {remoteName || "NibletVault"}</code>)
          </span>
        </div>

        <div className="wf-field">
          <label className="wf-label">Carpeta de destino local</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="ctx-input"
              style={{ flex: 1, minWidth: 0 }}
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="Elige una carpeta…"
            />
            <button
              className="btn ghost"
              onClick={() => void pickDestination()}
              style={{ flexShrink: 0 }}
            >
              Elegir…
            </button>
          </div>
          {localPath && (
            <span className="wf-hint">
              El Vault se guardará en <code>{localPath}</code>
            </span>
          )}
        </div>

        {cloneError && (
          <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
            {cloneError}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            className="btn ghost"
            onClick={() => setView("home")}
            disabled={submitting}
          >
            ← Volver
          </button>
          <button
            className="btn primary"
            onClick={() => void handleClone()}
            disabled={!localPath || !remoteName || submitting}
          >
            {submitting ? "Preparando…" : "Descargar Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
