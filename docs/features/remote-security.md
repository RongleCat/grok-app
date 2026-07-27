# Remote control security

Defaults protect a machine that exposes phone mirror or IM bridges.

## Behaviour

- IM channels require an allow list before enable; empty lists are fail-closed.
- Webhook listeners bind to loopback unless the user opts into external access.
- LINE validates `X-Line-Signature`.
- Phone mirror starts read-only; regenerate link rotates the token.

## Verify

1. Create an IM channel without allow_from — cannot enable.
2. Start mirror — phone can view but not send until “Allow phone to send”.
3. Regenerate link — old QR fails; new QR works.
