# Network debugging (client UI)

This document describes the **Server** and **Performance** dialogs in the multiplayer client: what each control does, how to use them to simulate or observe network-related conditions, and how the two dialogs relate.

Open these dialogs from the in-game **Controls** dialog (or whatever UI entry your build exposes for them).

---

## Server dialog (`ServerDialog.tsx`)

The Server dialog combines **developer shortcuts** (teleport, force a cell occupied on the server) with **client-side simulation** of latency and jitter, **animation tuning** for remote entities, and a **sync** toggle that gates whether local Player-dialog changes are sent to the server.

### Actions (buttons)

| Control | What it does |
|--------|----------------|
| **Teleport to cell** | Closes the dialog and arms a one-shot mode. **Release** the left mouse button on the map tile you want; the client sends a teleport request for that world cell. Movement is cancelled when the mode starts. A toast prompts you to click the target cell. |
| **Make server cell occupied** | Same flow, but sends a request to mark that server cell as occupied (for testing server/world state), not a player teleport. Mutually exclusive with teleport mode; the last button you pressed wins. |

Use these when you need a **deterministic world/server condition** without walking there under simulated delay.

### Incoming network delay (0–500 ms)

Applied in `NetworkManager` **after** a WebSocket `message` event: handling of the binary payload is deferred by `setTimeout` for this many milliseconds.

- Simulates **server → client** latency (everything the client receives: game state, pings, teleports, etc.).
- **Does not** throttle the raw socket; it delays **processing** of each message.

### Outgoing network delay (0–500 ms)

Applied before every **send** (except where the code bypasses the normal path): outgoing protobuf packets are delayed by this amount before `WebSocket.send`.

- Simulates **client → server** latency for normal gameplay traffic.

### Incoming / outgoing network fluctuation (0–500 ms)

When greater than zero, each affected message adds **uniform random extra delay** in `[0, fluctuation)` ms on top of the corresponding fixed delay:

- **Incoming:** `totalDelay = incomingLatency + random(0, incomingFluctuation)`
- **Outgoing:** `totalDelay = outgoingLatency + random(0, outgoingFluctuation)`

Use this to mimic **jitter** (variable RTT) without a fixed pattern. Combined with non-zero base delay, you can approximate “bad Wi‑Fi” or cross-region behavior for local testing.

### Movement animation grace period (0–500 ms)

Updates **remote players** and **monsters**: how long the client may **defer switching to idle** after a remote movement/action step ends (`remoteIdleContinuationGraceMs`).

- **Higher values:** more tolerance for late network updates before the animation snaps to idle—useful when debugging **rubber-banding** or animation pops under delay.
- **Lower values:** stricter, snappier idle transitions; can look worse under high latency if updates arrive late.

Changing the slider emits `IN_UI_CHANGE_GRACE_PERIOD` so existing entities pick up the new value immediately.

### Sync with server (checkbox)

When **enabled** (default): changes from the **Player** dialog that affect combat/movement (movement speed, run mode, attack/cast speed, attack range, damage, stun, attack type, dash-attack allowance, attack mode, etc.) are **sent to the server** so authority stays aligned.

When **disabled**: those changes apply **only on the client**. You can reproduce **client-only** tuning or desync scenarios. Other UI (e.g. **Controls** logout) may treat this flag differently—for example, logging out without sync may disconnect without sending a graceful logout request.

---

## Performance dialog (`PerformanceDialog.tsx`)

This dialog has **no interactive controls**. It is a **read-only** dashboard fed by `OUT_UI_GAME_STATS_UPDATE` from the game loop.

| Field | Meaning |
|-------|--------|
| **FPS** | Frames per second from the Phaser/game update path. |
| **Ping** | **Round-trip time (ms)** measured on the client when a ping response is handled: elapsed time from sending the ping request until the response is processed. **Includes** any **simulated** incoming and outgoing delay (and fluctuation) because those defer sends and message handling. |
| **Ping variance** | Value reported by the **server** in the ping response (`pingVariance`), not computed from the client slider. Useful alongside server-side metrics. |
| **Players in map** | From the latest ping response (`playersInMap`). |
| **Game world queue** | From the latest ping response (`gameWorldQueueLength`): server-reported backlog indicator for the current game world. |

### How to use it with the Server dialog

1. **Validate simulated latency:** Raise **incoming** and/or **outgoing** delay and watch **Ping** rise roughly with the extra RTT (exact numbers vary per packet and random jitter).
2. **Validate jitter:** Add **fluctuation** and observe **Ping** (and gameplay feel) vary between samples.
3. **Separate concerns:** **Ping variance** and queue/player counts come from the **server**; only RTT-style delay is fully under the client sliders.

---

## Quick scenarios

| Goal | Server dialog | Performance dialog |
|------|----------------|---------------------|
| **High latency, stable** | Moderate incoming + outgoing; fluctuation 0 | Ping elevated, relatively stable |
| **Jittery connection** | Same + non-zero incoming/outgoing fluctuation | Ping varies; gameplay stutter |
| **Animation under lag** | Adjust **grace period** while delay sliders are non-zero | Use FPS + subjective feel; ping confirms delay |
| **Authority vs local-only** | Toggle **Sync with server** | Ping still works; behavior diverges when sync is off |
| **Server cell / teleport tests** | Use the two buttons, then click the map | Normal stats; verify server reactions in logs or world state |

---

## Implementation references

- Delay and fluctuation: `multiplayer/mp-client/src/utils/NetworkManager.ts` (WebSocket `message` listener and `sendPacket`).
- Grace period propagation: `IN_UI_CHANGE_GRACE_PERIOD` in `multiplayer/mp-client/src/game/scenes/GameWorld.ts`.
- Sync gating: `syncWithServer` checks in `GameWorld.setupControlDialogEventListeners`.
- Performance stats: `OUT_UI_GAME_STATS_UPDATE` emission in `GameWorld` and subscription in `multiplayer/mp-client/src/ui/store/PerformanceDialog.store.ts`.
