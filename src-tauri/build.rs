fn main() {
    // Do not inject extra /MANIFESTINPUT here: Tauri already embeds a Windows
    // app manifest via resource.lib. A second MANIFEST resource makes link.exe
    // fail with CVT1100 "duplicate resource" (release Windows-x64 on v0.1.9).

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
