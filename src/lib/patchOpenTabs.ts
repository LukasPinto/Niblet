import { useNotesStore } from "../stores/notesStore";
import { useTabsStore } from "../stores/tabsStore";

function replaceAllLiteral(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

/** Misma lógica que `update_image_links` en Rust. */
export function replaceImageLinkRefs(
  content: string,
  oldRel: string,
  newRel: string,
): string {
  const oldName = oldRel.split("/").pop() ?? oldRel;
  const newName = newRel.split("/").pop() ?? newRel;
  return replaceAllLiteral(
    replaceAllLiteral(content, `](${oldRel})`, `](${newRel})`),
    `](${oldName})`,
    `](${newName})`,
  );
}

/** Misma lógica que `move_folder` en Rust para prefijos de imagen. */
export function replaceFolderImagePrefix(
  content: string,
  oldRel: string,
  newRel: string,
): string {
  return replaceAllLiteral(content, `](${oldRel}/`, `](${newRel}/`);
}

function syncNotesStoreActiveContent() {
  const activePath = useTabsStore.getState().activePath();
  if (!activePath) return;
  const tab = useTabsStore.getState().getNoteTab(activePath);
  if (!tab) return;
  useNotesStore.setState({
    activeContent: tab.content ?? "",
    dirty: tab.dirty ?? false,
  });
}

/**
 * Tras mover una imagen, el backend reescribe las notas en disco pero las
 * pestañas abiertas siguen con el markdown en memoria. Actualiza el editor
 * al instante para que no haya que cerrar/reabrir la nota.
 */
export async function syncOpenTabsAfterImageMove(
  oldRel: string,
  newRel: string,
): Promise<void> {
  const store = useTabsStore.getState();
  for (const tab of store.tabs) {
    if (tab.kind !== "note" || !tab.path || !tab.content) continue;
    const updated = replaceImageLinkRefs(tab.content, oldRel, newRel);
    if (updated === tab.content) continue;
    if (tab.dirty) {
      store.applyExternalTabContent(tab.path, updated, { keepDirty: true });
    } else {
      await store.reloadTabFromDisk(tab.path);
    }
  }
  syncNotesStoreActiveContent();
}

export async function syncOpenTabsAfterFolderMove(
  oldRel: string,
  newRel: string,
): Promise<void> {
  const store = useTabsStore.getState();
  for (const tab of store.tabs) {
    if (tab.kind !== "note" || !tab.path || !tab.content) continue;
    const updated = replaceFolderImagePrefix(tab.content, oldRel, newRel);
    if (updated === tab.content) continue;
    if (tab.dirty) {
      store.applyExternalTabContent(tab.path, updated, { keepDirty: true });
    } else {
      await store.reloadTabFromDisk(tab.path);
    }
  }
  syncNotesStoreActiveContent();
}
