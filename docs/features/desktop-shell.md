# Desktop shell

- http(s) links open without Windows `cmd /C start` query splitting.
- `secrets.json` writes use atomic lock + rename.
- Child processes use CREATE_NO_WINDOW on Windows to avoid console flash (Fixes #162).
