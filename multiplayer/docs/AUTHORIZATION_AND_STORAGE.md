# Authorization and storage

This document describes how **identity** and **persistence** work in the bundled multiplayer server and client. Both are **deliberately minimal** so the project runs end-to-end without external services. They are **not** a production-grade account system or database layer.

For a real deployment you should replace this with a proper identity stack (accounts, passwords or SSO, session tokens, rate limits, anti-abuse) and a durable storage tier (database, backups, migrations, possibly sharded character storage). The gameplay server is built to be authoritative over simulation; **who is allowed to connect** and **where characters live long-term** should be designed for your threat model and ops requirements.

---

## Authentication (authorization) model

### What “login” means here

There is **no** password, API key, OAuth flow, or cryptographic proof of identity. “Authentication” is:

1. The client opens a WebSocket to the server.
2. The **first** binary message on that connection **must** be a protobuf `ClientMessage` whose payload is `AuthenticateRequest` (see [`multiplayer/proto/network.proto`](../proto/network.proto)).
3. That request carries two strings the server treats as authoritative for this demo:
   - **`id`** — the client’s **network id** (see below).
   - **`characterName`** — display name; trimmed and required non-empty.

Until that message is received, the server only accepts binary traffic for this handshake; anything else is rejected. After a successful authenticate, duplicate `AuthenticateRequest` messages on the same connection are rejected.

Implementation reference: WebSocket loop and `TryAuthenticatePlayer` in [`multiplayer/server/Server.cs`](../server/Server.cs).

### Where the client’s `id` comes from

The multiplayer client generates a **stable UUID** when needed and keeps it in **browser `localStorage`** under the key `gameState`, together with UI preferences (zoom, volumes) and the last-used character name. On connect, `NetworkManager` sends that stored id as `AuthenticateRequest.id`.

Implementation reference: [`multiplayer/mp-client/src/utils/GameStateManager.ts`](../mp-client/src/utils/GameStateManager.ts) and [`multiplayer/mp-client/src/utils/NetworkManager.ts`](../mp-client/src/utils/NetworkManager.ts) (`sendAuthentication`).

### What the server does with `id`

- The server maps **`id` → `PlayerSession`** in memory (`ConcurrentDictionary<string, PlayerSession>`). That string is the **only** client-supplied credential.
- **Anyone who knows or guesses another player’s `id` could impersonate them** on this demo stack. UUIDs are not secret in practice (they leak via logs, screenshots, shared machines, etc.).
- Session rules that matter for gameplay:
  - **Duplicate live connections**: if a session already has an open WebSocket for that `id`, a second connection is rejected (“already connected”).
  - **Reconnect**: if the socket drops but the session is still within the configured disconnect grace window, a new socket can **reattach** to the same in-world character using the same `id` (no new character, no re-load from disk for that path).

There is **no** server-side account database and **no** verification step beyond “non-empty id and character name” and the session/reconnect rules above.

---

## Server-side data storage

### Location and format

- Saves live under **`Chars/`** next to the server process working directory (see `charsDirectory` in [`multiplayer/server/Server.cs`](../server/Server.cs)).
- One file per player: **`{networkId}.json`** (invalid filename characters in `id` cause the save path to be skipped).
- Content is JSON deserialized into **`PlayerPersistenceState`**: world id, tile position, combat/movement settings, appearance, inventory/equipment snapshots, character name, etc.

Schema and field meanings: [`multiplayer/server/World/Game/GameWorldMessage.cs`](../server/World/Game/GameWorldMessage.cs) (`PlayerPersistenceState` and related persisted inventory records). Application to the in-world player: [`multiplayer/server/World/Game/GameWorldPlayer.cs`](../server/World/Game/GameWorldPlayer.cs) (`ApplyPersistedState`, `CreatePersistenceState`).

### When data is loaded

- On a **new** session (not a reconnect reattachment), after authenticate succeeds, the server calls `LoadPlayerPersistenceState` for that `networkId`. If a file exists, the player is joined using that snapshot; if the saved world id no longer exists, the server **rewrites** the join target using a fallback world and spawn (see `ResolveLoadedPlayerJoin` in `Server.cs`).

### When data is saved

The server writes JSON via `SavePlayerPersistenceState` (atomic-ish write: temp file then move) when it captures a fresh snapshot from the game world, including:

- **WebSocket teardown** — after routing disconnect / ghost state, the host requests a snapshot from the current world and saves if non-null.
- **World transfer** — after the player lands in the target world, a snapshot is saved so the file reflects the new map.
- **Orderly shutdown** — before disposing the world registry, the process persists known sessions so CTRL+C does not rely on WebSocket `finally` paths alone.

The disconnect grace window keeps the **character entity** in the world for other players; persistence is still driven by these snapshot points rather than by a full transactional DB.

---

## Client-side storage (not character progress)

Browser `localStorage` holds **client identity (`networkId`)** and **local preferences**, not the authoritative inventory or position. All gameplay state that must not be cheated is owned by the server.

---

## Summary

| Concern | Demo behavior | Production expectation |
|--------|----------------|-------------------------|
| Identity | Client-chosen string (`id`) + display name | Accounts, tokens, verified sessions, optional 2FA / SSO |
| Trust | Server trusts first `AuthenticateRequest` | Issue credentials server-side; validate on every connection |
| Character data | Per-player JSON under `Chars/` | Database, backups, encryption at rest, scaling, audits |
| Secrecy of `id` | Assumed stable client id | Treat as session handle, not proof of identity |

If you extend this project, plan to **issue** client identities and session secrets from your auth service and **persist** characters in storage you operate and monitor — the current pipeline is a scaffold for demos and local development only.
