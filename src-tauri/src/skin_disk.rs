//! 4 GiB disk budget for skin presets + undo + staging + catalog cache.

use std::fs;
use std::path::Path;

use crate::paths;

pub const SKIN_DISK_BUDGET: u64 = 4 * 1024 * 1024 * 1024;
pub const SKIN_DISK_HEADROOM: u64 = 256 * 1024 * 1024;

pub fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    let Ok(rd) = fs::read_dir(path) else {
        return 0;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        let Ok(meta) = ent.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(dir_size(&p));
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

pub fn skin_data_bytes() -> u64 {
    dir_size(&paths::skin_presets_dir()).saturating_add(dir_size(&paths::skin_catalog_cache_dir()))
}

pub fn preflight(additional: u64) -> Result<(), String> {
    let used = skin_data_bytes();
    if used.saturating_add(additional) > SKIN_DISK_BUDGET {
        return Err(format!(
            "disk_budget: skin data would exceed 4 GiB ({used} + {additional})"
        ));
    }
    let probe = paths::skin_presets_dir();
    match fs2::available_space(&probe) {
        Ok(free) => {
            if free < additional.saturating_add(SKIN_DISK_HEADROOM) {
                return Err(format!(
                    "disk_budget: volume free space {free} below needed {}",
                    additional.saturating_add(SKIN_DISK_HEADROOM)
                ));
            }
        }
        Err(e) => {
            tracing::warn!(target: "skin_pack", "statvfs failed: {e}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_constant_is_4_gib() {
        assert_eq!(SKIN_DISK_BUDGET, 4 * 1024 * 1024 * 1024);
    }
}
