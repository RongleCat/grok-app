# Desktop shell

System integration for URLs and secret storage.

## Behaviour

- http(s) links open without Windows `cmd /C start` query splitting.
- Account login and Settings external links share the same opener.
- `secrets.json` writes use the same atomic lock path as the session store.

## Verify

1. On Windows, open an OAuth URL that contains `&` — full URL reaches the browser.
2. Save a relay key twice quickly — `secrets.json` remains valid JSON.
