# Resource workbench

File preview and edit under the trust sandbox.

## Behaviour

- Project-relative browse/edit stays inside trusted projects.
- Absolute opens from the UI grant the path for re-read/save.
- SVG previews use the image sandbox (no inline script).
- Out-of-scope paths return a clear denial instead of leaking disk content.

## Verify

1. Browse and edit a text file in a trusted project.
2. Open an SVG — renders as image.
3. Open a file via absolute path from chat card — subsequent open still works (grant).
