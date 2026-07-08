import { useMemo, useRef, useState, type PointerEvent } from "react";
import { FileText, LayoutList, Columns3, Search } from "lucide-react";
import { useTasksStore } from "../../stores/tasksStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";
import {
  buildTaskTree,
  countNodes,
  filterTaskNodes,
  indexTaskNodes,
  sortNodesDocumentOrder,
  sourceLabel,
} from "../../lib/taskParser";
import type { Task } from "../../lib/tauri";
import TaskCard from "./TaskCard";

const KANBAN_COLS: { status: Task["status"]; label: string; dot: string }[] = [
  { status: "todo", label: "Pendiente", dot: "soon" },
  { status: "doing", label: "En progreso", dot: "today" },
  { status: "done", label: "Completado", dot: "done" },
];

const DRAG_THRESHOLD = 5;

function ListMode({ searchQuery }: { searchQuery: string }) {
  const tasks = useTasksStore((s) => s.tasks);
  const { roots, nodeIndex } = useMemo(() => {
    const tree = buildTaskTree(tasks);
    return {
      roots: filterTaskNodes(tree, searchQuery),
      nodeIndex: indexTaskNodes(tree),
    };
  }, [tasks, searchQuery]);
  const hasQuery = searchQuery.trim().length > 0;

  if (tasks.length === 0) {
    return (
      <p className="empty-hint">
        No se detectaron tareas. Añade <code>- [ ] algo</code> en cualquier nota.
      </p>
    );
  }

  if (hasQuery && roots.length === 0) {
    return (
      <p className="empty-hint">Ninguna tarea coincide con «{searchQuery.trim()}».</p>
    );
  }

  return (
    <>
      {KANBAN_COLS.map((col) => {
        const nodes = roots
          .filter((n) => n.task.status === col.status)
          .sort(sortNodesDocumentOrder);
        if (nodes.length === 0) return null;
        return (
          <div className="task-group" key={col.status}>
            <div className="tg-head">
              <span className={`tg-dot ${col.dot}`} /> {col.label}{" "}
              <span className="tg-n">{countNodes(nodes)}</span>
            </div>
            <ul className="task-list">
              {nodes.map((n) => (
                <TaskCard
                  key={`${n.task.source_path}:${n.task.source_line}`}
                  task={n.task}
                  variant="list"
                  subtasks={n.children}
                  nodeIndex={nodeIndex}
                  searchQuery={searchQuery}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function KanbanMode({ searchQuery }: { searchQuery: string }) {
  const tasks = useTasksStore((s) => s.tasks);
  const { roots, nodeIndex } = useMemo(() => {
    const tree = buildTaskTree(tasks);
    return {
      roots: filterTaskNodes(tree, searchQuery),
      nodeIndex: indexTaskNodes(tree),
    };
  }, [tasks, searchQuery]);
  const hasQuery = searchQuery.trim().length > 0;
  const moveTo = useTasksStore((s) => s.moveTo);
  const kanbanRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<{
    key: string;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Task["status"] | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  // Tras un arrastre real, suprimir el click sintético que abriría la nota.
  const draggedRef = useRef(false);

  const keyOf = (t: Task) => `${t.source_path}:${t.source_line}`;
  const byKey = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) m.set(keyOf(t), t);
    return m;
  }, [tasks]);

  const colFromPointer = (clientX: number, clientY: number): Task["status"] | null => {
    const cols = kanbanRef.current?.querySelectorAll<HTMLElement>("[data-kan-col]");
    if (!cols) return null;
    for (const col of cols) {
      const rect = col.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return col.dataset.kanCol as Task["status"];
      }
    }
    return null;
  };

  const resetDrag = () => {
    sessionRef.current = null;
    setDragKey(null);
    setOverCol(null);
    setGhost(null);
  };

  const isDragBlocked = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      "button, .t-from, .task-popover, .task-shortcut, .task-pill, .cb, .task-status, a, input",
    );
  };

  const onCardPointerDown = (key: string, e: PointerEvent) => {
    if (isDragBlocked(e.target)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sessionRef.current = {
      key,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };
  };

  const onCardPointerMove = (e: PointerEvent) => {
    const session = sessionRef.current;
    if (!session) return;

    if (!session.dragging) {
      const dx = Math.abs(e.clientX - session.startX);
      const dy = Math.abs(e.clientY - session.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      session.dragging = true;
      setDragKey(session.key);
    }

    setOverCol(colFromPointer(e.clientX, e.clientY));
    setGhost({ x: e.clientX, y: e.clientY });
  };

  const onCardPointerUp = async (e: PointerEvent) => {
    const session = sessionRef.current;
    if (!session) return;

    if (session.dragging) {
      draggedRef.current = true;
      const targetCol = colFromPointer(e.clientX, e.clientY);
      const t = byKey.get(session.key);
      if (t && targetCol && t.status !== targetCol) {
        await moveTo(t, targetCol);
      }
    }

    resetDrag();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onCardPointerCancel = (e: PointerEvent) => {
    resetDrag();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const ghostTask = dragKey ? byKey.get(dragKey) : null;

  if (tasks.length === 0) {
    return (
      <p className="empty-hint">
        No se detectaron tareas. Añade <code>- [ ] algo</code> en cualquier nota.
      </p>
    );
  }

  if (hasQuery && roots.length === 0) {
    return (
      <p className="empty-hint">Ninguna tarea coincide con «{searchQuery.trim()}».</p>
    );
  }

  return (
    <>
      <div className="kanban" ref={kanbanRef}>
        {KANBAN_COLS.map((col) => {
          const colNodes = roots
            .filter((n) => n.task.status === col.status)
            .sort(sortNodesDocumentOrder);
          const isOver = overCol === col.status && dragKey !== null;
          return (
            <div
              key={col.status}
              className={`kan-col ${isOver ? "drag-over" : ""}`}
              data-kan-col={col.status}
            >
              <div className="kan-head">
                <span className={`tg-dot ${col.dot}`} /> {col.label}
                <span className="tg-n">{countNodes(colNodes)}</span>
              </div>
              <div className={`kan-cards${isOver ? " drag-over" : ""}`}>
                {colNodes.map((n) => {
                  const key = keyOf(n.task);
                  const dragging = dragKey === key;
                  return (
                    <div
                      key={key}
                      className={`kan-card-row${dragging ? " dragging" : ""}`}
                      onPointerDown={(e) => onCardPointerDown(key, e)}
                      onPointerMove={onCardPointerMove}
                      onPointerUp={onCardPointerUp}
                      onPointerCancel={onCardPointerCancel}
                      onClickCapture={(e) => {
                        if (draggedRef.current) {
                          e.stopPropagation();
                          draggedRef.current = false;
                        }
                      }}
                    >
                      <TaskCard
                        task={n.task}
                        variant="kanban"
                        dragging={dragging}
                        subtasks={n.children}
                        nodeIndex={nodeIndex}
                        searchQuery={searchQuery}
                      />
                    </div>
                  );
                })}
                {isOver && (
                  <div className="kan-drop-hint" aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {ghost && ghostTask && (
        <div
          className="kan-card-ghost"
          style={{ left: ghost.x, top: ghost.y }}
          aria-hidden
        >
          <div className="kan-card-ghost-title">{ghostTask.text}</div>
          <div className="kan-card-ghost-from">
            <FileText style={{ width: 13, height: 13 }} /> {sourceLabel(ghostTask.rel_path)}
          </div>
        </div>
      )}
    </>
  );
}

export default function TasksPanel() {
  const mode = useUiStore((s) => s.tasksMode);
  const setTasksMode = useUiStore((s) => s.setTasksMode);
  const updateConfig = useVaultStore((s) => s.updateConfig);
  const [searchQuery, setSearchQuery] = useState("");

  const setMode = (m: "list" | "kanban") => {
    setTasksMode(m);
    updateConfig({ tasksMode: m });
  };

  return (
    <section className="view view-tasks">
      <div className="tasks-head">
        <div>
          <h1>Mis tareas</h1>
          <p className="muted">
            Detectadas automáticamente desde todas tus notas
          </p>
        </div>
        <div className="seg">
          <button
            className={`seg-btn ${mode === "list" ? "active" : ""}`}
            onClick={() => setMode("list")}
          >
            <LayoutList /> Lista
          </button>
          <button
            className={`seg-btn ${mode === "kanban" ? "active" : ""}`}
            onClick={() => setMode("kanban")}
          >
            <Columns3 /> Kanban
          </button>
        </div>
      </div>

      <div className="tasks-toolbar">
        <div className="tasks-search">
          <Search className="tasks-search-icon" aria-hidden />
          <input
            type="search"
            className="tasks-search-input"
            placeholder="Buscar tareas…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="tasks-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {mode === "list" ? (
        <ListMode searchQuery={searchQuery} />
      ) : (
        <KanbanMode searchQuery={searchQuery} />
      )}
    </section>
  );
}

/** Renderiza el panel de tareas como pestaña dentro de la barra de tabs. */
export function TasksTabPanels() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const taskTabs = tabs.filter((t) => t.kind === "tasks");

  if (taskTabs.length === 0) return null;

  return (
    <>
      {taskTabs.map((tab) => (
        <div
          key={tab.id}
          className="note-tab-panel"
          hidden={tab.id !== activeTabId}
        >
          <TasksPanel />
        </div>
      ))}
    </>
  );
}
