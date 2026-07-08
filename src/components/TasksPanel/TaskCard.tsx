import { useEffect, useMemo, useState } from "react";
import { Calendar, FileText, Flag } from "lucide-react";
import { useTasksStore } from "../../stores/tasksStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../stores/uiStore";
import {
  countDoneNodes,
  countNodes,
  dueLabel,
  duePillClass,
  nodeHasMatchingDescendant,
  priorityLabel,
  sourceLabel,
  taskNodeKey,
  type TaskNode,
} from "../../lib/taskParser";
import type { Task } from "../../lib/tauri";
import TaskDatePicker from "./TaskDatePicker";
import TaskPriorityPicker from "./TaskPriorityPicker";
import TaskStatusControl from "./TaskStatusControl";

type PickerKind = "date" | "priority" | null;

interface TaskCardProps {
  task: Task;
  variant: "list" | "kanban";
  dragging?: boolean;
  /** Subtareas visibles (pueden estar filtradas por búsqueda). */
  subtasks?: TaskNode[];
  /** Índice del árbol completo sin filtrar (progreso y metadatos). */
  nodeIndex: Map<string, TaskNode>;
  searchQuery?: string;
}

export default function TaskCard({
  task,
  variant,
  dragging = false,
  subtasks = [],
  nodeIndex,
  searchQuery = "",
}: TaskCardProps) {
  const setDueDate = useTasksStore((s) => s.setDueDate);
  const setPriority = useTasksStore((s) => s.setPriority);
  const openPreview = useTabsStore((s) => s.openPreview);
  const setView = useUiStore((s) => s.setView);

  const [openPicker, setOpenPicker] = useState<PickerKind>(null);
  const [collapsed, setCollapsed] = useState(true);

  const fullNode = nodeIndex.get(taskNodeKey(task));
  const allSubtasks = fullNode?.children ?? subtasks;
  const hasQuery = searchQuery.trim().length > 0;

  const expandForSearch = useMemo(
    () =>
      hasQuery &&
      fullNode != null &&
      nodeHasMatchingDescendant(fullNode, searchQuery),
    [fullNode, hasQuery, searchQuery],
  );

  useEffect(() => {
    if (expandForSearch) setCollapsed(false);
  }, [expandForSearch]);

  const noteLabel = sourceLabel(task.rel_path);

  const duePill = dueLabel(task);
  const prio = priorityLabel(task);
  const hasSubs = allSubtasks.length > 0;
  const hasVisibleSubs = subtasks.length > 0;
  const subCount = hasSubs ? countNodes(allSubtasks) : 0;
  const doneCount = hasSubs ? countDoneNodes(allSubtasks) : 0;
  const progressPct = hasSubs ? Math.round((doneCount / subCount) * 100) : 0;
  const showChevron = hasQuery ? hasVisibleSubs : hasSubs;

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((c) => !c);
  };

  const chevron = showChevron ? (
    <button
      type="button"
      className="task-collapse"
      onClick={toggleCollapse}
      title={collapsed ? "Mostrar subtareas" : "Ocultar subtareas"}
      aria-expanded={!collapsed}
    >
      <span className={`task-chevron${collapsed ? "" : " open"}`}>▸</span>
    </button>
  ) : (
    <span className="task-collapse-spacer" aria-hidden />
  );

  const openOwnNote = async () => {
    await openPreview(task.source_path);
    setView("note");
  };

  const goToSource = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await openOwnNote();
  };

  /** Abrir la nota al hacer clic en la tarjeta, salvo en controles interactivos. */
  const onCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button, .task-status, .cb, .task-pill, .task-popover, .t-from, a, input",
      )
    ) {
      return;
    }
    void openOwnNote();
  };

  const openDate = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenPicker("date");
  };

  const openPriority = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenPicker("priority");
  };

  const titleRow = (
    <div className="t-text-row">
      <span className="t-text">{task.text}</span>
      {hasSubs && collapsed && (
        <span className="subtask-count" title={`${subCount} subtarea(s)`}>
          {subCount}
        </span>
      )}
    </div>
  );

  const metaContent = (
    <>
      <span
        className="t-from"
        role="link"
        title={`Abrir nota: ${noteLabel}`}
        draggable={false}
        onClick={goToSource}
      >
        <FileText style={{ width: 13, height: 13 }} /> {noteLabel}
      </span>

      <div className="task-shortcuts">
          <div className="task-shortcut-wrap">
            <button
              type="button"
              className="task-shortcut"
              title="Fecha de vencimiento"
              draggable={false}
              onClick={openDate}
            >
              <Calendar style={{ width: 15, height: 15 }} />
            </button>
            {openPicker === "date" && (
              <TaskDatePicker
                initialDate={task.due_date}
                onSelect={(d) => setDueDate(task, d)}
                onClose={() => setOpenPicker(null)}
              />
            )}
          </div>
          <div className="task-shortcut-wrap">
            <button
              type="button"
              className="task-shortcut"
              title="Prioridad"
              draggable={false}
              onClick={openPriority}
            >
              <Flag style={{ width: 15, height: 15 }} />
            </button>
            {openPicker === "priority" && (
              <TaskPriorityPicker
                initialPriority={task.priority ?? (task.high_priority ? "high" : null)}
                onSelect={(p) => setPriority(task, p)}
                onClose={() => setOpenPicker(null)}
              />
            )}
          </div>
        </div>

        {(duePill || prio) && (
          <div className="task-meta-pills">
            {duePill && (
              <button
                type="button"
                className={`task-pill task-pill-date t-pill ${duePillClass(task)}`}
                draggable={false}
                onClick={openDate}
              >
                {duePill}
              </button>
            )}
            {prio && (
              <button
                type="button"
                className={`task-pill task-pill-prior t-pill ${prio.className}`}
                draggable={false}
                onClick={openPriority}
              >
                <Flag style={{ width: 12, height: 12 }} /> {prio.label}
              </button>
            )}
          </div>
        )}

      {hasSubs && (
        <div
          className="task-progress"
          title={`${doneCount}/${subCount} subtareas completadas`}
        >
          <div className="task-progress-track">
            <div
              className={`task-progress-fill${progressPct === 100 ? " complete" : ""}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="task-progress-label">
            {doneCount}/{subCount}
          </span>
        </div>
      )}
    </>
  );

  if (variant === "kanban") {
    return (
      <div
        className={`kan-card${dragging ? " dragging" : ""}${task.done ? " done" : ""}${hasSubs ? " has-subs" : ""}`}
      >
        <div className="kan-card-body" onClick={onCardClick}>
          <div className="kan-card-head">
            {chevron}
            <TaskStatusControl task={task} round />
            {titleRow}
          </div>
          <div className="kan-card-meta">{metaContent}</div>
        </div>
        {hasVisibleSubs && !collapsed && (
          <div className="kan-subtasks">
            {subtasks.map((child) => (
              <TaskCard
                key={`${child.task.source_path}:${child.task.source_line}`}
                task={child.task}
                variant="kanban"
                subtasks={child.children}
                nodeIndex={nodeIndex}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <li className={`task ${task.done ? "done" : ""}${hasSubs ? " has-subs" : ""}`}>
      <div className="task-self" onClick={onCardClick}>
        {chevron}
        <TaskStatusControl task={task} />
        <div className="t-main">
          {titleRow}
          {metaContent}
        </div>
      </div>
      {hasVisibleSubs && !collapsed && (
        <ul className="task-sublist">
          {subtasks.map((child) => (
            <TaskCard
              key={`${child.task.source_path}:${child.task.source_line}`}
              task={child.task}
              variant="list"
              subtasks={child.children}
              nodeIndex={nodeIndex}
              searchQuery={searchQuery}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
