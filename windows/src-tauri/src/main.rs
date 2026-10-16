// PeDitX-Goo runs without a console window: the island is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    peditx_goo_lib::run()
}
