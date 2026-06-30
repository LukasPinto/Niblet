use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use walkdir::WalkDir;

/// Una nota del vault (un archivo `.md`).
#[derive(Serialize, Deserialize, Clone)]
pub struct NoteEntry {
    /// Ruta absoluta en disco.
    pub path: String,
    /// Ruta relativa al vault, con separadores `/`.
    pub rel_path: String,
    /// Nombre del archivo sin extensión.
    pub name: String,
    /// Carpeta padre relativa (vacía si está en la raíz del vault).
    pub folder: String,
    /// Última modificación (epoch en segundos).
    pub modified: u64,
}

/// Una imagen del vault.
#[derive(Serialize, Deserialize, Clone)]
pub struct ImageEntry {
    /// Ruta absoluta en disco.
    pub path: String,
    /// Ruta relativa al vault, con separadores `/`.
    pub rel_path: String,
    /// Nombre del archivo sin extensión.
    pub name: String,
    /// Carpeta padre relativa (vacía si está en la raíz del vault).
    pub folder: String,
    /// Última modificación (epoch en segundos).
    pub modified: u64,
}

/// Carpeta oculta de metadatos del vault (config, hashes, snapshots…).
pub const VAULT_META_DIR: &str = ".niblet";

/// Carpetas que nunca se escanean.
const IGNORED: &[&str] = &[
    VAULT_META_DIR,
    ".obsidian",
    ".git",
    "node_modules",
];

/// Extensiones de imagen reconocidas.
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

/// `true` si la entrada es un archivo de imagen escaneable.
pub fn is_image(path: &Path) -> bool {
    if !path.is_file() || is_ignored(path) {
        return false;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// `true` si la ruta cae dentro de una carpeta ignorada.
pub fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| {
        if let std::path::Component::Normal(os) = c {
            if let Some(s) = os.to_str() {
                return IGNORED.contains(&s);
            }
        }
        false
    })
}

/// Segundos epoch de la última modificación de una entrada.
pub fn modified_secs(entry: &walkdir::DirEntry) -> u64 {
    entry
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `true` si la entrada es un archivo `.md` escaneable.
pub fn is_markdown(path: &Path) -> bool {
    path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") && !is_ignored(path)
}

// Las funciones de escaneo recorren todo el vault leyendo el disco. En vaults
// grandes (o en OneDrive con archivos bajo demanda, que se descargan al
// tocarlos) esto puede tardar. Por eso son `async` + `spawn_blocking`: Tauri
// las ejecuta fuera del hilo principal y la UI no se congela en el primer
// arranque.
#[tauri::command]
pub async fn list_notes(vault_path: String) -> Result<Vec<NoteEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&vault_path);
        if !root.is_dir() {
            return Err(format!("El vault no existe: {vault_path}"));
        }

        let mut notes = Vec::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if !is_markdown(p) {
                continue;
            }
            let rel = p.strip_prefix(&root).unwrap_or(p);
            let rel_path = rel.to_string_lossy().replace('\\', "/");
            let name = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let folder = rel
                .parent()
                .map(|f| f.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            notes.push(NoteEntry {
                path: p.to_string_lossy().to_string(),
                rel_path,
                name,
                folder,
                modified: modified_secs(&entry),
            });
        }

        notes.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(notes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn read_note(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("No se pudo leer la nota: {e}"))
}

#[tauri::command]
pub fn write_note(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| format!("No se pudo guardar la nota: {e}"))
}

#[tauri::command]
pub fn create_note(path: String, template: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("Ya existe una nota en esa ruta".into());
    }
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, template).map_err(|e| format!("No se pudo crear la nota: {e}"))
}

#[tauri::command]
pub fn delete_note(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("No se pudo borrar la nota: {e}"))
}

/// Borra una carpeta y todo su contenido.
#[tauri::command]
pub fn delete_folder(vault_path: String, rel_folder: String) -> Result<(), String> {
    let target = PathBuf::from(&vault_path).join(&rel_folder);
    fs::remove_dir_all(&target).map_err(|e| format!("No se pudo borrar la carpeta: {e}"))
}

/// Borra un archivo cualquiera (imágenes, etc.). Las notas usan `delete_note`.
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("No se pudo borrar el archivo: {e}"))
}

fn invalid_name_chars() -> &'static [char] {
    &['\\', '/', ':', '*', '?', '"', '<', '>', '|']
}

