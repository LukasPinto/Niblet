import { useEffect, useMemo, useRef, useState } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore, noteTabId } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";

interface PaletteItem {
  id: string;
  icon: string;
  label: string;
  sub?: string;
  run: () => void;
  pin?: () => void;
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

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const commands: PaletteItem[] = [
      { id: "v-note", icon: "📝", label: "Ir al editor de notas", run: () => setView("note") },
      { id: "v-tasks", icon: "✅", label: "Ir a mis tareas", run: () => void openTasksTab() },
      { id: "v-base", icon: "🗂️", label: "Ir a la base de datos", run: () => void openDatabaseTab(null) },
      { id: "v-settings", icon: "⚙️", label: "Abrir ajustes", run: () => setView("settings") },
      {
        id: "c-theme",
        icon: "🌗",
        label: "Cambiar tema claro/oscuro",
        run: () =>
          updateConfig({ theme: config.theme === "dark" ? "light" : "dark" }),
      },
    ];
    const noteItems: PaletteItem[] = notes.map((n) => ({
      id: `n-${n.path}`,
      icon: "📄",
      label: n.name,
      sub: n.folder || "raíz",
      run: async () => {
        await openPreview(n.path);
      },
      pin: async () => {
        await pinTab(noteTabId(n.path));
      },
    }));

    const all = [...commands, ...noteItems];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.sub?.toLowerCase().includes(q) ?? false),
    );
  }, [notes, query, config.theme, setView, openPreview, pinTab, openDatabaseTab, updateConfig]);

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

  return (
    <div className="palette-overlay" onClick={() => togglePalette(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar notas, tareas, comandos…"
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
              className={`pl-item ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(item)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.sub && <span className="pl-sub">{item.sub}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
