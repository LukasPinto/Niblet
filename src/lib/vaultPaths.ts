/** Carpeta oculta de metadatos del vault dentro de la bóveda del usuario. */
export const VAULT_META_DIR = ".niblet";

export const CONFIG_REL = `${VAULT_META_DIR}/config.json`;
export const DB_VIEWS_REL = `${VAULT_META_DIR}/database-views.json`;

export function isVaultMetaPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, "/");
  return norm === VAULT_META_DIR || norm.startsWith(`${VAULT_META_DIR}/`);
}
