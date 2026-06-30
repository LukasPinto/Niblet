import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUiStore } from "../../stores/uiStore";
import { useNotesStore } from "../../stores/notesStore";

type MenuMode = "menu" | "note" | "folder" | "delete-confirm";

export default function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const newNote = useNotesStore((s) => s.newNote);
  const newFolder = useNotesStore((s) => s.newFolder);
  const removeNote = useNotesStore((s) => s.removeNote);
  const removeFolder = useNotesStore((s) => s.removeFolder);
  const removeImage = useNotesStore((s) => s.removeImage);

  const [mode, setMode] = useState<MenuMode>("menu");
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMode("menu");
    setName("");
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  useEffect(() => {
    if (mode !== "menu") setTimeout(() => inputRef.current?.focus(), 20);
  }, [mode]);

  if (!menu) return null;

  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - 160);
  const folderLabel = menu.folder || "(raíz)";

  const submit = async () => {
    const finalName = name.trim() || (mode === "folder" ? "Nueva carpeta" : "Sin título");
    if (mode === "note") await newNote(menu.folder, finalName);
    else if (mode === "folder") await newFolder(menu.folder, finalName);
    close();
  };

  const handleDelete = async () => {
    if (!menu.itemType || !menu.itemPath) return close();
    if (menu.itemType === "note") await removeNote(menu.itemPath);
    else if (menu.itemType === "image") await removeImage(menu.itemPath);
    else if (menu.itemType === "folder") await removeFolder(menu.itemPath);
    close();
  };

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-header">{folderLabel}</div>
      {mode === "note" ? (
        <div className="ctx-naming">
          <input
            ref={inputRef}
            className="ctx-input"
            placeholder="Nombre de la nota…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") close();
            }}
          />
          <button className="btn primary ctx-confirm" onClick={submit}>
            Crear
          </button>
        </div>
      ) : mode === "folder" ? (
        <div className="ctx-naming">
          <input
            ref={inputRef}
            className="ctx-input"
            placeholder="Nombre de la carpeta…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") close();
            }}
          />
          <button className="btn primary ctx-confirm" onClick={submit}>
            Crear
          </button>
        </div>
      ) : mode === "delete-confirm" ? (
        <div className="ctx-confirm-zone">
          <p>
            ¿Eliminar <strong>{menu.itemName}</strong>?
          </p>
          <p className="muted ctx-warn">
            {menu.itemType === "folder"
              ? "Se borrará la carpeta y todo su contenido. No se puede deshacer."
              : "Esta acción no se puede deshacer."}
          </p>
          <div className="ctx-confirm-btns">
            <button className="btn" onClick={close}>
              Cancelar
            </button>
            <button className="btn danger" onClick={handleDelete}>
              Eliminar
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="ctx-item" onClick={() => setMode("note")}>
            <span className="ctx-ico">📝</span> Nueva nota aquí
          </button>
          <button className="ctx-item" onClick={() => setMode("folder")}>
            <span className="ctx-ico">📁</span> Nueva carpeta
          </button>
          {menu.itemType && (
            <>
              <hr className="ctx-sep" />
              <button
                className="ctx-item ctx-danger"
                onClick={() => setMode("delete-confirm")}
              >
                <span className="ctx-ico">🗑️</span> Eliminar{" "}
                {menu.itemType === "folder"
                  ? "carpeta"
                  : menu.itemType === "image"
                    ? "imagen"
                    : "nota"}
              </button>
            </>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
