# Remote IM ready path

GUI configuration for IM bridges with safe defaults.

## Ready behaviours

- Cannot enable a channel without `allow_from`.
- Webhooks default to 127.0.0.1; optional LAN bind with explicit risk copy.
- LINE signature verification when using webhook mode.
- Save & connect stays the primary path (no terminal required).

## Verify

1. Feishu/WeCom/LINE: paste credentials, set allow_from, Save & connect.
2. Leave allow_from empty — enable blocked with guidance.
3. Webhook channel without allow_external — not reachable from LAN.
