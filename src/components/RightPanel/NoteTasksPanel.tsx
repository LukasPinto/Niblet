import { useMemo } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { taskIndentStyle } from "../../lib/taskParser";
import { parseNoteTasks, type NoteTask } from "../../lib/noteTasks";
import { readNote, type Task } from "../../lib/tauri";

/** Resumen de tareas de la nota activa, dentro del panel derecho. */
export default function NoteTasksPanel() {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const path = activeTab?.kind === "note" ? activeTab.path : undefined;
  const content = activeTab?.kind === "note" ? (activeTab.content ?? "") : "";

  const entry = useNotesStore((s) =>
    path ? s.notes.find((n) => n.path === path) : undefined,
  );
  const toggle = useTasksStore((s) => s.toggle);
  const collapsed = useUiStore((s) => s.noteTasksCollapsed);
  const setCollapsed = useUiStore((s) => s.setNoteTasksCollapsed);
  const setTabContent = useTabsStore((s) => s.setTabContent);
  const saveTab = useTabsStore((s) => s.saveTab);

  // Parseamos las tareas del contenido en vivo (no del índice global del backend)
  // para que el panel refleje lo que se escribe sin re-escanear todo el vault.
  const noteTasks = useMemo(() => parseNoteTasks(content), [content]);

  if (!entry || !path) return null;

  const doneCount = noteTasks.filter((t) => t.done).length;
  const pct = noteTasks.length
    ? Math.round((doneCount / noteTasks.length) * 100)
    : 0;

  const onToggle = async (t: NoteTask) => {
    const tab = useTabsStore.getState().getNoteTab(path);
    if (tab?.dirty) await saveTab(path);
    // El store `toggle` solo lee source_path/source_line/done.
    await toggle({
      source_path: path,
      source_line: t.sourceLine,
      done: t.done,
    } as Task);
    const fresh = await readNote(path);
    setTabContent(path, fresh);
  };

  return (
    <div className="side-card">
      <div className="side-head-row">
        <div className="side-head">Tareas de esta nota</div>
        <button
          type="button"
          className="side-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expandir tareas" : "Colapsar tareas"}
          aria-expanded={!collapsed}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!collapsed &&
        (noteTasks.length === 0 ? (
          <p className="empty-hint">Sin tareas. Escribe <code>- [ ] algo</code>.</p>
        ) : (
          <>
            <div className="mini-progress">
              <div className="bar" style={{ ["--p" as string]: `${pct}%` }} />
              <span>{doneCount}/{noteTasks.length}</span>
            </div>
            <ul className="side-tasks">
              {noteTasks.map((t) => (
                <li
                  key={`${t.sourceLine}`}
                  className={t.done ? "done" : ""}
                  style={taskIndentStyle(t.indentLevel)}
                  onClick={() => onToggle(t)}
                >
                  <span className={`cb sm ${t.done ? "checked" : ""}`} />
                  {t.text}
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}