fn validate_folder_rel(rel: &str) -> Result<(), String> {
    if rel.is_empty() {
        return Err("El nombre de carpeta no puede estar vacío".into());
    }
    for segment in rel.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err("Ruta de carpeta no válida".into());
        }
        if segment.chars().any(|c| invalid_name_chars().contains(&c)) {
            return Err("El nombre contiene caracteres no permitidos".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_folders(vault_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&vault_path);
        if !root.is_dir() {
            return Err(format!("El vault no existe: {vault_path}"));
        }

        let mut folders = Vec::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if !p.is_dir() || p == root || is_ignored(p) {
                continue;
            }
            let rel = p.strip_prefix(&root).unwrap_or(p);
            let rel_path = rel.to_string_lossy().replace('\\', "/");
            if !rel_path.is_empty() {
                folders.push(rel_path);
            }
        }

        folders.sort();
        Ok(folders)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn create_folder(vault_path: String, rel_folder: String) -> Result<(), String> {
    validate_folder_rel(&rel_folder)?;
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("El vault no existe: {vault_path}"));
    }

    let target = root.join(&rel_folder);
    if target.exists() {
        return Err("Ya existe una carpeta en esa ruta".into());
    }
    if is_ignored(&target) {
        return Err("No se puede crear una carpeta en esa ubicación".into());
    }

    fs::create_dir_all(&target).map_err(|e| format!("No se pudo crear la carpeta: {e}"))
}

/// Lista todas las imágenes del vault.
#[tauri::command]
pub async fn list_images(vault_path: String) -> Result<Vec<ImageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&vault_path);
        if !root.is_dir() {
            return Err(format!("El vault no existe: {vault_path}"));
        }

        let mut images = Vec::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if !is_image(p) {
                continue;
            }
            let rel = p.strip_prefix(&root).unwrap_or(p);
            let rel_path = rel.to_string_lossy().replace('\\', "/");
            let name = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let folder = rel
                .parent()
                .map(|f| f.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            images.push(ImageEntry {
                path: p.to_string_lossy().to_string(),
                rel_path,
                name,
                folder,
                modified: modified_secs(&entry),
            });
        }

        images.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(images)
    })
    .await
    .map_err(|e| e.to_string())?
}

static PASTE_IMAGE_SEQ: AtomicU32 = AtomicU32::new(0);

fn normalize_image_ext(ext: &str) -> String {
    let ext = ext.trim_start_matches('.').to_lowercase();
    match ext.as_str() {
        "" => "png".into(),
        "jpeg" => "jpg".into(),
        "svg+xml" => "svg".into(),
        e if !e.is_empty() && e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()) => {
            e.to_string()
        }
        _ => "png".into(),
    }
}

/// Nombres genéricos que suelen venir del portapapeles (p. ej. WebView2 → `image.png`).
fn is_generic_paste_filename(filename: &str) -> bool {
    let base = Path::new(filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_lowercase();
    matches!(
        base.as_str(),
        "image.png"
            | "image.jpg"
            | "image.jpeg"
            | "image.gif"
            | "image.webp"
            | "image.bmp"
            | "clipboard.png"
            | "blob"
            | "untitled.png"
    ) || (base.starts_with("image.") && base.len() <= 12)
}

/// Estilo Obsidian: `Pasted image {timestamp}-{seq}.png` — evita colisiones al pegar rápido.
fn pasted_image_filename(root: &Path, ext: &str) -> String {
    let ext = normalize_image_ext(ext);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = PASTE_IMAGE_SEQ.fetch_add(1, Ordering::Relaxed);
    let proposed = format!("Pasted image {millis}-{seq}.{ext}");
    unique_filename(root, &proposed)
}

/// Devuelve un nombre de archivo libre en `root` a partir del propuesto,
/// añadiendo `-1`, `-2`… si ya existe.
fn unique_filename(root: &Path, filename: &str) -> String {
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let ext = path.extension().and_then(|s| s.to_str()).map(String::from);

    let mut final_name = filename.to_string();
    let mut n = 1;
    while root.join(&final_name).exists() {
        final_name = match &ext {
            Some(e) => format!("{stem}-{n}.{e}"),
            None => format!("{stem}-{n}"),
        };
        n += 1;
    }
    final_name
}

/// Guarda bytes de imagen en la raíz del vault. Devuelve el nombre final usado
/// (puede diferir del propuesto si ya existía un archivo con ese nombre).
#[tauri::command]
pub fn save_image(vault_path: String, filename: String, data: Vec<u8>) -> Result<String, String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("El vault no existe: {vault_path}"));
    }

    let ext = Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let final_name = if is_generic_paste_filename(&filename) {
        pasted_image_filename(&root, ext)
    } else {
        unique_filename(&root, &filename)
    };
    fs::write(root.join(&final_name), &data)
        .map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
    Ok(final_name)
}

/// Guarda bytes de imagen pegados con nombre único automático (estilo Obsidian).
#[tauri::command]
pub fn save_pasted_image(
    vault_path: String,
    ext: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("El vault no existe: {vault_path}"));
    }
    let final_name = pasted_image_filename(&root, &ext);
    fs::write(root.join(&final_name), &data)
        .map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
    Ok(final_name)
}

