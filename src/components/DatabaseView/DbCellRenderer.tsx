import type { FrontmatterValue } from "../../lib/markdown";
import { displayValue } from "../../lib/markdown";
import { parseMultiSelectValue } from "../../lib/database/fieldTypes";
import { tagColorClass } from "../../lib/database/tagColors";
import type { FieldType } from "../../lib/database/viewConfig";

interface Props {
  fieldType: FieldType;
  value: FrontmatterValue | undefined;
  tagColors?: Record<string, number>;
  onPillDoubleClick?: (tag: string, rect: DOMRect) => void;
  onPillColorClick?: (tag: string, rect: DOMRect) => void;
  onPillContextMenu?: (tag: string, rect: DOMRect, e: React.MouseEvent) => void;
}

function Pill({
  tag,
  tagColors,
  onPillDoubleClick,
  onPillColorClick,
  onPillContextMenu,
}: {
  tag: string;
  tagColors?: Record<string, number>;
  onPillDoubleClick?: (tag: string, rect: DOMRect) => void;
  onPillColorClick?: (tag: string, rect: DOMRect) => void;
  onPillContextMenu?: (tag: string, rect: DOMRect, e: React.MouseEvent) => void;
}) {
  const label = tag.replace(/^#/, "");
  return (
    <span className="db-pill-wrap">
      <span
        className={tagColorClass(tag, tagColors)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onPillDoubleClick?.(tag, e.currentTarget.getBoundingClientRect());
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPillContextMenu?.(tag, e.currentTarget.getBoundingClientRect(), e);
        }}
      >
        {label}
      </span>
      {onPillColorClick && (
        <button
          type="button"
          className="db-pill-color-btn"
          title="Elegir color"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onPillColorClick(tag, e.currentTarget.getBoundingClientRect());
          }}
        >
          ○
        </button>
      )}
    </span>
  );
}

export function DbCellRenderer({
  fieldType,
  value,
  tagColors,
  onPillDoubleClick,
  onPillColorClick,
  onPillContextMenu,
}: Props) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="muted">—</span>;
  }

  const pillCommon = {
    tagColors,
    onPillDoubleClick,
    onPillColorClick,
    onPillContextMenu,
  };

  if (fieldType === "multi_select") {
    const tags = parseMultiSelectValue(value);
    if (tags.length === 0) return <span className="muted">—</span>;
    return (
      <span className="db-cell-pills">
        {tags.map((t) => (
          <Pill key={t} tag={t} {...pillCommon} />
        ))}
      </span>
    );
  }

  if (fieldType === "select") {
    const text = displayValue(value);
    if (!text) return <span className="muted">—</span>;
    return <Pill tag={text} {...pillCommon} />;
  }

  if (fieldType === "date") {
    const text = displayValue(value);
    if (!text) return <span className="muted">—</span>;
    return <span className="db-cell-text db-cell-date">{text}</span>;
  }

  return <span className="db-cell-text">{displayValue(value)}</span>;
}
