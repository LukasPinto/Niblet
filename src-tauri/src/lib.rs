mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
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
