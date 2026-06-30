import type { ColumnMeta } from "../../lib/database/fieldTypes";
import { columnLabel } from "../../lib/database/types";
import type { FieldType, FilterGroup, SortState } from "../../lib/database/viewConfig";
import { FilterPanel } from "./FilterPanel";
import { PropertyVisibilityPanel } from "./PropertyVisibilityPanel";
import { TagColorsPanel } from "./TagColorsPanel";

interface Props {
  totalRows: number;
  visibleRows: number;
  columns: string[];
  columnMeta: Record<string, ColumnMeta>;
  columnOrder: string[];
  hiddenColumns: string[];
  fieldTypeOverrides: Record<string, FieldType>;
  filterRoot: FilterGroup;
  sort: SortState;
  quickSearch: string;
  onQuickSearchChange: (q: string) => void;
  onReorder: (order: string[]) => void;
  onToggleHidden: (key: string, hidden: boolean) => void;
  onTypeOverride: (key: string, type: FieldType | "auto") => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onFilterRootChange: (root: FilterGroup) => void;
  onClearSort: () => void;
  onExport: () => void;
  allTags: string[];
  tagColors: Record<string, number>;
  onTagColorChange: (tag: string, index: number | null) => void;
  activeView: "notes" | "images";
  onViewChange: (view: "notes" | "images") => void;
}

export function DatabaseToolbar({
  totalRows,
  visibleRows,
  columns,
  columnMeta,
  columnOrder,
  hiddenColumns,
  fieldTypeOverrides,
  filterRoot,
  sort,
  quickSearch,
  onQuickSearchChange,
  onReorder,
  onToggleHidden,
  onTypeOverride,
  onHideAll,
  onShowAll,
  onFilterRootChange,
  onClearSort,
  onExport,
  allTags,
  tagColors,
  onTagColorChange,
  activeView,
  onViewChange,
}: Props) {
  return (
    <div className="db-toolbar">
      <div className="db-view-tabs">
        <button
          type="button"
          className={activeView === "notes" ? "active" : ""}
          onClick={() => onViewChange("notes")}
        >
          Notas
        </button>
        <button
          type="button"
          className={activeView === "images" ? "active" : ""}
          onClick={() => onViewChange("images")}
        >
          Imágenes
        </button>
      </div>
      {activeView === "notes" && (
        <>
          <div className="db-toolbar-search">
            <input
              type="search"
              className="db-quick-search"
              placeholder="Buscar en tabla…"
              value={quickSearch}
              onChange={(e) => onQuickSearchChange(e.target.value)}
            />
            {quickSearch && (
              <button
                type="button"
                className="db-quick-search-clear"
                onClick={() => onQuickSearchChange("")}
                aria-label="Limpiar búsqueda"
              >
                ×
              </button>
            )}
          </div>
          <PropertyVisibilityPanel
            columns={columns}
            columnMeta={columnMeta}
            columnOrder={columnOrder}
            hiddenColumns={hiddenColumns}
            fieldTypeOverrides={fieldTypeOverrides}
            onReorder={onReorder}
            onToggleHidden={onToggleHidden}
            onTypeOverride={onTypeOverride}
            onHideAll={onHideAll}
            onShowAll={onShowAll}
          />
          <FilterPanel
            columns={columns}
            columnMeta={columnMeta}
            filterRoot={filterRoot}
            onChange={onFilterRootChange}
          />
          <TagColorsPanel
            tags={allTags}
            tagColors={tagColors}
            onChange={onTagColorChange}
          />
          <button type="button" className="db-toolbar-btn" onClick={onExport}>
            Exportar
          </button>
          {sort.key && sort.dir && (
            <button type="button" className="db-toolbar-btn db-sort-indicator" onClick={onClearSort}>
              {columnLabel(sort.key)} ({sort.dir === "asc" ? "↑" : "↓"})
            </button>
          )}
          <span className="db-toolbar-count muted">
            {visibleRows} / {totalRows} filas
          </span>
        </>
      )}
    </div>
  );
}
