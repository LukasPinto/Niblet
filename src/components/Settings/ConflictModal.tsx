import { useEffect, useState } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useVaultStore } from "../../stores/vaultStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useSyncStore } from "../../stores/syncStore";
import {
  readNote,
  writeNote,
  recordSave,
  readSnapshot,
} from "../../lib/tauri";
import { ownSide, theirSide, autoMerge, type DiffSegment } from "../../lib/conflictResolver";

function DiffPane({ title, segs, side }: { title: string; segs: DiffSegment[]; side: "mine" | "theirs" }) {
  return (
    <div className="diff-col">
      <div className="diff-head">{title}</div>
      <pre>
        {segs.map((s, i) => {
          const cls = side === "mine" && s.removed ? "rem" : side === "theirs" && s.added ? "add" : "";
          const text = s.value.replace(/\n$/, "");
          return cls ? (
            <span key={i} className={cls}>{text}</span>
          ) : (
            <span key={i}>{text + "\n"}</span>
          );
        })}
      </pre>
    </div>
  );
}

export default function ConflictModal() {
  const conflict = useUiStore((s) => s.conflict);
  const close = () => useUiStore.getState().openConflict(null);
  const vaultPath = useVaultStore((s) => s.vaultPath);

  const [mine, setMine] = useState("");
  const [theirs, setTheirs] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!conflict || !vaultPath) return;
    let alive = true;
    (async () => {
      const disk = await readNote(conflict.path).catch(() => "");
      let snap = await readSnapshot(vaultPath, conflict.rel_path).catch(() => "");
      if (!snap) snap = disk; // sin snapshot previo: no hay diferencia que mostrar
      if (alive) {
        setTheirs(disk);
        setMine(snap);
      }
    })();
    return () => {
      alive = false;
    };
  }, [conflict, vaultPath]);

  if (!conflict || !vaultPath) return null;

  const refreshAll = async () => {
    await useTasksStore.getState().refreshConflicts();
    await useTasksStore.getState().refreshTasks();
    await useNotesStore.getState().refreshNotes();
    if (useTabsStore.getState().getNoteTab(conflict.path)) {
      await useTabsStore.getState().reloadTabFromDisk(conflict.path);
    }
  };

  const resolve = async (content: string) => {
    setBusy(true);
    try {
      await writeNote(conflict.path, content);
      await recordSave(vaultPath, conflict.rel_path, content);
      await refreshAll();
      useSyncStore.getState().scheduleSyncOnSave();
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>⚠️ Conflicto de sincronización</h2>
        <p className="muted">
          <code>{conflict.rel_path}</code> cambió en OneDrive desde la última vez
          que Niblet lo guardó. Elige qué versión conservar.
        </p>

        <div className="diff">
          <DiffPane title="Este dispositivo (Niblet)" segs={ownSide(mine, theirs)} side="mine" />
          <DiffPane title="OneDrive (otro PC)" segs={theirSide(mine, theirs)} side="theirs" />
        </div>

        <div className="diff-actions">
          <button className="btn ghost" disabled={busy} onClick={() => resolve(mine)}>
            Quedarme con el mío
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => resolve(theirs)}>
            Usar el de OneDrive
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => resolve(autoMerge(mine, theirs))}
          >
            Fusionar ambos
          </button>
        </div>
      </div>
    </div>
  );
}
