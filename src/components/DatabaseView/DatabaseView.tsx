import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore, noteTabId } from "../../stores/tabsStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useSyncStore } from "../../stores/syncStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useDatabaseViewStore } from "../../stores/databaseViewStore";
import { parseFrontmatter, stringifyFrontmatter } from "../../lib/markdown";
import { readNote, writeNote, recordSave } from "../../lib/tauri";
import {
  applyBulkFieldUpdate,
  commitCellValue,
  draftFromCell,
  getFieldTypeForKey,
} from "../../lib/database/bulkEdit";
import {
  canHideColumn,
  canInsertLeft,
  canInsertRight,
  columnDefaultWidth,
  freezeLeftOffset,
  insertColumnInOrder,
  isColumnFrozen,
  previousFreezeColumn,
  sanitizePropertyName,
} from "../../lib/database/columns";
import { downloadCsv, exportRowsToCsv } from "../../lib/database/export";
import {
  applyFilters,
  applySort,
  filterGroupChipLabel,
  nextSortState,
} from "../../lib/database/filters";
import { inferAllColumnMeta, parseMultiSelectValue } from "../../lib/database/fieldTypes";
import { applyQuickSearch } from "../../lib/database/quickSearch";
import { applyRowOrder } from "../../lib/database/rowOrder";
import {
  CHECK_COLUMN,
  columnLabel,
  DEFAULT_COL_WIDTH,
  DRAG_COLUMN,
  KNOWN_ORDER,
  NOTE_COL_WIDTH,
  NOTE_COLUMN,
  TASKS_COL_WIDTH,
  TASKS_COLUMN,
  type DatabaseRow,
} from "../../lib/database/types";
import type { FieldType } from "../../lib/database/viewConfig";
import { collectAllTags } from "../../lib/database/tagColors";
import { BulkEditBar } from "./BulkEditBar";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { DatabaseToolbar } from "./DatabaseToolbar";
import { DbCellEditor } from "./DbCellEditor";
import { DbCellRenderer } from "./DbCellRenderer";
import { InlinePillEditor } from "./InlinePillEditor";
import { RowDragHandle } from "./RowDragHandle";
import { TagColorPicker } from "./TagColorPicker";

