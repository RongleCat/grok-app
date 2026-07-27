fn main() {
    // Workaround for STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) when running
    // `cargo test` on Windows MSVC: embed the common-controls v6 app manifest
    // so the test harness binary can load. See:
    // https://github.com/tauri-apps/tauri/pull/4383#issuecomment-1212221864
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            manifest.to_str().expect("manifest path is valid UTF-8")
        );
    }

    tauri_build::build()
}
