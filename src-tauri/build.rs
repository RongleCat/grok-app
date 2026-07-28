fn main() {
    // Windows test STATUS_ENTRYPOINT_NOT_FOUND fix lives in CI (post-link mt.exe
    // Common Controls v6 on the test harness). Do NOT add /MANIFESTINPUT here:
    // tauri_build already embeds a Windows app manifest; a second one fails
    // link with CVT1100 "duplicate resource" (v0.1.9 release).

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
