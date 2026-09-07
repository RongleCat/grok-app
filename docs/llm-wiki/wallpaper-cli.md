# Wallpaper CLI output lifecycle

X search and Imagine use the existing `run_grok_headless` entry point.
The Host drains stdout and stderr concurrently from process spawn, so filling
either pipe cannot prevent the CLI from exiting while the Host waits.

- Stdout is retained up to 2 MiB; excess output is drained but the request fails.
- Stderr is drained without retaining or logging potentially private content.
- After exit, output collection has a shared two-second deadline. Nonblocking
  readers stop and join even when descendants keep inherited pipes open.
- Timeout and process-wait errors terminate the process tree and stop readers.
  Unix children use a separate session; Windows uses the existing hidden-command
  helper for process-tree termination.
- CLI arguments, model choice, proxy settings and gallery IPC are unchanged.

Regression tests execute synthetic CLI processes for large stdout/stderr,
oversized output, and stopping readers while a child keeps its pipes open.
These tests do not contact Grok or establish live search/generation quality.
