import {
  CalendarDays,
  CheckSquare,
  HardDrive,
  Palette,
  TriangleAlert,
} from "lucide-react";
import { useVaultStore, type AccentName } from "../../stores/vaultStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useUiStore } from "../../stores/uiStore";
import { openDailyNote } from "../../lib/dailyNotes";
import OneDrivePanel from "./OneDrivePanel";

const ACCENTS: { name: AccentName; color: string }[] = [
  { name: "blue", color: "#2383e2" },
  { name: "teal", color: "#0f7b6c" },
  { name: "amber", color: "#c47b00" },
  { name: "rose", color: "#c0392b" },
];

export default function Settings() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const config = useVaultStore((s) => s.config);
  const updateConfig = useVaultStore((s) => s.updateConfig);

  const conflicts = useTasksStore((s) => s.conflicts);
  const refreshConflicts = useTasksStore((s) => s.refreshConflicts);
  const openConflict = useUiStore((s) => s.openConflict);

  return (
    <section className="view view-settings">
      <div className="tasks-head">
        <div>
          <h1>Ajustes</h1>
          <p className="muted">
            Se guardan dentro del Vault (<code>.niblet/config.json</code>) y viajan
            con OneDrive a otros dispositivos
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <OneDrivePanel />

        <div className="set-card">
          <div className="set-title"><HardDrive /> Vault local</div>
          <div className="set-row">
            <span>Carpeta del Vault</span>
            <code className="val">{vaultPath}</code>
          </div>
          <div className="set-row">
            <span>Incluir ajustes/config</span>
            <button
              className={`switch ${config.includeConfigInSync ? "on" : ""}`}
              onClick={() =>
                updateConfig({ includeConfigInSync: !config.includeConfigInSync })
              }
            >
              <i />
            </button>
          </div>
          <div className="set-row">
            <span>Conflictos locales</span>
            <span className={`badge ${conflicts.length ? "warn" : "ok"}`}>
              {conflicts.length === 0 ? "Ninguno" : `${conflicts.length} pendiente(s)`}
            </span>
          </div>
          <div className="set-row">
            <span>Revisar disco</span>
            <button className="btn ghost" onClick={() => refreshConflicts()}>
              Buscar ahora
            </button>
          </div>
        </div>

        <div className="set-card">
          <div className="set-title"><Palette /> Apariencia</div>
          <div className="set-row">
            <span>Tema</span>
            <button
              className="badge"
              onClick={() =>
                updateConfig({ theme: config.theme === "dark" ? "light" : "dark" })
              }
            >
              {config.theme === "dark" ? "Oscuro" : "Claro"}
            </button>
          </div>
          <div className="set-row">
            <span>Color de acento</span>
            <div className="accent-dots inline">
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
          <div className="set-row">
            <span>Fuente del editor</span>
            <span className="badge">JetBrains Mono</span>
          </div>
        </div>

        <div className="set-card">
          <div className="set-title"><CalendarDays /> Notas diarias</div>
          <div className="set-row">
            <span>Carpeta</span>
            <input
              className="set-input"
              type="text"
              value={config.dailyNotesFolder}
              placeholder="Daily Notes"
              onChange={(e) => updateConfig({ dailyNotesFolder: e.target.value })}
            />
          </div>
          <div className="set-row">
            <span>Formato de fecha</span>
            <input
              className="set-input"
              type="text"
              value={config.dailyNotesDateFormat}
              placeholder="YYYY-MM-DD"
              onChange={(e) =>
                updateConfig({ dailyNotesDateFormat: e.target.value })
              }
            />
          </div>
          <div className="set-row">
            <span>Expandir carpeta al abrir</span>
            <button
              className={`switch ${config.dailyNotesAutoReveal ? "on" : ""}`}
              onClick={() =>
                updateConfig({
                  dailyNotesAutoReveal: !config.dailyNotesAutoReveal,
                })
              }
            >
              <i />
            </button>
          </div>
          <div className="set-row">
            <span>Nota de hoy</span>
            <button className="btn ghost" onClick={() => void openDailyNote()}>
              Abrir ahora
            </button>
          </div>
        </div>

        <div className="set-card">
          <div className="set-title"><CheckSquare /> Tareas</div>
          <div className="set-row">
            <span>Sintaxis de fecha</span>
            <code>{config.taskSyntax.due} YYYY-MM-DD</code>
          </div>
          <div className="set-row">
            <span>En progreso</span>
            <code>- [/]</code>
          </div>
          <div className="set-row">
            <span>Prioridad alta</span>
            <code>{config.taskSyntax.highPriority}</code>
          </div>
        </div>

        <div className="set-card">
          <div className="set-title"><TriangleAlert /> Conflictos pendientes</div>
          {conflicts.length === 0 ? (
            <p className="empty-hint">Todo sincronizado. No hay conflictos.</p>
          ) : (
            conflicts.map((c) => (
              <div className="set-row" key={c.rel_path}>
                <span>{c.rel_path}</span>
                <button className="btn primary" onClick={() => openConflict(c)}>
                  Resolver
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
