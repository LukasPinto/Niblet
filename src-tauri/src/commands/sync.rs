use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::commands::vault::{is_markdown, modified_secs};

/// Una nota cuyo hash en disco no coincide con el último guardado por la app.
#[derive(Serialize, Deserialize, Clone)]
pub struct ConflictEntry {
    pub rel_path: String,
    pub path: String,
    pub saved_hash: String,
    pub disk_hash: String,
    pub disk_modified: u64,
}

use crate::commands::vault::VAULT_META_DIR;

fn hashes_file(vault: &Path) -> PathBuf {
    vault.join(VAULT_META_DIR).join("hashes.json")
}

/// Ruta del snapshot (última versión escrita por la app) de una nota.
/// Sirve como lado "mío" del diff cuando OneDrive trae cambios externos.
fn snapshot_file(vault: &Path, rel_path: &str) -> PathBuf {
    let encoded = rel_path.replace(['/', '\\'], "__");
    vault.join(VAULT_META_DIR).join("snapshots").join(encoded)
}

fn load_hashes(vault: &Path) -> HashMap<String, String> {
    match fs::read_to_string(hashes_file(vault)) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_hashes_map(vault: &Path, map: &HashMap<String, String>) -> Result<(), String> {
    let dir = vault.join(VAULT_META_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(hashes_file(vault), json).map_err(|e| e.to_string())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

#[tauri::command]
pub fn hash_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(hash_bytes(&bytes))
}

/// Registra el hash de una nota recién guardada por la app, para no
/// confundir nuestra propia escritura con un conflicto de OneDrive.
#[tauri::command]
pub fn record_save(vault_path: String, rel_path: String, content: String) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let mut map = load_hashes(&vault);
    map.insert(rel_path.clone(), hash_bytes(content.as_bytes()));
    save_hashes_map(&vault, &map)?;

    // Guardar snapshot de la versión que la app conoce.
    let snap = snapshot_file(&vault, &rel_path);
    if let Some(dir) = snap.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(snap, content).map_err(|e| e.to_string())
}

/// Registra el hash de un archivo binario recién escrito (p. ej. imagen descargada de OneDrive).
#[tauri::command]
pub fn record_file_save(vault_path: String, rel_path: String) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let path = vault.join(&rel_path);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mut map = load_hashes(&vault);
    map.insert(rel_path.clone(), hash_bytes(&bytes));
    save_hashes_map(&vault, &map)?;

    let snap = snapshot_file(&vault, &rel_path);
    if let Some(dir) = snap.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(snap, bytes).map_err(|e| e.to_string())
}

/// Devuelve el snapshot (versión de la app) de una nota, si existe.
#[tauri::command]
pub fn read_snapshot(vault_path: String, rel_path: String) -> Result<String, String> {
    let vault = PathBuf::from(&vault_path);
    fs::read_to_string(snapshot_file(&vault, &rel_path)).map_err(|e| e.to_string())
}

/// Actualiza el hash y el snapshot de notas YA rastreadas cuyo contenido cambió
/// por una reescritura interna (p.ej. mover una imagen reescribe sus enlaces).
/// Las notas no rastreadas se ignoran: así no se generan conflictos falsos.
pub fn refresh_snapshots(vault: &Path, updates: &[(String, String)]) -> Result<(), String> {
    if updates.is_empty() {
        return Ok(());
    }
    let mut map = load_hashes(vault);
    let mut changed = false;
    for (rel, content) in updates {
        if !map.contains_key(rel) {
            continue;
        }
        map.insert(rel.clone(), hash_bytes(content.as_bytes()));
        let snap = snapshot_file(vault, rel);
        if let Some(dir) = snap.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(&snap, content).map_err(|e| e.to_string())?;
        changed = true;
    }
    if changed {
        save_hashes_map(vault, &map)?;
    }
    Ok(())
}

/// Migra la entrada de hash y el archivo de snapshot de `old_rel` a `new_rel`
/// cuando una nota se mueve, para no perder el seguimiento ni marcar conflictos.
pub fn rename_snapshot(vault: &Path, old_rel: &str, new_rel: &str) -> Result<(), String> {
    if old_rel == new_rel {
        return Ok(());
    }
    let mut map = load_hashes(vault);
    if let Some(hash) = map.remove(old_rel) {
        map.insert(new_rel.to_string(), hash);
        save_hashes_map(vault, &map)?;
    }
    let old_snap = snapshot_file(vault, old_rel);
    if old_snap.exists() {
        let new_snap = snapshot_file(vault, new_rel);
        if let Some(dir) = new_snap.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let _ = fs::rename(&old_snap, &new_snap);
    }
    Ok(())
}

/// Migra el snapshot de una nota movida (envoltorio de comando para el front).
#[tauri::command]
pub fn record_moved_note(
    vault_path: String,
    old_rel: String,
    new_rel: String,
) -> Result<(), String> {
    rename_snapshot(&PathBuf::from(&vault_path), &old_rel, &new_rel)
}

// Recorre y lee+hashea todos los `.md` rastreados; en OneDrive eso fuerza la
// descarga de archivos bajo demanda. Async + spawn_blocking para no congelar
// la UI durante el primer escaneo.
#[tauri::command]
pub async fn detect_conflicts(vault_path: String) -> Result<Vec<ConflictEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = PathBuf::from(&vault_path);
        if !vault.is_dir() {
            return Err("El vault no existe".into());
        }
        let saved = load_hashes(&vault);
        let mut conflicts = Vec::new();

        for entry in WalkDir::new(&vault).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if !is_markdown(p) {
                continue;
            }
            let rel = p
                .strip_prefix(&vault)
                .unwrap_or(p)
                .to_string_lossy()
                .replace('\\', "/");

            let Some(saved_hash) = saved.get(&rel) else {
                continue;
            };
            let bytes = match fs::read(p) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let disk_hash = hash_bytes(&bytes);
            if &disk_hash != saved_hash {
                conflicts.push(ConflictEntry {
                    rel_path: rel,
                    path: p.to_string_lossy().to_string(),
                    saved_hash: saved_hash.clone(),
                    disk_hash,
                    disk_modified: modified_secs(&entry),
                });
            }
        }
        Ok(conflicts)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Arranca un watcher recursivo del vault que emite el evento `vault-changed`
/// cuando cambia algún `.md` (por ejemplo, OneDrive sincronizando desde otro PC).
#[tauri::command]
pub fn watch_vault(app: AppHandle, vault_path: String) -> Result<(), String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err("El vault no existe".into());
    }

    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(_) => return,
        };
        if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
            return;
        }
        // El watcher debe seguir vivo mientras este hilo escucha.
        loop {
            match rx.recv() {
                Ok(Ok(event)) => {
                    let touched_md = event.paths.iter().any(|p| {
                        p.extension().and_then(|e| e.to_str()) == Some("md")
                    });
                    if touched_md {
                        let _ = app.emit("vault-changed", ());
                    }
                }
                Ok(Err(_)) => {}
                Err(_) => break,
            }
        }
    });

    Ok(())
}
