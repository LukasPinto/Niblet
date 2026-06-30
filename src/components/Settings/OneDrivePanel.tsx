import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVaultStore, DEFAULT_ONEDRIVE } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useSyncStore } from "../../stores/syncStore";
import {
  isConfigured,
  getClientId,
  setClientId,
  getAccount,
  logout,
  startDeviceLogin,
  pollDeviceLogin,
  resolveConflict,
  type DeviceCodeInfo,
} from "../../lib/onedrive";
import type { OneDriveConfig } from "../../stores/vaultStore";

export default function OneDrivePanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const config = useVaultStore((s) => s.config);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const od = config.onedrive;

  const [configured, setConfigured] = useState(true);
  const [clientId, setClientIdState] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceCodeInfo | null>(null);
  const [folder, setFolder] = useState(od?.remoteFolder ?? "NibletVault");
  const [intervalMins, setIntervalMins] = useState(
    String(od?.syncIntervalMinutes ?? DEFAULT_ONEDRIVE.syncIntervalMinutes),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncResult = useSyncStore((s) => s.lastResult);
  const runVaultSync = useSyncStore((s) => s.runSync);
  const pollTimer = useRef<number | undefined>(undefined);

  const odConfig = (): OneDriveConfig => ({
    ...DEFAULT_ONEDRIVE,
    ...od,
    remoteFolder: folder.trim(),
    accountName: account ?? od?.accountName ?? "",
  });

  const patchOd = (patch: Partial<OneDriveConfig>) =>
    updateConfig({ onedrive: { ...odConfig(), ...patch } });

  useEffect(() => {
    isConfigured().then(setConfigured);
    getClientId().then((id) => setClientIdState(id));
    getAccount().then(setAccount);
    return () => window.clearTimeout(pollTimer.current);
  }, []);

  const connected = !!account;

  const saveClientId = async () => {
    await setClientId(clientId);
    setConfigured(await isConfigured());
    setError(null);
  };

  // Inicia el device code flow y arranca el polling.
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await startDeviceLogin();
      setDevice(info);
      await openUrl(info.verification_uri).catch(() => {});
      const startedAt = Date.now();
      const poll = async () => {
        if (Date.now() - startedAt > info.expires_in * 1000) {
          setError("El código caducó. Inténtalo de nuevo.");
          setDevice(null);
          setBusy(false);
          return;
        }
        try {
          const res = await pollDeviceLogin(info.device_code);
          if (res.startsWith("authorized:")) {
            const name = res.slice("authorized:".length);
            setAccount(name);
            await patchOd({ accountName: name });
            setDevice(null);
            setBusy(false);
            return;
          }
          // pendiente: seguir intentando
          pollTimer.current = window.setTimeout(poll, info.interval * 1000);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setDevice(null);
          setBusy(false);
        }
      };
      pollTimer.current = window.setTimeout(poll, info.interval * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    window.clearTimeout(pollTimer.current);
    await logout();
    setAccount(null);
    setDevice(null);
    setBusy(false);
    await patchOd({ accountName: "" });
  };

  const runSync = async () => {
    if (!vaultPath) return;
    setBusy(true);
    setError(null);
    try {
      await patchOd({ remoteFolder: folder.trim(), accountName: account ?? "" });
      await runVaultSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveInterval = () => {
    const n = Math.max(0, parseInt(intervalMins, 10) || 0);
    setIntervalMins(String(n));
    patchOd({ syncIntervalMinutes: n });
  };

  const resolve = async (rel: string, choice: "local" | "remote") => {
    if (!vaultPath) return;
    setBusy(true);
    try {
      await resolveConflict(vaultPath, folder.trim(), rel, choice);
      const lr = useSyncStore.getState().lastResult;
      if (lr) {
        useSyncStore.setState({
          lastResult: { ...lr, conflicts: lr.conflicts.filter((c) => c !== rel) },
        });
      }
      await useNotesStore.getState().refreshNotes();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-card" style={{ gridColumn: "1 / -1" }}>
      <div className="set-title">☁️ Sincronización con OneDrive</div>

      {!configured && (
        <div className="od-setup">
          <p className="muted" style={{ marginBottom: 8 }}>
            OneDrive necesita un <strong>Client ID</strong> de Azure (configuración
            única del desarrollador). Registra una app en{" "}
            <code>portal.azure.com › App registrations</code> como{" "}
            <em>“Mobile and desktop”</em> con <em>“Allow public client flows = Sí”</em>
            {" "}(no requiere redirect ni secreto), y pega aquí su Client ID.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="ctx-input"
              style={{ flex: 1 }}
              placeholder="Application (client) ID"
              value={clientId}
              onChange={(e) => setClientIdState(e.target.value)}
            />
            <button className="btn primary" onClick={saveClientId}>
              Guardar
            </button>
          </div>
        </div>
      )}

      {configured && (
        <>
          <div className="set-row">
            <span>Cuenta</span>
            {connected ? (
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="badge ok">{account}</span>
                <button className="btn ghost" disabled={busy} onClick={disconnect}>
                  Desconectar
                </button>
              </span>
            ) : (
              <button className="btn primary" disabled={busy} onClick={connect}>
                Conectar con Microsoft
              </button>
            )}
          </div>

          {device && (
            <div className="od-devicecode">
              <p className="muted">
                Se abrió tu navegador en <code>{device.verification_uri}</code>.
                Introduce este código e inicia sesión con tu cuenta OneDrive:
              </p>
              <div className="od-code">{device.user_code}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost" onClick={() => openUrl(device.verification_uri)}>
                  Abrir de nuevo
                </button>
                <span className="muted" style={{ alignSelf: "center" }}>
                  Esperando autorización…
                </span>
              </div>
            </div>
          )}

          <div className="set-row">
            <span>Carpeta remota</span>
            <input
              className="ctx-input"
              style={{ width: 200 }}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="NibletVault"
            />
          </div>

          <div className="set-row">
            <span>Sincronizar al abrir vault</span>
            <button
              className={`switch ${od?.autoSync ?? DEFAULT_ONEDRIVE.autoSync ? "on" : ""}`}
              onClick={() => patchOd({ autoSync: !(od?.autoSync ?? DEFAULT_ONEDRIVE.autoSync) })}
            >
              <i />
            </button>
          </div>

          <div className="set-row">
            <span>Sincronizar al guardar</span>
            <button
              className={`switch ${od?.syncOnSave ?? DEFAULT_ONEDRIVE.syncOnSave ? "on" : ""}`}
              onClick={() =>
                patchOd({ syncOnSave: !(od?.syncOnSave ?? DEFAULT_ONEDRIVE.syncOnSave) })
              }
            >
              <i />
            </button>
          </div>

          <div className="set-row">
            <span>Intervalo periódico (min)</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                className="ctx-input"
                style={{ width: 64 }}
                type="number"
                min={0}
                step={1}
                value={intervalMins}
                onChange={(e) => setIntervalMins(e.target.value)}
                onBlur={saveInterval}
                onKeyDown={(e) => e.key === "Enter" && saveInterval()}
              />
              <span className="muted" style={{ fontSize: 12 }}>0 = desactivado</span>
            </span>
          </div>

          <div className="set-row">
            <span>Última sincronización</span>
            <span className="val">
              {od?.lastSync ? new Date(od.lastSync).toLocaleString() : "Nunca"}
            </span>
          </div>

          <div className="set-row" style={{ borderTop: 0, paddingTop: 4 }}>
            <button className="btn primary" disabled={busy || !connected} onClick={runSync}>
              {busy ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
            {syncResult && (
              <span className="muted">
                ↑ {syncResult.uploaded} subidas · ↓ {syncResult.downloaded} descargas
              </span>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="muted" style={{ color: "var(--red)" }}>
          ⚠️ {error}
        </p>
      )}

      {syncResult && syncResult.conflicts.length > 0 && (
        <>
          <div className="set-title" style={{ marginTop: 14 }}>
            ⚠️ Conflictos ({syncResult.conflicts.length})
          </div>
          <p className="muted">Ambos lados cambiaron. Elige qué versión conservar:</p>
          {syncResult.conflicts.map((rel) => (
            <div className="set-row" key={rel}>
              <span>{rel}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn ghost" disabled={busy} onClick={() => resolve(rel, "local")}>
                  Subir el mío
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => resolve(rel, "remote")}>
                  Bajar el de OneDrive
                </button>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
