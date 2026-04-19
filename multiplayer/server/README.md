# MMORPG Base Game — Multiplayer Server

An authoritative multiplayer game server written in **C# / .NET 10**, designed as a base to build MMORPG projects on top of. It runs the full game simulation (movement, combat, spells, inventory, monster AI, NPCs, world transfers, chat) on the server and synchronises every connected client over **WebSockets** using **Protobuf** binary messages.

The matching client lives in [`multiplayer/mp-client`](../mp-client) and is feature-equivalent to the single-player client — see [`sp-client/README.md`](../../sp-client/README.md) for tech stack details (Phaser 3, React, TypeScript, Vite, asset pipeline, sprite/map formats, etc.). Everything described there applies to the multiplayer client too; the only difference is that all gameplay-authoritative state is owned by this server and delivered over the wire.

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [C# / .NET 10](https://dotnet.microsoft.com/) | Server runtime and language |
| [ASP.NET Core WebSockets](https://learn.microsoft.com/aspnet/core/fundamentals/websockets) | Transport |
| [Google.Protobuf](https://protobuf.dev/) | Wire format (shared `.proto` schemas in [`multiplayer/proto`](../proto)) |

Communication between client and server runs over a single **WebSocket** connection per player. Every message is a length-delimited **protobuf** `ClientMessage` / `ServerMessage` payload — no JSON, no REST. See [`CLIENT_SERVER_SYNC.md`](../docs/CLIENT_SERVER_SYNC.md) for the full message catalogue and the prediction / authority split.

---

## Prerequisites

- [.NET SDK 10](https://dotnet.microsoft.com/download) (the project targets `net10.0`)

---

## Quick Start

```bash
cd multiplayer/server
dotnet run
```

The server binds the port configured in [`Config/Settings.json`](./Config/Settings.json) (default `1337`). Point the multiplayer client at it and connect.

---

## Server Configuration

All runtime behaviour — port, world layout, tick rate, view radii, anti-cheat tolerances, monster defaults, thread pinning, ping policy — is driven from JSON files in [`Config/`](./Config):

- `Settings.json` — engine-wide knobs
- `GameWorlds.json` — map list and per-world worker pinning
- `Monsters.json`, `NPCs.json`, `Items.json`, `Spells.json` — content catalogs

See [`SERVER_CONFIGURATION.md`](../docs/SERVER_CONFIGURATION.md) for the exhaustive reference on every field and how it is validated at startup.

---

## Features

The server implements a complete MMORPG gameplay loop with authoritative simulation and the usual MMO safety nets:

- **Grid-based authoritative movement** with client-side prediction + server reconciliation ([`MOVEMENT_SYSTEM.md`](../docs/MOVEMENT_SYSTEM.md)).
- **Server-authoritative visibility tracking** — per-player "in range" sets for players, monsters, NPCs, ground effects, and ground items, updated on every tile step ([`SERVER_VISIBILITY_TRACKING.md`](../docs/SERVER_VISIBILITY_TRACKING.md)).
- **Combat** — melee, bow, ranged, PvP, PvM, MvM with stun/knockback/interrupt semantics ([`COMBAT_SYSTEM.md`](../docs/COMBAT_SYSTEM.md)).
- **Spells and ground effects** — cast start/commit phases, AoE, directional AoE, ticking ground effects ([`SPELL_CASTING_SYSTEM.md`](../docs/SPELL_CASTING_SYSTEM.md)).
- **Inventory, equipment, ground loot** — bag state, drop/pickup, per-cell ground stacks ([`INVENTORY_AND_ITEMS_SYSTEM.md`](../docs/INVENTORY_AND_ITEMS_SYSTEM.md)).
- **Monster AI** — wander, chase, allegiance pairing, damage aggro, stunlock, spell casts, ranged attacks ([`SERVER_MONSTER_AI.md`](../docs/SERVER_MONSTER_AI.md)).
- **Multiple maps with world transfer** — each map runs as its own single-threaded actor, with a dedicated `GlobalWorld` for cross-map features like chat ([`SERVER_THREADING_AND_PACKET_FLOW.md`](../docs/SERVER_THREADING_AND_PACKET_FLOW.md)).

### Anti-hack guards (timing-based)

The server never trusts the client for gameplay-affecting state. Client packets go through timing and positional validation before they can mutate the world:

- **Movement cadence** — the interval between `RequestMovement` packets is compared against the server's view of the player's movement speed (plus `antiHackTimingLagFactor` tolerance for jitter). Repeated violations apply server-forced paralysis and a chat warning.
- **Anti-teleport** — the reported `cur` cell must be within `maxCellsJumpDistance` of the server cell, and the destination must be exactly one Chebyshev step from the **server** cell (not from a stale client `cur`). Stale / duplicate packets are dropped.
- **Spell cast timing** — `SpellCastRequest` is rejected if it arrives too early vs `castSpeedMs` + observed ping variance (`SpellCastFailed` is sent back).
- **Combat range** — attack packets are validated against server positions and server-held attack range; out-of-range hits are dropped silently.
- **Ping liveness** — missed ping intervals or excessive RTT variance (`ping.allowedVariance` over `ping.varianceSampleSize` samples) disconnect the player.

See [`CLIENT_SERVER_SYNC.md`](../docs/CLIENT_SERVER_SYNC.md) for the full guard table and how to intentionally desync a client via **Sync with server** to exercise every guard path.

### Anti-disconnect measures

Network blips are expected in a real MMO, not treated as the player logging out. When a session drops, the `PlayerSession` stays alive and the avatar **remains active in the game world** for `timings.disconnectTime` seconds (configurable). During this grace window:

- The player's entity keeps its grid occupancy and visibility membership so other players still see them.
- A fresh WebSocket connection that authenticates as the same session **reattaches** to the existing in-world character — no respawn, no re-entry, no state loss.
- Persisted state is written on final removal, not on the first disconnect.

Only when the grace window elapses is the character fully removed from the world.

This mechanism doubles as an **anti-combat-logging** measure. A player who pulls the plug to escape a sticky situation — low HP in PvP, surrounded by monsters, mid-stunlock — does not vanish from the world. Their character stays on the map in a **vulnerable state** for the full grace window and can still be hit, killed, and looted exactly as if they were online. That makes an unauthorised disconnect **more harmful than staying logged in**, and removes the incentive to rage-quit out of bad fights.

### Bump prevention (course correction)

When two players race to the same destination cell, the naive approach is to bounce the loser back to their previous cell — which feels jarring and creates visible "pops". Instead, with `courseCorrection: true` (see [`Config/Settings.json`](./Config/Settings.json)), the server attempts to **slide the player into an adjacent free cell** in the same general direction and sends back a `PositionCorrected` packet. The step still happens, just sideways, which keeps movement fluid when two actors contest the same tile.

If no adjacent slot is free, the server falls back to a full `ResetPosition`.

Course correction is **best-effort**, not a guarantee. When ping is unusually high or the client's movement speed is very fast, the client can predict itself several cells past where a sideways slide would still look coherent — by the time the `RequestMovement` arrives, the client is already too far ahead for an adjacent-cell correction to resolve the divergence. In those cases the server falls back to a full `ResetPosition` to snap the client back to authoritative state before the desync grows further. The alternative (accepting an ever-growing drift) would compound into much larger position rubber-banding later, so the occasional reset is preferred.

---

## Authentication and persistence

The bundled authentication and player-data storage is **intentionally bare-minimum** and is **not suitable for real-world deployment**. It exists only so the server boots and plays end-to-end out of the box, and deliberately avoids making opinionated choices about:

- how players are authenticated (accounts, tokens, OAuth, external identity providers, anti-bot, etc.)
- how and where character state is persisted (file system, relational DB, key-value store, cloud storage, sharding, backups, migrations, etc.)

These concerns are left **at the discretion of the implementor** — pick whatever auth and storage stack fits your project, and replace the built-in stubs with a production-grade implementation before running this server for real users.

---

## Performance

Considerable care has been taken to keep the server **low-latency** and **high-throughput**, especially under the sustained allocation pressure typical of MMORPG tick loops:

- **Reduced heap pressure → fewer stop-the-world pauses.** Hot paths (packet dispatch, visibility diffs, movement, monster AI, protobuf encode/decode) reuse per-world scratch containers, rent buffers from `ArrayPool<byte>.Shared`, iterate via struct enumerators instead of boxed `IEnumerator`, and avoid LINQ entirely. Gen0 collections stay small, Gen2 promotion stays rare, and GC pauses do not translate into tick-time spikes. The runtime is configured with `GCLatencyMode.SustainedLowLatency` on startup.
- **Single-threaded worlds, multi-threaded server.** Each `GameWorld` (map) is a single-consumer actor — one worker thread owns its state and drains its bounded mailbox, which eliminates locks inside gameplay logic. At the same time, **multiple worlds can be distributed across multiple worker threads** (`threads.gameWorldWorkers` in `Settings.json`, with optional per-world pinning in `GameWorlds.json`), so modern multi-core CPUs are fully utilised. Worlds can be pinned to workers or load-balanced round-robin.
- **Bounded mailboxes with backpressure.** Incoming channels (`gameWorld.incomingMessagesQueueSize`) apply backpressure to producers instead of growing unbounded in memory. Mailbox batching (`incomingMessagesBatchSizePerDispatch`) prevents a flood of packets from starving sibling worlds on the same worker.
- **Zero-copy protobuf send path.** `enableZeroCopyProtobufTransfer` switches outbound encoding to `WriteTo(Span<byte>)` on a rented buffer, cutting temporary allocations on the send loop at the cost of a small throughput dip vs the `MemoryStream`/`CodedOutputStream` path — an explicit latency-vs-throughput trade-off.
- **Spatial grids, not `O(total players)` scans.** Visibility, chase, and broadcast operations all run against `PlayersSpatialGrid`, `MonstersSpatialGrid`, `NpcsSpatialGrid`, and `GroundStateTracker` — work scales with local density, not world size.
- **Prebuilt static wire messages.** Messages whose content is identical for every client (e.g. worlds list, monsters catalog) are serialised once at startup and reused, not rebuilt per connection.

For the full list of optimisations and where they live in the codebase, see [`SERVER_PERFORMANCE_OPTIMIZATIONS.md`](../docs/SERVER_PERFORMANCE_OPTIMIZATIONS.md).

---

## Stress Testing

Two sample stress-test reports are included. Both were run on an **Apple M1 MacBook Pro** with the server configured to spread simulated players uniformly across maps and within each map:

- [`Config/Settings.json`](./Config/Settings.json) `spawnInMiddle: false` — spawn search starts at a random tile instead of the map centre
- [`Config/Settings.json`](./Config/Settings.json) `spawnToRandomMap: true` — new clients are assigned a random world from the registered maps

The maps used were **Aresden**, **Elvine**, and **Promiseland**, each with their configured monster pits populated so the simulation matches a real server setup (AI ticks, visibility fan-out, ground effects, etc.).

Load is generated by [`tools/client-simulator.ts`](../../tools/client-simulator.ts), which spawns simulated WebSocket clients that authenticate, walk around, and ping the server just like real clients. Simulated clients are the most **expensive** load to drive because the server has to recompute visibility rectangles on every single tile step for every client (per [`SERVER_VISIBILITY_TRACKING.md`](../docs/SERVER_VISIBILITY_TRACKING.md)). The simulator runs until one of the simulated clients gets disconnected by the server — that point marks where the server can no longer sustain all connected clients and serves as the reported capacity.

### Report 1 — multi-threaded worlds, stream-based protobuf send

[`StressTestReport1.html`](../StressTestReport1.html)

- Each game world pinned to a **separate worker thread**
- `enableZeroCopyProtobufTransfer: false` (stream-based protobuf encode)
- **Sustained ~4 000 concurrent clients at ~10 000 req/s**

### Report 2 — single-threaded worlds, zero-copy protobuf send

[`StressTestReport2.html`](../StressTestReport2.html)

- All game worlds pinned to the **same worker thread**
- `enableZeroCopyProtobufTransfer: true` (span-based zero-copy encode)
- **Sustained ~3 500 concurrent clients** until server instability was observed

Both configurations are viable; the numbers illustrate the latency-vs-throughput trade-off exposed by `enableZeroCopyProtobufTransfer` and how much headroom you gain by spreading worlds across cores.

---

## Documentation

In-depth design docs live under [`multiplayer/docs/`](../docs):

| Document | Topic |
|----------|-------|
| [`SERVER_CONFIGURATION.md`](../docs/SERVER_CONFIGURATION.md) | Every field in every config file, validation rules, and defaults |
| [`SERVER_THREADING_AND_PACKET_FLOW.md`](../docs/SERVER_THREADING_AND_PACKET_FLOW.md) | Worker threads, world mailboxes, inbound/outbound packet flow |
| [`SERVER_PERFORMANCE_OPTIMIZATIONS.md`](../docs/SERVER_PERFORMANCE_OPTIMIZATIONS.md) | Allocation avoidance, GC tuning, hot-path patterns |
| [`SERVER_VISIBILITY_TRACKING.md`](../docs/SERVER_VISIBILITY_TRACKING.md) | Per-player "in range" sets, spatial grids, enter/leave broadcasts |
| [`CLIENT_SERVER_SYNC.md`](../docs/CLIENT_SERVER_SYNC.md) | Message catalogue, prediction vs authority, anti-hack guards |
| [`MOVEMENT_SYSTEM.md`](../docs/MOVEMENT_SYSTEM.md) | Grid movement, prediction, reconciliation, course correction |
| [`COMBAT_SYSTEM.md`](../docs/COMBAT_SYSTEM.md) | Melee, bow, ranged, PvP, PvM, MvM, stun/knockback/interrupt |
| [`SPELL_CASTING_SYSTEM.md`](../docs/SPELL_CASTING_SYSTEM.md) | Cast phases, AoE shapes, ground effects, cast-timing guards |
| [`INVENTORY_AND_ITEMS_SYSTEM.md`](../docs/INVENTORY_AND_ITEMS_SYSTEM.md) | Bag/equipment sync, drop/pickup, ground stacks |
| [`SERVER_MONSTER_AI.md`](../docs/SERVER_MONSTER_AI.md) | Monster state machine, chase/wander, allegiance, damage aggro |

For client-side rendering, asset pipeline, sprites, maps, and UI layer, see [`sp-client/README.md`](../../sp-client/README.md) — the multiplayer client shares the same foundations.
