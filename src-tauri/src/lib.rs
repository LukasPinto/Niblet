mod commands;

#[cfg(target_os = "windows")]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut std::ffi::c_void,
        dw_attribute: u32,
        pv_attribute: *const std::ffi::c_void,
        cb_attribute: u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
fn apply_titlebar_color(hwnd: *mut std::ffi::c_void, dark: bool) {
    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;
    let dark_mode: u32 = if dark { 1 } else { 0 };
    // COLORREF es BGR; dark: #191919, light: #ffffff
    let caption: u32 = if dark { 0x00191919 } else { 0x00ffffff };
    let text: u32 = if dark { 0x00909090 } else { 0x00191919 };
    unsafe {
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark_mode as *const u32 as *const _, 4);
        DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &caption as *const u32 as *const _, 4);
        DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, &text as *const u32 as *const _, 4);
    }
}

#[tauri::command]
fn set_titlebar_theme(window: tauri::WebviewWindow, dark: bool) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            apply_titlebar_color(hwnd.0, dark);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (window, dark);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(hwnd) = window.hwnd() {
                        apply_titlebar_color(hwnd.0, true); // dark por defecto
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            set_titlebar_theme,
            commands::vault::list_notes,
            commands::vault::read_note,
            commands::vault::write_note,
            commands::vault::create_note,
            commands::vault::delete_note,
            commands::vault::delete_folder,
            commands::vault::delete_file,
            commands::vault::list_folders,
            commands::vault::create_folder,
            commands::vault::list_images,
            commands::vault::save_image,
            commands::vault::save_pasted_image,
            commands::vault::save_clipboard_image,
            commands::vault::move_file,
            commands::vault::move_folder,
            commands::vault::update_image_links,
            commands::vault::read_image_base64,
            commands::vault::read_file_bytes,
            commands::vault::write_file_bytes,
            commands::vault::create_directory,
            commands::tasks::scan_all_tasks,
            commands::tasks::toggle_task,
            commands::tasks::set_task_status,
            commands::tasks::set_task_due_date,
            commands::tasks::set_task_priority,
            commands::sync::hash_file,
            commands::sync::record_save,
            commands::sync::record_file_save,
            commands::sync::read_snapshot,
            commands::sync::record_moved_note,
            commands::sync::detect_conflicts,
            commands::sync::watch_vault,
            commands::onedrive::onedrive_get_client_id,
            commands::onedrive::onedrive_set_client_id,
            commands::onedrive::onedrive_configured,
            commands::onedrive::onedrive_account,
            commands::onedrive::onedrive_logout,
            commands::onedrive::onedrive_device_start,
            commands::onedrive::onedrive_device_poll,
            commands::onedrive::onedrive_token,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Niblet");
}
