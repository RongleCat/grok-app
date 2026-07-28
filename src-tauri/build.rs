fn main() {
    // Windows MSVC unit-test binaries need Common Controls v6 or they can abort
    // at process start with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139). Release /
    // app binaries already get a full manifest from tauri_build::build() — do
    // NOT add a second MANIFESTINPUT there (CVT1100 duplicate resource).
    //
    // Opt-in only: set GROK_EMBED_WIN_TEST_MANIFEST=1 for `cargo test` (CI).
    // build.rs cannot distinguish test vs release via PROFILE/CARGO_CFG_TEST.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let embed_test_manifest = std::env::var("GROK_EMBED_WIN_TEST_MANIFEST")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if embed_test_manifest && target_os == "windows" && target_env == "msvc" {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("windows-test-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            manifest.to_str().expect("manifest path is valid UTF-8")
        );
    }
    println!("cargo:rerun-if-env-changed=GROK_EMBED_WIN_TEST_MANIFEST");

    println!("cargo:rerun-if-env-changed=GROK_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=GROK_UPDATER_ENDPOINT");
    println!("cargo:rustc-check-cfg=cfg(grok_updater_enabled)");

    // Release CI injects both env vars so registration is allowed at runtime.
    // Local `tauri dev` leaves env unset → plugin crate is linked for ACL only,
    // never registered.
    let updater_public_key = std::env::var("GROK_UPDATER_PUBLIC_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let updater_endpoint = std::env::var("GROK_UPDATER_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if updater_public_key.is_some() && updater_endpoint.is_some() {
        println!("cargo:rustc-cfg=grok_updater_enabled");
    }

    tauri_build::build()
}
