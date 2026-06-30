import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNotesStore } from "../../stores/notesStore";

type CreateKind = "note" | "folder";

interface Props {
  kind: CreateKind;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
}

function folderLabel(path: string): string {
  return path || "Raíz del vault";
}

export default function CreateInVaultPopover({
  kind,
  anchorRef,
  open,
  onClose,
}: Props) {
  const folders = useNotesStore((s) => s.folders);
  const newNote = useNotesStore((s) => s.newNote);
  const newFolder = useNotesStore((s) => s.newFolder);

  const [targetFolder, setTargetFolder] = useState("");
  const [name, setName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTargetFolder("");
    setName("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !anchorRef.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 260);
  const top = rect.bottom + 6;

  const sortedFolders = [...folders].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const submit = async () => {
    const finalName =
      name.trim() || (kind === "folder" ? "Nueva carpeta" : "Sin título");
    if (kind === "note") await newNote(targetFolder, finalName);
    else await newFolder(targetFolder, finalName);
    onClose();
  };

  return createPortal(
    <div
      ref={panelRef}
      className="create-vault-popover"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="create-vault-popover-head">
        {kind === "note" ? "Nueva nota" : "Nueva carpeta"}
      </div>
      <label className="create-vault-field">
        <span className="create-vault-label">Ubicación</span>
        <select
          className="create-vault-select"
          value={targetFolder}
          onChange={(e) => setTargetFolder(e.target.value)}
        >
          <option value="">{folderLabel("")}</option>
          {sortedFolders.map((f) => (
            <option key={f} value={f}>
              {folderLabel(f)}
            </option>
          ))}
        </select>
      </label>
      <label className="create-vault-field">
        <span className="create-vault-label">Nombre</span>
        <input
          ref={inputRef}
          className="create-vault-input"
          placeholder={kind === "folder" ? "Nombre de la carpeta…" : "Nombre de la nota…"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </label>
      <div className="create-vault-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn primary" onClick={() => void submit()}>
          Crear
        </button>
      </div>
    </div>,
    document.body,
  );
}
