import type { EditorTab, TabKind } from "./tabsStore";

export type NoteTabFields = {
  content: string;
  dirty: boolean;
  contentEpoch: number;
};

export type ActiveNoteTabSlice = {
  path: string;
  content: string;
};

export type ActiveTabHighlight = {
  kind: TabKind;
  path: string | null;
  folder: string | null | undefined;
};

export function selectNoteTabByPath(
  tabs: EditorTab[],
  path: string,
): NoteTabFields | undefined {
  const tab = tabs.find((t) => t.kind === "note" && t.path === path);
  if (!tab) return undefined;
  return {
    content: tab.content ?? "",
    dirty: !!tab.dirty,
    contentEpoch: tab.contentEpoch ?? 0,
  };
}

export function selectActiveNoteTab(
  tabs: EditorTab[],
  activeTabId: string | null,
): ActiveNoteTabSlice | null {
  if (!activeTabId) return null;
  const tab = tabs.find((t) => t.id === activeTabId);
  if (tab?.kind !== "note" || !tab.path) return null;
  return { path: tab.path, content: tab.content ?? "" };
}

export function selectActiveTabHighlight(
  tabs: EditorTab[],
  activeTabId: string | null,
): ActiveTabHighlight | null {
  if (!activeTabId) return null;
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;
  return {
    kind: tab.kind,
    path: tab.path ?? null,
    folder: tab.folder,
  };
}

export function noteTabFieldsEqual(
  a: NoteTabFields | undefined,
  b: NoteTabFields | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.content === b.content &&
    a.dirty === b.dirty &&
    a.contentEpoch === b.contentEpoch
  );
}

export function activeNoteTabEqual(
  a: ActiveNoteTabSlice | null,
  b: ActiveNoteTabSlice | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return a.path === b.path && a.content === b.content;
}

export function activeTabHighlightEqual(
  a: ActiveTabHighlight | null,
  b: ActiveTabHighlight | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.path === b.path && a.folder === b.folder;
}
