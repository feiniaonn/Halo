// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // NOTE: disable logger init while diagnosing release startup crash.
    halo_lib::run()
}
