//! On-disk storage in the app data directory: the last loaded catalogue (so
//! the app works offline) and saved scenarios.

use super::jpl::SentryEntry;
use super::ObjectRecord;
use crate::sim::Scenario;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
struct CatalogFile {
    version: u32,
    saved_unix: u64,
    objects: Vec<ObjectRecord>,
}

pub struct Store {
    root: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioInfo {
    pub name: String,
    pub saved_unix: u64,
    pub objects: usize,
    pub jd: f64,
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Keep file names portable.
fn sanitize(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        "untitled".into()
    } else {
        s.chars().take(80).collect()
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn catalog_path(&self) -> PathBuf {
        self.root.join("catalog.json")
    }

    fn scenario_dir(&self) -> PathBuf {
        self.root.join("scenarios")
    }

    pub fn save_catalog(&self, objects: &[ObjectRecord]) -> Result<(), String> {
        let file = CatalogFile {
            version: 1,
            saved_unix: now_unix(),
            objects: objects.to_vec(),
        };
        let bytes = serde_json::to_vec(&file).map_err(|e| e.to_string())?;
        write_atomic(&self.catalog_path(), &bytes)
    }

    pub fn load_catalog(&self) -> Option<(Vec<ObjectRecord>, u64)> {
        let bytes = fs::read(self.catalog_path()).ok()?;
        let file: CatalogFile = serde_json::from_slice(&bytes).ok()?;
        Some((file.objects, file.saved_unix))
    }

    pub fn save_sentry(&self, list: &[SentryEntry]) -> Result<(), String> {
        let bytes = serde_json::to_vec(&(now_unix(), list)).map_err(|e| e.to_string())?;
        write_atomic(&self.root.join("sentry.json"), &bytes)
    }

    /// Cached Sentry list and the unix time it was fetched.
    pub fn load_sentry(&self) -> Option<(u64, Vec<SentryEntry>)> {
        let bytes = fs::read(self.root.join("sentry.json")).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn save_scenario(&self, scenario: &Scenario) -> Result<ScenarioInfo, String> {
        let name = sanitize(&scenario.name);
        let bytes = serde_json::to_vec_pretty(scenario).map_err(|e| e.to_string())?;
        write_atomic(&self.scenario_dir().join(format!("{name}.json")), &bytes)?;
        Ok(ScenarioInfo {
            name,
            saved_unix: now_unix(),
            objects: scenario.objects.len(),
            jd: scenario.jd,
        })
    }

    pub fn list_scenarios(&self) -> Vec<ScenarioInfo> {
        let mut out = Vec::new();
        let Ok(rd) = fs::read_dir(self.scenario_dir()) else {
            return out;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };
            let Ok(sc) = serde_json::from_slice::<Scenario>(&bytes) else {
                continue;
            };
            let saved = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(ScenarioInfo {
                name: path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .to_string(),
                saved_unix: saved,
                objects: sc.objects.len(),
                jd: sc.jd,
            });
        }
        out.sort_by_key(|s| std::cmp::Reverse(s.saved_unix));
        out
    }

    pub fn load_scenario(&self, name: &str) -> Result<Scenario, String> {
        let path = self.scenario_dir().join(format!("{}.json", sanitize(name)));
        let bytes = fs::read(&path).map_err(|_| format!("Scenario \"{name}\" not found"))?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Scenario file is damaged: {e}"))
    }

    pub fn delete_scenario(&self, name: &str) -> Result<(), String> {
        let path = self.scenario_dir().join(format!("{}.json", sanitize(name)));
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_names() {
        assert_eq!(sanitize("  ../etc/passwd "), "___etc_passwd");
        assert_eq!(sanitize(""), "untitled");
        assert_eq!(sanitize("Apophis 2029"), "Apophis 2029");
    }
}