export function DatabaseViewPanel({ folder }: { folder: string | null }) {
  const notes = useNotesStore((s) => s.notes);
  const images = useNotesStore((s) => s.images);
  const tasks = useTasksStore((s) => s.tasks);
  const newNote = useNotesStore((s) => s.newNote);
  const removeNote = useNotesStore((s) => s.removeNote);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const openPreview = useTabsStore((s) => s.openPreview);
  const openPinned = useTabsStore((s) => s.openPinned);
  const openImageTab = useTabsStore((s) => s.openImageTab);
  const pinTab = useTabsStore((s) => s.pinTab);

  const viewConfig = useDatabaseViewStore((s) => s.getView(folder));
  const updateView = useDatabaseViewStore((s) => s.updateView);
  const loadViews = useDatabaseViewStore((s) => s.load);
  const viewsLoaded = useDatabaseViewStore((s) => s.loaded);

  const [activeView, setActiveView] = useState<"notes" | "images">("notes");
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [editing, setEditing] = useState<{ path: string; key: string } | null>(null);
  const [editAnchor, setEditAnchor] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkClear, setBulkClear] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const [newNoteName, setNewNoteName] = useState("");
  const [creatingNote, setCreatingNote] = useState(false);
  const commitRef = useRef<() => void>(() => {});
  const [widthDraft, setWidthDraft] = useState<Record<string, number>>({});
  const widthDraftRef = useRef<Record<string, number>>({});
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const dragRowPath = useRef<string | null>(null);
  const [dropRowPath, setDropRowPath] = useState<string | null>(null);
  const [inlinePill, setInlinePill] = useState<{
    path: string;
    key: string;
    tag: string;
    rect: DOMRect;
    fieldType: FieldType;
  } | null>(null);
  const [tagColorPick, setTagColorPick] = useState<{
    tag: string;
    rect: DOMRect;
  } | null>(null);
  const [colMenu, setColMenu] = useState<{ column: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (vaultPath && !viewsLoaded) void loadViews(vaultPath);
  }, [vaultPath, viewsLoaded, loadViews]);

  const filtered = useMemo(
    () =>
      folder
        ? notes.filter((n) => n.folder === folder || n.folder.startsWith(`${folder}/`))
        : notes,
    [notes, folder],
  );

  const filteredImages = useMemo(
    () =>
      folder
        ? images.filter(
            (img) => img.folder === folder || img.folder.startsWith(`${folder}/`),
          )
        : images,
    [images, folder],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded: DatabaseRow[] = [];
      for (const n of filtered) {
        try {
          const raw = await readNote(n.path);
          const { data } = parseFrontmatter(raw);
          loaded.push({
            path: n.path,
            rel_path: n.rel_path,
            name: n.name,
            folder: n.folder,
            raw,
            data,
          });
        } catch {
          /* ignorar notas ilegibles */
        }
      }
      if (alive) setRows(loaded);
    })();
    return () => {
      alive = false;
    };
  }, [filtered]);

  const allMetaKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.data)) keys.add(k);
    const known = KNOWN_ORDER.filter((k) => keys.has(k));
    const extra = [...keys].filter((k) => !KNOWN_ORDER.includes(k)).sort();
    return [...known, ...extra];
  }, [rows]);

  const columnMeta = useMemo(
    () => inferAllColumnMeta(allMetaKeys, rows, viewConfig.fieldTypeOverrides),
    [allMetaKeys, rows, viewConfig.fieldTypeOverrides],
  );

  const orderedColumns = useMemo(() => {
    const order = viewConfig.columnOrder.filter((c) => allMetaKeys.includes(c));
    const rest = allMetaKeys.filter((c) => !order.includes(c));
    return [...order, ...rest];
  }, [allMetaKeys, viewConfig.columnOrder]);

  const visibleColumns = useMemo(() => {
    const hidden = new Set(viewConfig.hiddenColumns);
    return orderedColumns.filter((c) => !hidden.has(c));
  }, [orderedColumns, viewConfig.hiddenColumns]);

  const filteredRows = useMemo(
    () => applyFilters(rows, viewConfig.filterRoot, columnMeta),
    [rows, viewConfig.filterRoot, columnMeta],
  );

  const searchedRows = useMemo(
    () => applyQuickSearch(filteredRows, quickSearch),
    [filteredRows, quickSearch],
  );

  const orderedRows = useMemo(
    () => applyRowOrder(searchedRows, viewConfig.rowOrder, viewConfig.sort),
    [searchedRows, viewConfig.rowOrder, viewConfig.sort],
  );

  const displayRows = useMemo(
    () => applySort(orderedRows, viewConfig.sort, columnMeta),
    [orderedRows, viewConfig.sort, columnMeta],
  );

  const allTags = useMemo(
    () => collectAllTags(rows, allMetaKeys, columnMeta),
    [rows, allMetaKeys, columnMeta],
  );

  useEffect(() => {
    if (visibleColumns.length > 0 && !bulkField) {
      setBulkField(visibleColumns[0]);
    }
  }, [visibleColumns, bulkField]);

  const patchView = useCallback(
    (patch: Parameters<typeof updateView>[2]) => {
      void updateView(vaultPath, folder, patch);
    },
    [updateView, vaultPath, folder],
  );

  const setTagColor = useCallback(
    (tag: string, index: number | null) => {
      const next = { ...viewConfig.tagColors };
      if (index === null) delete next[tag];
      else next[tag] = index;
      patchView({ tagColors: next });
    },
    [viewConfig.tagColors, patchView],
  );

  const openTagColorPicker = useCallback((tag: string, rect: DOMRect) => {
    setTagColorPick({ tag, rect });
  }, []);

  const colWidth = (key: string, fallback: number) =>
    widthDraftRef.current[key] ??
    widthDraft[key] ??
    viewConfig.columnWidths[key] ??
    fallback;

  const resizeColumn = (key: string, dx: number, min: number, fallback: number) => {
    const cur = colWidth(key, fallback);
    const next = { ...widthDraftRef.current, [key]: Math.max(min, cur + dx) };
    widthDraftRef.current = next;
    setWidthDraft(next);
  };

  const commitColumnWidths = () => {
    const merged = { ...viewConfig.columnWidths, ...widthDraftRef.current };
    patchView({ columnWidths: merged });
    widthDraftRef.current = {};
    setWidthDraft({});
  };

  const colStyle = (key: string, fallback: number) => {
    const w = colWidth(key, fallback);
    return { width: w, minWidth: w, maxWidth: w };
  };

  const frozenCellStyle = (key: string, fallback: number, header = false) => {
    const base = colStyle(key, fallback);
    if (!isColumnFrozen(key, viewConfig.freezeUntil, visibleColumns)) return base;
    const left = freezeLeftOffset(
      key,
      viewConfig.freezeUntil,
      visibleColumns,
      (k) => colWidth(k, columnDefaultWidth(k)),
    );
    const colIdx = [
      DRAG_COLUMN,
      CHECK_COLUMN,
      NOTE_COLUMN,
      ...visibleColumns,
      TASKS_COLUMN,
    ].indexOf(key);
    const zIndex = (header ? 20 : 4) + colIdx;
    return { ...base, left, position: "sticky" as const, zIndex };
  };

  const frozenClass = (key: string) =>
    isColumnFrozen(key, viewConfig.freezeUntil, visibleColumns) ? " db-col-frozen" : "";

  const tasksFor = (relPath: string) => tasks.filter((t) => t.rel_path === relPath);

  const persistRow = async (row: DatabaseRow, newData: DatabaseRow["data"]) => {
    const { content } = parseFrontmatter(row.raw);
    const updated = stringifyFrontmatter(newData, content);
    await writeNote(row.path, updated);
    if (vaultPath) await recordSave(vaultPath, row.rel_path, updated).catch(() => {});
    setRows((rs) =>
      rs.map((r) => (r.path === row.path ? { ...r, raw: updated, data: newData } : r)),
    );
    useSyncStore.getState().scheduleSyncOnSave();
    return updated;
  };

  const startEdit = (row: DatabaseRow, key: string, td: HTMLTableCellElement) => {
    const rect = td.getBoundingClientRect();
    setEditAnchor({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
    setEditing({ path: row.path, key });
    const ft = getFieldTypeForKey(key, columnMeta);
    setDraft(draftFromCell(key, row.data, ft));
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditAnchor(null);
  };

  const commitEdit = async () => {
    if (!editing) return;
    const row = rows.find((r) => r.path === editing.path);
    if (!row) {
      cancelEdit();
      return;
    }

    const ft = getFieldTypeForKey(editing.key, columnMeta);
    const original = draftFromCell(editing.key, row.data, ft);
    const normalizedDraft = draft.replace(/^\s+|\s+$/g, "");
    if (normalizedDraft === original.replace(/^\s+|\s+$/g, "")) {
      cancelEdit();
      return;
    }

    const newData = commitCellValue(editing.key, draft, ft, row.data);
    await persistRow(row, newData);
    cancelEdit();
  };

  commitRef.current = () => {
    void commitEdit();
  };

  const commitPillValue = async (
    path: string,
    key: string,
    value: string,
    fieldType: FieldType,
  ) => {
    const row = rows.find((r) => r.path === path);
    if (!row) return;
    const newData = commitCellValue(key, value, fieldType, row.data);
    await persistRow(row, newData);
  };

  const toggleRow = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const paths = displayRows.map((r) => r.path);
    const allSelected = paths.every((p) => selected.has(p));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) paths.forEach((p) => next.delete(p));
      else paths.forEach((p) => next.add(p));
      return next;
    });
  };

  const applyBulk = async () => {
    if (!bulkField || selected.size === 0) return;
    setBulkBusy(true);
    try {
      const ft = getFieldTypeForKey(bulkField, columnMeta);
      const next = await applyBulkFieldUpdate(
        rows,
        selected,
        bulkField,
        bulkValue,
        ft,
        bulkClear,
        async (path, content) => {
          await writeNote(path, content);
          const row = rows.find((r) => r.path === path);
          if (vaultPath && row) {
            await recordSave(vaultPath, row.rel_path, content).catch(() => {});
          }
        },
      );
      setRows(next);
      setSelected(new Set());
      setBulkValue("");
      setBulkClear(false);
      useSyncStore.getState().scheduleSyncOnSave();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const n = selected.size;
    if (!confirm(`¿Eliminar ${n} nota${n !== 1 ? "s" : ""}? Esta acción no se puede deshacer.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      for (const path of [...selected]) {
        await removeNote(path);
      }
      const remainingOrder = viewConfig.rowOrder.filter((p) => !selected.has(p));
      patchView({ rowOrder: remainingOrder });
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const createNoteFromRow = async () => {
    const name = newNoteName.trim();
    if (!name || creatingNote) return;
    setCreatingNote(true);
    try {
      await newNote(folder ?? "", name);
      setNewNoteName("");
    } finally {
      setCreatingNote(false);
    }
  };

  const rowIndexFromPointer = (clientY: number): string | null => {
    const tbody = tbodyRef.current;
    if (!tbody) return null;
    const trs = tbody.querySelectorAll<HTMLTableRowElement>("tr.db-data-row");
    for (const tr of trs) {
      const rect = tr.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) return tr.dataset.path ?? null;
    }
    const last = trs[trs.length - 1];
    return last?.dataset.path ?? null;
  };

  const finishRowDrag = () => {
    const from = dragRowPath.current;
    const to = dropRowPath;
    dragRowPath.current = null;
    setDropRowPath(null);
    if (!from || !to || from === to) return;

    const paths = displayRows.map((r) => r.path);
    const fromIdx = paths.indexOf(from);
    const toIdx = paths.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;

    const next = [...paths];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    patchView({ rowOrder: next, sort: { key: null, dir: null } });
  };

  const onHeaderSort = (key: string) => {
    patchView({ sort: nextSortState(viewConfig.sort, key) });
  };

  const sortIndicator = (key: string) => {
    if (viewConfig.sort.key !== key || !viewConfig.sort.dir) return null;
    return viewConfig.sort.dir === "asc" ? " ↑" : " ↓";
  };

  const setSortForColumn = (column: string, dir: "asc" | "desc" | null) => {
    patchView({ sort: dir ? { key: column, dir } : { key: null, dir: null } });
  };

  const openColMenu = (column: string, el: HTMLElement) => {
    setColMenu({ column, rect: el.getBoundingClientRect() });
  };

  const hideColumn = (key: string) => {
    const hidden = new Set(viewConfig.hiddenColumns);
    hidden.add(key);
    const patch: Parameters<typeof patchView>[0] = { hiddenColumns: [...hidden] };
    if (viewConfig.sort.key === key) {
      patch.sort = { key: null, dir: null };
    }
    if (viewConfig.freezeUntil === key) {
      patch.freezeUntil = previousFreezeColumn(key, visibleColumns);
    }
    patchView(patch);
  };

  const insertColumn = async (
    refColumn: string,
    side: "left" | "right",
    rawName: string,
  ) => {
    const newKey = sanitizePropertyName(rawName);
    if (!newKey) return;
    if (allMetaKeys.includes(newKey)) {
      window.alert("Ya existe una propiedad con ese nombre.");
      return;
    }
    const nextOrder = insertColumnInOrder(
      viewConfig.columnOrder,
      allMetaKeys,
      refColumn,
      side,
      newKey,
    );
    const hidden = viewConfig.hiddenColumns.filter((k) => k !== newKey);
    patchView({ columnOrder: nextOrder, hiddenColumns: hidden });
    for (const row of rows) {
      if (newKey in row.data) continue;
      await persistRow(row, { ...row.data, [newKey]: "" });
    }
  };

  const renderColMenuBtn = (column: string) => (
    <button
      type="button"
      className="db-col-menu-trigger"
      aria-label={`Menú de columna ${columnLabel(column)}`}
      onClick={(e) => {
        e.stopPropagation();
        openColMenu(column, e.currentTarget);
      }}
    >
      ▾
    </button>
  );

  const handleExport = () => {
    const csv = exportRowsToCsv(displayRows, visibleColumns, columnMeta);
    const slug = (folder ?? "vault").replace(/[\\/]/g, "-");
    downloadCsv(`${slug}-export.csv`, csv);
  };

  const filterChips = filterGroupChipLabel(viewConfig.filterRoot);

  const title = folder ?? "Base de datos";
  const displayTitle = folder?.includes("/") ? folder.split("/").pop()! : title;
  const editingMeta = editing ? columnMeta[editing.key] : undefined;

  return (
    <section className="view view-base">
      <div className="tasks-head">
        <div>
          <h1>{displayTitle}</h1>
          <DatabaseToolbar
            totalRows={rows.length}
            visibleRows={displayRows.length}
            columns={allMetaKeys}
            columnMeta={columnMeta}
            columnOrder={viewConfig.columnOrder}
            hiddenColumns={viewConfig.hiddenColumns}
            fieldTypeOverrides={viewConfig.fieldTypeOverrides}
            filterRoot={viewConfig.filterRoot}
            sort={viewConfig.sort}
            quickSearch={quickSearch}
            onQuickSearchChange={setQuickSearch}
            onReorder={(order) => patchView({ columnOrder: order })}
            onToggleHidden={(key, hidden) => {
              const set = new Set(viewConfig.hiddenColumns);
              if (hidden) set.add(key);
              else set.delete(key);
              patchView({ hiddenColumns: [...set] });
            }}
            onTypeOverride={(key, type) => {
              const next = { ...viewConfig.fieldTypeOverrides };
              if (type === "auto") delete next[key];
              else next[key] = type;
              patchView({ fieldTypeOverrides: next });
            }}
            onHideAll={() => patchView({ hiddenColumns: [...allMetaKeys] })}
            onShowAll={() => patchView({ hiddenColumns: [] })}
            onFilterRootChange={(filterRoot) => patchView({ filterRoot })}
            onClearSort={() => patchView({ sort: { key: null, dir: null } })}
            onExport={handleExport}
            allTags={allTags}
            tagColors={viewConfig.tagColors}
            onTagColorChange={setTagColor}
            activeView={activeView}
            onViewChange={setActiveView}
          />
        </div>
      </div>

      {activeView === "images" ? (
        filteredImages.length === 0 ? (
          <p className="empty-hint">No hay imágenes en esta carpeta.</p>
        ) : (
          <div className="db-images-list">
            {filteredImages.map((img) => {
              const ext = img.rel_path.split(".").pop() ?? "";
              const label = ext ? `${img.name}.${ext}` : img.name;
              return (
                <div
                  key={img.path}
                  className="db-image-row"
                  onClick={() => openImageTab(img.path)}
                >
                  <span className="row-ico"><ImageIcon style={{ width: 15, height: 15 }} /></span>
                  <span className="row-link">{label}</span>
                  <span className="muted db-img-folder">{img.folder || "raíz"}</span>
                </div>
              );
            })}
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="empty-hint">No hay notas en esta vista.</p>
      ) : (
        <>
          {filterChips.length > 0 && (
            <div className="db-filter-chips">
              {filterChips.map((label, i) => (
                <span key={i} className="db-filter-chip">
                  {label}
                </span>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table className="db">
              <thead>
                <tr>
                  <th
                    className={`db-col-drag${frozenClass(DRAG_COLUMN)}`}
                    style={frozenCellStyle(DRAG_COLUMN, columnDefaultWidth(DRAG_COLUMN), true)}
                  />
                  <th
                    className={`db-col-check${frozenClass(CHECK_COLUMN)}`}
                    style={frozenCellStyle(CHECK_COLUMN, columnDefaultWidth(CHECK_COLUMN), true)}
                  >
                    <input
                      type="checkbox"
                      checked={
                        displayRows.length > 0 &&
                        displayRows.every((r) => selected.has(r.path))
                      }
                      onChange={toggleAllVisible}
                      aria-label="Seleccionar todas"
                    />
                  </th>
                  <th
                    className={`db-col-note db-col-sortable${frozenClass(NOTE_COLUMN)}`}
                    style={frozenCellStyle(NOTE_COLUMN, NOTE_COL_WIDTH, true)}
                    onClick={() => onHeaderSort(NOTE_COLUMN)}
                  >
                    <span className="db-col-label">
                      {columnLabel(NOTE_COLUMN)}
                      {sortIndicator(NOTE_COLUMN)}
                    </span>
                    {renderColMenuBtn(NOTE_COLUMN)}
                    <ColumnResizeHandle
                      onResize={(dx) => resizeColumn(NOTE_COLUMN, dx, 120, NOTE_COL_WIDTH)}
                      onResizeEnd={commitColumnWidths}
                    />
                  </th>
                  {visibleColumns.map((c) => (
                    <th
                      key={c}
                      className={`db-col-meta db-col-sortable${frozenClass(c)}`}
                      style={frozenCellStyle(c, DEFAULT_COL_WIDTH, true)}
                      onClick={() => onHeaderSort(c)}
                    >
                      <span className="db-col-label">
                        {columnLabel(c)}
                        {sortIndicator(c)}
                      </span>
                      {renderColMenuBtn(c)}
                      <ColumnResizeHandle
                        onResize={(dx) => resizeColumn(c, dx, 100, DEFAULT_COL_WIDTH)}
                        onResizeEnd={commitColumnWidths}
                      />
                    </th>
                  ))}
                  <th
                    className={`db-col-tasks${frozenClass(TASKS_COLUMN)}`}
                    style={frozenCellStyle(TASKS_COLUMN, TASKS_COL_WIDTH, true)}
                  >
                    <span className="db-col-label">{columnLabel(TASKS_COLUMN)}</span>
                    {renderColMenuBtn(TASKS_COLUMN)}
                  </th>
                </tr>
              </thead>
              <tbody ref={tbodyRef}>
                {displayRows.map((row) => {
                  const nt = tasksFor(row.rel_path);
                  const done = nt.filter((t) => t.done).length;
                  const pct = nt.length ? Math.round((done / nt.length) * 100) : 0;
                  const isSelected = selected.has(row.path);
                  const isDropTarget = dropRowPath === row.path;
                  return (
                    <tr
                      key={row.path}
                      data-path={row.path}
                      className={`db-data-row${isSelected ? " selected" : ""}${isDropTarget ? " drop-target" : ""}`}
                    >
                      <td
                        className={`db-col-drag${frozenClass(DRAG_COLUMN)}`}
                        style={frozenCellStyle(DRAG_COLUMN, columnDefaultWidth(DRAG_COLUMN))}
                      >
                        <RowDragHandle
                          onDragStart={() => {
                            dragRowPath.current = row.path;
                          }}
                          onDragMove={(y) => {
                            setDropRowPath(rowIndexFromPointer(y));
                          }}
                          onDragEnd={finishRowDrag}
                        />
                      </td>
                      <td
                        className={`db-col-check${frozenClass(CHECK_COLUMN)}`}
                        style={frozenCellStyle(CHECK_COLUMN, columnDefaultWidth(CHECK_COLUMN))}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.path)}
                          aria-label={`Seleccionar ${row.name}`}
                        />
                      </td>
                      <td
                        className={`db-col-note${frozenClass(NOTE_COLUMN)}`}
                        style={frozenCellStyle(NOTE_COLUMN, NOTE_COL_WIDTH)}
                      >
                        <span className="row-ico"><FileText style={{ width: 15, height: 15 }} /></span>
                        <span
                          className="row-link"
                          onClick={(e) => {
                            if (e.detail > 1) return;
                            void openPreview(row.path);
                          }}
                          onDoubleClick={async () => {
                            const id = noteTabId(row.path);
                            const existing = useTabsStore.getState().getTab(id);
                            if (existing) await pinTab(id);
                            else await openPinned(row.path);
                          }}
                        >
                          {row.name}
                        </span>
                      </td>
                      {visibleColumns.map((c) => {
                        const isEditing =
                          editing?.path === row.path && editing.key === c;
                        const ft = columnMeta[c]?.type ?? "text";
                        return (
                          <td
                            key={c}
                            className={`editable db-col-meta${isEditing ? " editing" : ""}${frozenClass(c)}`}
                            style={frozenCellStyle(c, DEFAULT_COL_WIDTH)}
                            onClick={(e) => {
                              if (isEditing) return;
                              startEdit(row, c, e.currentTarget);
                            }}
                          >
                            {isEditing ? (
                              <span className="db-cell-edit-placeholder" aria-hidden />
                            ) : (
                              <DbCellRenderer
                                fieldType={ft}
                                value={row.data[c]}
                                tagColors={viewConfig.tagColors}
                                onPillDoubleClick={(tag, rect) => {
                                  if (ft === "select") {
                                    setInlinePill({
                                      path: row.path,
                                      key: c,
                                      tag,
                                      rect,
                                      fieldType: ft,
                                    });
                                  } else if (ft === "multi_select") {
                                    const tags = parseMultiSelectValue(row.data[c]);
                                    const next = tags.filter((t) => t !== tag);
                                    void commitPillValue(
                                      row.path,
                                      c,
                                      next.join(", "),
                                      ft,
                                    );
                                  }
                                }}
                                onPillColorClick={openTagColorPicker}
                                onPillContextMenu={(tag, rect) => {
                                  openTagColorPicker(tag, rect);
                                }}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td
                        className={`db-col-tasks${frozenClass(TASKS_COLUMN)}`}
                        style={frozenCellStyle(TASKS_COLUMN, TASKS_COL_WIDTH)}
                      >
                        {nt.length > 0 ? (
                          <>
                            <span className="prog-mini">
                              <i style={{ ["--p" as string]: `${pct}%` }} />
                            </span>
                            {done}/{nt.length}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="db-new-row">
                  <td className="db-col-drag" />
                  <td className="db-col-check" />
                  <td colSpan={visibleColumns.length + 2} className="db-new-cell">
                    <input
                      type="text"
                      className="db-new-input"
                      placeholder="+ Nueva nota…"
                      value={newNoteName}
                      disabled={creatingNote}
                      onChange={(e) => setNewNoteName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void createNoteFromRow();
                      }}
                      onBlur={() => {
                        if (newNoteName.trim()) void createNoteFromRow();
                      }}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected.size > 0 && activeView === "notes" && (
        <BulkEditBar
          count={selected.size}
          columns={visibleColumns}
          columnMeta={columnMeta}
          fieldKey={bulkField}
          value={bulkValue}
          clear={bulkClear}
          busy={bulkBusy}
          onFieldChange={setBulkField}
          onValueChange={setBulkValue}
          onClearChange={setBulkClear}
          onApply={() => void applyBulk()}
          onDelete={() => void bulkDelete()}
          onClearSelection={() => setSelected(new Set())}
        />
      )}

      {editing && editAnchor && (
        <DbCellEditor
          anchor={editAnchor}
          fieldType={editingMeta?.type ?? "text"}
          value={draft}
          options={editingMeta?.options ?? []}
          onChange={setDraft}
          onCommit={() => commitRef.current()}
          onCancel={cancelEdit}
        />
      )}

      {inlinePill && (
        <InlinePillEditor
          anchor={inlinePill.rect}
          options={columnMeta[inlinePill.key]?.options ?? []}
          value={inlinePill.tag}
          onSelect={(v) => {
            void commitPillValue(inlinePill.path, inlinePill.key, v, inlinePill.fieldType);
          }}
          onClose={() => setInlinePill(null)}
        />
      )}

      {tagColorPick && (
        <TagColorPicker
          anchor={tagColorPick.rect}
          tag={tagColorPick.tag}
          currentIndex={viewConfig.tagColors[tagColorPick.tag]}
          onPick={(index) => setTagColor(tagColorPick.tag, index)}
          onClose={() => setTagColorPick(null)}
        />
      )}

      {colMenu && (
        <ColumnHeaderMenu
          column={colMenu.column}
          anchorRect={colMenu.rect}
          sort={viewConfig.sort}
          isFrozen={isColumnFrozen(
            colMenu.column,
            viewConfig.freezeUntil,
            visibleColumns,
          )}
          canInsertLeft={canInsertLeft(colMenu.column)}
          canInsertRight={canInsertRight(colMenu.column)}
          canHide={canHideColumn(colMenu.column)}
          onClose={() => setColMenu(null)}
          onSort={(dir) => setSortForColumn(colMenu.column, dir)}
          onFreeze={() => patchView({ freezeUntil: colMenu.column })}
          onUnfreeze={() =>
            patchView({
              freezeUntil: previousFreezeColumn(colMenu.column, visibleColumns),
            })
          }
          onHide={() => hideColumn(colMenu.column)}
          onInsert={(side, name) => void insertColumn(colMenu.column, side, name)}
        />
      )}
    </section>
  );
}

export default function DatabaseTabPanels() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const dbTabs = tabs.filter((t) => t.kind === "database");

  if (dbTabs.length === 0) return null;

  return (
    <>
      {dbTabs.map((tab) => (
        <div
          key={tab.id}
          className="note-tab-panel"
          hidden={tab.id !== activeTabId}
        >
          <DatabaseViewPanel folder={tab.folder ?? null} />
        </div>
      ))}
    </>
  );
}
