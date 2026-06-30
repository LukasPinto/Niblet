import { useEffect, useState } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore } from "../../stores/tabsStore";
import { readImageBase64 } from "../../lib/tauri";

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
}

function ImageViewer({ path }: { path: string }) {
  const entry = useNotesStore((s) => s.images.find((i) => i.path === path));
  const [src, setSrc] = useState<string>("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc("");
    setError(false);
    const ext = path.split(".").pop() ?? "png";
    readImageBase64(path)
      .then((b64) => {
        if (alive) setSrc(`data:${mimeForExt(ext)};base64,${b64}`);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <section className="view view-image">
      <div className="image-viewer">
        {error ? (
          <p className="muted">No se pudo cargar la imagen.</p>
        ) : src ? (
          <img className="image-viewer-img" src={src} alt={entry?.name ?? path} />
        ) : (
          <p className="muted">Cargando imagen…</p>
        )}
      </div>
      {entry && <div className="image-viewer-caption">{entry.rel_path}</div>}
    </section>
  );
}

export default function ImageTabPanels() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const imageTabs = tabs.filter((t) => t.kind === "image");

  if (imageTabs.length === 0) return null;

  return (
    <>
      {imageTabs.map((tab) => (
        <div
          key={tab.id}
          className="note-tab-panel"
          hidden={tab.id !== activeTabId}
        >
          {tab.path && <ImageViewer path={tab.path} />}
        </div>
      ))}
    </>
  );
}
