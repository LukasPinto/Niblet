import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  Database,
  FileText,
  FileSignature,
  Settings,
  SunMoon,
} from "lucide-react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore, noteTabId } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";
import { searchNoteContents, type ContentMatch } from "../../lib/tauri";

interface PaletteItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  /** Fragmento de contenido coincidente (solo en resultados por contenido). */
  snippet?: string;
  run: () => void;
  pin?: () => void;
}

/** Parte `text` en trozos resaltando (case-insensitive) las apariciones de `q`. */
function highlight(text: string, q: string): React.ReactNode {
  const query = q.trim();
  if (!query) return text;
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const found = lower.indexOf(ql, i);
    if (found === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (found > i) parts.push(text.slice(i, found));
    parts.push(
      <mark key={key++} className="pl-hl">
        {text.slice(found, found + ql.length)}
      </mark>,
    );
    i = found + ql.length;
  }
  return parts;
}

export default function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setView = useUiStore((s) => s.setView);
  const notes = useNotesStore((s) => s.notes);
  const openPreview = useTabsStore((s) => s.openPreview);
  const pinTab = useTabsStore((s) => s.pinTab);
  const openDatabaseTab = useTabsStore((s) => s.openDatabaseTab);
  const openTasksTab = useTabsStore((s) => s.openTasksTab);
  const config = useVaultStore((s) => s.config);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const vaultPath = useVaultStore((s) => s.vaultPath);

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setContentMatches([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Búsqueda por contenido (backend), con debounce. Solo a partir de 2 caracteres
  // para no escanear el vault entero en cada pulsación inicial.
  useEffect(() => {
    const q = query.trim();
    if (!open || !vaultPath || q.length < 2) {
      setContentMatches([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      searchNoteContents(vaultPath, q)
        .then((res) => {
          if (alive) setContentMatches(res);
        })
        .catch(() => {
          if (alive) setContentMatches([]);
        });
    }, 140);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, open, vaultPath]);

  const openNote = useMemo(
    () => async (path: string) => {
      await openPreview(path);
    },
    [openPreview],
  );

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();

    const commands: PaletteItem[] = [
      { id: "v-note", icon: <FileSignature />, label: "Ir al editor de notas", run: () => setView("note") },
      { id: "v-tasks", icon: <CheckSquare />, label: "Ir a mis tareas", run: () => void openTasksTab() },
      { id: "v-base", icon: <Database />, label: "Ir a la base de datos", run: () => void openDatabaseTab(null) },
      { id: "v-settings", icon: <Settings />, label: "Abrir ajustes", run: () => setView("settings") },
      {
        id: "c-theme",
        icon: <SunMoon />,
        label: "Cambiar tema claro/oscuro",
        run: () =>
          updateConfig({ theme: config.theme === "dark" ? "light" : "dark" }),
      },
    ];

    const noteItems: PaletteItem[] = notes.map((n) => ({
      id: `n-${n.path}`,
      icon: <FileText />,
      label: n.name,
      sub: n.folder || "raíz",
      run: () => void openNote(n.path),
      pin: () => void pinTab(noteTabId(n.path)),
    }));

    if (!q) return [...commands, ...noteItems];

    const cmdMatches = commands.filter((i) => i.label.toLowerCase().includes(q));
    const nameMatches = noteItems.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.sub?.toLowerCase().includes(q) ?? false),
    );

    // Resultados por contenido: excluir las notas ya listadas por nombre para
    // no duplicarlas.
    const shownPaths = new Set(
      nameMatches.map((i) => i.id.replace(/^n-/, "")),
    );
    const contentItems: PaletteItem[] = contentMatches
      .filter((m) => !shownPaths.has(m.path))
      .map((m) => ({
        id: `c-${m.path}`,
        icon: <FileText />,
        label: m.name,
        sub: m.folder || "raíz",
        snippet: m.snippet,
        run: () => void openNote(m.path),
        pin: () => void pinTab(noteTabId(m.path)),
      }));

    return [...cmdMatches, ...nameMatches, ...contentItems];
  }, [
    notes,
    query,
    contentMatches,
    config.theme,
    setView,
    openNote,
    pinTab,
    openTasksTab,
    openDatabaseTab,
    updateConfig,
  ]);

  // Mantener la selección dentro de rango cuando cambian los resultados.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const choose = (item: PaletteItem, pinned = false) => {
    if (pinned && item.pin) item.pin();
    else item.run();
    togglePalette(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[sel]) choose(items[sel], e.ctrlKey || e.metaKey);
    }
  };

  const q = query.trim();

  return (
    <div className="palette-overlay" onClick={() => togglePalette(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar notas, contenido, tareas, comandos…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {items.length === 0 && (
            <div className="pl-section">Sin resultados</div>
          )}
          {items.map((item, i) => (
            <div
              key={item.id}
              className={`pl-item ${item.snippet ? "has-snippet" : ""} ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(item)}
            >
              <span className="pl-ico">{item.icon}</span>
              {item.snippet ? (
                <span className="pl-text">
                  <span className="pl-title">{highlight(item.label, q)}</span>
                  <span className="pl-snippet">{highlight(item.snippet, q)}</span>
                </span>
              ) : (
                <span>{highlight(item.label, q)}</span>
              )}
              {item.sub && <span className="pl-sub">{item.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
