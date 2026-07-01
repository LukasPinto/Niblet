/** Registro global para cerrar menús flotantes del editor de bloques entre sí. */

const langPickerClosers = new Map<string, () => void>();

export function registerCodeLangPicker(
  blockId: string,
  close: () => void,
): () => void {
  langPickerClosers.set(blockId, close);
  return () => {
    langPickerClosers.delete(blockId);
  };
}

export function closeAllCodeLangPickers(exceptBlockId?: string): void {
  for (const [id, close] of langPickerClosers) {
    if (id !== exceptBlockId) close();
  }
}
