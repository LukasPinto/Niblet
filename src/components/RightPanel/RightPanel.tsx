import { useUiStore } from "../../stores/uiStore";
import MiniCalendar from "./MiniCalendar";
import NoteTasksPanel from "./NoteTasksPanel";
import NoteBacklinksPanel from "./NoteBacklinksPanel";

function RightPanelBody() {
  return (
    <div className="right-panel-content">
      <div className="right-panel-block">
        <div className="right-panel-section-title">Calendario</div>
        <MiniCalendar />
      </div>
      <NoteTasksPanel />
      <NoteBacklinksPanel />
    </div>
  );
}

export default function RightPanel() {
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);

  if (!rightPanelOpen) return null;

  return (
    <aside className="right-panel-shell">
      <div className="right-panel">
        <RightPanelBody />
      </div>
    </aside>
  );
}
