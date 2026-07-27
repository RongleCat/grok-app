# Trust sandbox

Local file access for the resource pane and `media://` previews is limited to:

- Trusted project folders
- App data (`~/.grok-app`)
- System temp
- Paths the user explicitly opened (picker / grant)

## How to verify

1. Open a trusted project file in the resource pane — preview and edit work.
2. Attempt to open a path outside projects (if exposed) — denied with a clear error.
3. Open an SVG — renders as an image; scripted SVG does not run.
4. Open an `.xlsx` — table preview without HTML injection.
