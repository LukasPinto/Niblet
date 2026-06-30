// Evita una segunda consola en Windows en release. ¡NO QUITAR!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    niblet_lib::run()
}
