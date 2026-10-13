//! CosmoRisk: near-Earth object simulator.

// Index loops read better than iterator chains in the numeric code.
#![allow(clippy::needless_range_loop, clippy::too_many_arguments, clippy::type_complexity)]

mod commands;
mod data;
mod physics;
mod sim;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new();
    sim::spawn_loop(state.sim.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                let state = app.state::<AppState>();
                *state.store.lock() = Some(data::cache::Store::new(dir));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_frame,
            commands::get_bodies,
            commands::get_planets,
            commands::get_body_detail,
            commands::get_orbit_path,
            commands::moon_orbit,
            commands::set_paused,
            commands::set_rate,
            commands::set_date,
            commands::sync_now,
            commands::reset_simulation,
            commands::remove_bodies,
            commands::take_events,
            commands::load_catalog,
            commands::load_object,
            commands::cached_catalog_info,
            commands::restore_cached_catalog,
            commands::upcoming_close_approaches,
            commands::object_close_approaches,
            commands::sentry_list,
            commands::sentry_detail,
            commands::scan_approaches,
            commands::plan_deflection,
            commands::apply_deflection,
            commands::run_monte_carlo,
            commands::cancel_monte_carlo,
            commands::assess,
            commands::save_scenario,
            commands::list_scenarios,
            commands::load_scenario,
            commands::delete_scenario,
            commands::export_scenario,
            commands::import_scenario,
            commands::write_text_file,
            commands::read_text_file,
            commands::write_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CosmoRisk");
}