/// Lee la imagen del portapapeles del sistema, la codifica como PNG y la guarda
/// en la raíz del vault. Devuelve el nombre del archivo creado.
///
/// En Windows (WebView2) el evento `paste` del DOM no entrega los bytes de una
/// imagen capturada, así que la leemos directamente del portapapeles del SO.
#[tauri::command]
pub fn save_clipboard_image(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("El vault no existe: {vault_path}"));
    }

    let image = app
        .clipboard()
        .read_image()
        .map_err(|_| "No hay ninguna imagen en el portapapeles".to_string())?;

    let width = image.width();
    let height = image.height();
    let rgba = image.rgba();

    let mut png: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut png), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("No se pudo codificar la imagen: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("No se pudo codificar la imagen: {e}"))?;
    }

    let final_name = pasted_image_filename(&root, "png");
    fs::write(root.join(&final_name), &png)
        .map_err(|e| format!("No se pudo guardar la imagen: {e}"))?;
    Ok(final_name)
}

/// Mueve un archivo (creando carpetas destino si hace falta).
#[tauri::command]
pub fn move_file(from_path: String, to_path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&from_path, &to_path).map_err(|e| format!("No se pudo mover el archivo: {e}"))
}

/// Mueve una carpeta entera y actualiza los enlaces de imagen en las notas
/// (reemplaza el prefijo `old_rel/` por `new_rel/`).
#[tauri::command]
pub fn move_folder(vault_path: String, old_rel: String, new_rel: String) -> Result<(), String> {
    let root = PathBuf::from(&vault_path);
    let old_abs = root.join(&old_rel);
    let new_abs = root.join(&new_rel);

    if !old_abs.is_dir() {
        return Err("La carpeta no existe".into());
    }
    if new_abs.exists() {
        return Err("Ya existe algo en esa ubicación".into());
    }
    if let Some(parent) = new_abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&old_abs, &new_abs).map_err(|e| format!("No se pudo mover la carpeta: {e}"))?;

    // Las notas que estaban dentro de la carpeta ahora tienen un rel_path nuevo:
    // migrar su hash/snapshot de `old_rel/...` a `new_rel/...`.
    let moved_prefix = format!("{new_rel}/");
    let mut content_updates: Vec<(String, String)> = Vec::new();

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if !is_markdown(p) {
            continue;
        }
        let rel_now = p
            .strip_prefix(&root)
            .unwrap_or(p)
            .to_string_lossy()
            .replace('\\', "/");

        // ¿Es una nota que se movió con la carpeta? Reconstruir su rel antiguo.
        if let Some(suffix) = rel_now.strip_prefix(&moved_prefix) {
            let old_note_rel = format!("{old_rel}/{suffix}");
            crate::commands::sync::rename_snapshot(&root, &old_note_rel, &rel_now)?;
        }

        // Actualizar prefijos de imagen en el contenido: ](old_rel/ → ](new_rel/
        let Ok(content) = fs::read_to_string(p) else {
            continue;
        };
        let updated = content.replace(&format!("]({old_rel}/"), &format!("]({new_rel}/"));
        if updated != content {
            fs::write(p, &updated).map_err(|e| format!("No se pudo actualizar la nota: {e}"))?;
            content_updates.push((rel_now, updated));
        }
    }

    // Tras migrar las claves, refrescar el hash de las notas cuyo contenido cambió.
    crate::commands::sync::refresh_snapshots(&root, &content_updates)?;
    Ok(())
}

/// Actualiza los enlaces de imagen en todas las notas tras mover una imagen.
/// Reemplaza tanto la ruta relativa completa como el nombre base del archivo.
#[tauri::command]
pub fn update_image_links(
    vault_path: String,
    old_rel_path: String,
    new_rel_path: String,
) -> Result<(), String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("El vault no existe: {vault_path}"));
    }

    let old_name = Path::new(&old_rel_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&old_rel_path)
        .to_string();
    let new_name = Path::new(&new_rel_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&new_rel_path)
        .to_string();

    // (rel_path de la nota, contenido nuevo) para refrescar sus snapshots y no
    // marcar conflictos falsos al detectar disco ≠ snapshot.
    let mut snapshot_updates: Vec<(String, String)> = Vec::new();

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if !is_markdown(p) {
            continue;
        }
        let Ok(content) = fs::read_to_string(p) else {
            continue;
        };
        // Primero la ruta relativa completa (más específica), luego el nombre base.
        let updated = content
            .replace(
                &format!("]({old_rel_path})"),
                &format!("]({new_rel_path})"),
            )
            .replace(&format!("]({old_name})"), &format!("]({new_name})"));
        if updated != content {
            let rel = p
                .strip_prefix(&root)
                .unwrap_or(p)
                .to_string_lossy()
                .replace('\\', "/");
            fs::write(p, &updated).map_err(|e| format!("No se pudo actualizar la nota: {e}"))?;
            snapshot_updates.push((rel, updated));
        }
    }

    crate::commands::sync::refresh_snapshots(&root, &snapshot_updates)?;
    Ok(())
}

/// Lee una imagen y la devuelve codificada en base64.
#[tauri::command]
pub fn read_image_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer la imagen: {e}"))?;
    Ok(BASE64.encode(bytes))
}

/// Lee un archivo binario del disco (p. ej. imágenes para sync con OneDrive).
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))
}

/// Escribe bytes en disco, creando directorios padre si hace falta.
#[tauri::command]
pub fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, data).map_err(|e| format!("No se pudo escribir el archivo: {e}"))
}
