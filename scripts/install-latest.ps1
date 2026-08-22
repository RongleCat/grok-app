# Sync origin/main, build a side-by-side Windows NSIS, install to
# %LOCALAPPDATA%\grok-app-latest.
#
# Overlay productName + identifier so the single-instance mutex is
# com.grokapp.desktop.latest-sim (not the official com.grokapp.desktop-sim).
# App settings/sessions stay on the shared %APPDATA%\grokapp\grok-app root —
# do not run this build and official Grok as writers at the same time.
#
# Requires a clean tracked tree. Unsigned (--no-sign). Not a GitHub Release.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProductName = "grok-app-latest"
$InstallDir = Join-Path $env:LOCALAPPDATA $ProductName
$Triple = "x86_64-pc-windows-msvc"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step([string]$msg) {
  Write-Host ""
  Write-Host "======== $msg ========"
}

function Need-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "missing '$name'. Windows native deps: Node 22+, pnpm 9, Rust MSVC, VS Build Tools. See docs/BUILD.md."
  }
}

function Restore-BuildNoise {
  # cargo/tauri may retouch Cargo.toml with CRLF; no content change.
  $file = "src-tauri/Cargo.toml"
  if (-not (git diff --ignore-cr-at-eol -- $file)) {
    git restore -- $file
  }
}

function Assert-CleanTracked {
  Restore-BuildNoise
  $dirty = git status --porcelain --untracked-files=no
  if ($LASTEXITCODE -ne 0) { throw "git status failed" }
  if ($dirty) { throw "tracked files are dirty:`n$dirty" }
}

function Get-InstalledAppProcesses {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)
    }
}

function Stop-InstalledApp {
  Get-InstalledAppProcesses | ForEach-Object {
    Write-Host "stop pid $($_.ProcessId) $($_.ExecutablePath)"
    Stop-Process -Id $_.ProcessId -Force
  }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    if (-not (Get-InstalledAppProcesses)) { return }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  throw "app still running under $InstallDir"
}

Need-Cmd git
Need-Cmd pnpm
Need-Cmd rustc
Need-Cmd cargo

Write-Host "side-by-side unsigned install → $InstallDir"
Write-Host "does not replace official Grok. origin/main, clean tracked tree required."

Step "sync origin/main"
Assert-CleanTracked
$originUrl = (git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0) { throw "git remote get-url origin failed" }
Write-Host "origin $originUrl"
$prev = (git branch --show-current).Trim()
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "git fetch origin failed" }
if ($prev -and $prev -ne "main") {
  Write-Host "leaving branch $prev → main"
}
git checkout main
if ($LASTEXITCODE -ne 0) { throw "git checkout main failed" }
git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) { throw "fast-forward main to origin/main failed" }
$sha = (git rev-parse --short HEAD).Trim()
$fullSha = (git rev-parse HEAD).Trim()
Write-Host "HEAD $sha"

Step "pnpm install"
pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

$override = Join-Path $env:TEMP "tauri.$ProductName.json"
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  $override,
  (@{
    productName = $ProductName
    identifier = "com.grokapp.desktop.latest"
  } | ConvertTo-Json -Compress),
  $utf8
)

Step "build $Triple as $ProductName"
pnpm exec tauri build --target $Triple --bundles nsis --no-sign --ci --config $override
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
Restore-BuildNoise

$nsisDir = Join-Path $Root "src-tauri\target\$Triple\release\bundle\nsis"
$setup = Get-ChildItem $nsisDir -Filter "${ProductName}_*-setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $setup) { throw "NSIS setup not found in $nsisDir" }
Write-Host "setup $($setup.FullName)"

Step "install $InstallDir"
Stop-InstalledApp
Start-Process -Wait -FilePath $setup.FullName -ArgumentList "/S"

$exe = $null
foreach ($name in @("grok-app.exe", "${ProductName}.exe")) {
  $candidate = Join-Path $InstallDir $name
  if (Test-Path $candidate) {
    $exe = $candidate
    break
  }
}
if (-not $exe) { throw "missing grok-app.exe under $InstallDir" }
$item = Get-Item $exe
if ($item.Length -lt 1MB) { throw "exe too small: $($item.Length)" }
if ($item.LastWriteTime -lt $setup.LastWriteTime.AddMinutes(-5)) {
  throw "exe older than setup: $($item.LastWriteTime) vs $($setup.LastWriteTime)"
}

$lnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$ProductName.lnk"
$ver = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion
$pkgVer = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version

Write-Host ""
Write-Host "VERIFY OK"
Write-Host "sha     $fullSha"
Write-Host "pkg     $pkgVer"
Write-Host "exe     $exe"
Write-Host "size    $($item.Length)"
Write-Host "mtime   $($item.LastWriteTime.ToString('s'))"
Write-Host "filever $ver"
Write-Host "setup   $($setup.Name)"
Write-Host "start   $(Test-Path $lnk)"
