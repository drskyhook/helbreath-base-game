---
name: server-performance-implementation
description: Implement or update `multiplayer/server/**` code with performance and scalability in mind for this repo. Use when adding server-side features, changing movement or visibility logic, editing websocket receive/send flow, modifying `GameWorld` update paths, or when the user asks about server performance, hot paths, client-count scaling, or reducing avoidable allocations.
---

# Server Performance Implementation

Use this skill when working in `multiplayer/server/**` and the change could affect throughput, latency, or max concurrent clients.

## Follow These Rules First

Before editing server code, follow:

- `multiplayer/.cursor/rules/common-guidlines.mdc`
- `multiplayer/.cursor/rules/server-csharp-guidelines.mdc`
- `multiplayer/.cursor/rules/server-threading-and-packet-flow.mdc`
- `multiplayer/docs/SERVER_THREADING_AND_PACKET_FLOW.md` (threading, routing, ownership)
- `multiplayer/docs/SERVER_PERFORMANCE_OPTIMIZATIONS.md` (latency, throughput, GC, hot-path allocation patterns)

## Start Here

Inspect the relevant hot path first. Most server-side work in this repo flows through:

- `multiplayer/server/Server.cs`
- `multiplayer/server/World/Game/GameWorld.cs`
- `multiplayer/server/World/Game/GameWorldPlayer.cs`
- `multiplayer/server/World/WorldWorker.cs`
- `multiplayer/server/Helpers/` (movement, spawn, ping orchestration)
- `multiplayer/server/Helpers/PlayerPingTracker.cs` (ping sample / variance)
- `multiplayer/server/Utils/GameWorldOccupancyTracker.cs`
- `multiplayer/server/Utils/`

If the change touches movement, also inspect:

- nearby-player lookups
- occupancy/collision checks
- outbound fanout
- receive/send buffer usage

## Core Principles

- Prefer algorithmic improvements over micro-optimizations.
- Keep `Server.cs` as the network edge; keep gameplay state and mutable map logic in `GameWorld` or world-owned types.
- Preserve actor-style ownership. Do not add locks around world state when single-threaded world ownership already solves it.
- Optimize for the hot path: movement, visibility updates, packet routing, serialization, and per-tick work.
- Avoid repeated full-world scans when local queries or indexes are possible.
- Avoid avoidable per-message and per-player allocations in hot paths.
- Reuse buffers and payloads where safe.
- Keep behavior unchanged unless the user asked for a rules or design change.

## Struct-based shapes in hot paths (heap pressure)

For the full rationale on **low latency**, **high throughput**, **scratch buffers**, **LINQ avoidance**, and **GC / STW pauses**, read `multiplayer/docs/SERVER_PERFORMANCE_OPTIMIZATIONS.md`.

When you own the API surface for a tight loop (nearby queries, per-tick scans, fanout helpers), prefer **struct-backed iteration and lightweight value types** if profiling shows heap churn or unnecessary indirection. In this repo, `multiplayer/server/Utils/SpatialGrid.cs` is the reference: `readonly struct` enumerables with `struct` enumerators so `foreach` avoids allocating a boxed `IEnumerator`, and comments call out cases like `HashSet<T>.Enumerator` already being a struct.

**Do not assume structs are always mandatory.** The .NET 10 runtime continues to narrow the gap between idiomatic C# and hand-tuned code: the JIT has expanded **escape analysis** and **stack allocation** for short-lived objects, and documents better **de-abstraction** for some enumerator patterns (for example, reduced overhead when enumerating arrays through abstraction layers). See [What's new in the .NET 10 runtime](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime) (stack allocation, escape analysis, array enumeration) and the [.NET 10 performance post](https://devblogs.microsoft.com/dotnet/performance-improvements-in-net-10/) for the intended behavior.

**Practical rule:** use struct enumerators / small readonly structs where the hot path is proven allocation-bound or you need a stable, explicit zero-allocation contract; skip the extra API surface if measurements show the current JIT already elides the heap cost for that callsite. Re-check after SDK upgrades—JIT heuristics change.

## Preferred Optimization Order

When looking for meaningful wins, check in this order:

1. `O(total players)` work inside movement, visibility, or tick paths
2. repeated lookups that should be indexed
3. repeated serialization or payload rebuilding for identical broadcasts
4. avoidable allocations on receive/send or update loops
5. data structures that do not match bounded-grid or local-query workloads
6. worker-count or scheduling bottlenecks across multiple worlds

## Common Good Fits In This Repo

- Spatial indexes for nearby-player queries instead of scanning all players
- direct lookup maps for ids used in hot paths
- flat arrays / bitsets for fixed-size map occupancy
- moving protobuf serialization out of the world thread when possible
- buffer reuse on websocket receive/send paths
- batching or payload reuse for broadcast-heavy flows

## Concrete optimization examples (this codebase)

Narrative and trade-offs (including **`enableZeroCopyProtobufTransfer`** and **GC latency mode**): `multiplayer/docs/SERVER_PERFORMANCE_OPTIMIZATIONS.md`.

Use these as reference when touching the same hot paths:

| Area | Pattern | Where |
|------|---------|--------|
| GC latency vs throughput | `GCSettings.LatencyMode = GCLatencyMode.SustainedLowLatency` at process start | `multiplayer/server/Server.cs` |
| WebSocket receive | `ArrayPool<byte>` for the frame read buffer; `messageScratch` only when reassembling fragmented binary messages | `multiplayer/server/Server.cs` |
| WebSocket send | `CalculateSize()` + `ArrayPool<byte>.Shared.Rent`, serialize, `SendAsync` only the first `payloadSize` bytes, return buffer in `finally`; optional span-based encode when `enableZeroCopyProtobufTransfer` is true | `multiplayer/server/Server.cs` (`SendOutgoingMessagesAsync`), `multiplayer/server/Config/Settings.json` |
| Protobuf + pooled send buffer | Do **not** call `CodedOutputStream.CheckNoSpaceLeft()` when the coder wraps a `Stream` (throws). After `Flush()`, assert `MemoryStream.Position == CalculateSize()` instead | `multiplayer/server/Server.cs` |
| Nearby players by id | One `Dictionary<long, GameWorldPlayer>` per world (`NearbyPlayersByIdScratch` on `GameWorldRef`), cleared and refilled via `Movement.FillNearbyPlayersById` | `multiplayer/server/World/Game/GameWorld.cs`, `multiplayer/server/Helpers/Movement.cs`, `multiplayer/server/Helpers/Spawn.cs` |
| Visibility after movement | One `HashSet<long>` per world (`PlayersPreviouslyInRangeScratch`), `Clear` + `UnionWith` instead of `new HashSet<long>(...)` each move | `multiplayer/server/World/Game/GameWorld.cs`, `multiplayer/server/Helpers/Movement.cs` |
| Ping variance | Ring buffer of absolute ping-interval deltas; `CopyChronologicalSamples` into a scratch `long[]`, then take the **maximum** as the spread statistic | `multiplayer/server/Helpers/PlayerPingTracker.cs`, `multiplayer/server/Utils/RingBuffer.cs` |
| Worker tick list | Reuse `List<IWorkerWorld>` (`worldsTickScratch`): `Clear` + `AddRange(worlds)` under lock instead of `worlds.ToArray()` every tick | `multiplayer/server/World/WorldWorker.cs` |
| Broadcast payload reuse | Build once, send the same `ServerMessage` instance to many recipients when contents are identical (e.g. worlds list on connect) | `multiplayer/server/Server.cs`, `multiplayer/server/Utils/NetworkManager.cs` |
| Spatial queries | `readonly struct` enumerables + `struct` enumerators so `foreach` over grid queries does not allocate iterators; document when underlying enumerator is already a struct | `multiplayer/server/Utils/SpatialGrid.cs` (`PlayersSpatialGrid`, `SpatialGrid<T>.RectangleEnumerable`) |

**Ownership:** Scratch containers (`NearbyPlayersByIdScratch`, `PlayersPreviouslyInRangeScratch`, `worldsTickScratch`) are safe because each `GameWorld` / worker thread mutates them from a single thread at a time—do not share one scratch across worlds or threads without a new ownership story.

## Common Bad Fits

- adding locks inside `GameWorld`
- moving gameplay branching into `Server.cs`
- replacing simple code with complex abstractions for negligible gain
- introducing caching without a clear invalidation story
- changing multiple architecture layers when one local hot-path fix is enough

## Workflow

### 1. Identify the hot path

Find the per-client or per-tick path that will scale with player count.

Questions to answer:

- Is this path called on every movement request?
- Does this path run for every nearby player?
- Does this path allocate on every packet?
- Does this path scan all players in a world?

### 2. Choose the narrowest high-impact fix

Prefer one of:

- better indexing
- better data structure choice
- moving work off the world hot path
- buffer or payload reuse

Avoid speculative refactors.

### 3. Keep ownership boundaries intact

- `Server.cs`: socket lifetime, frame reads, parse, route, per-connection send loop
- `GameWorld`: world-owned mutable state and gameplay logic
- `WorldWorker`: scheduling and ticking

If a performance change crosses these boundaries, check that ownership is still clear.

### 4. Validate correctness under load-shaped behavior

After the change, confirm:

- connect / disconnect still update world state correctly
- movement correction and rollback paths still keep state in sync
- visibility updates still match the authoritative world position
- send and receive loops still handle fragmented websocket messages

## Review Checklist

- [ ] No new `O(total players)` scan was added to movement or visibility logic
- [ ] Lookups used in hot paths are indexed when practical
- [ ] No avoidable per-message allocation was introduced
- [ ] World- or worker-owned scratch buffers/lists are not shared across threads without a clear contract
- [ ] Protobuf send-path changes do not use `CheckNoSpaceLeft()` on stream-backed `CodedOutputStream`
- [ ] World-state ownership still matches `multiplayer/docs/SERVER_THREADING_AND_PACKET_FLOW.md`
- [ ] Performance-sensitive changes align with `multiplayer/docs/SERVER_PERFORMANCE_OPTIMIZATIONS.md` (hot-path allocations, scratch ownership, send-path invariants)
- [ ] `Server.cs` did not absorb gameplay logic
- [ ] Data structure choice matches the workload
- [ ] If adding struct-based enumerators or similar, the win is justified by profiling or a clear allocation contract (see **Struct-based shapes in hot paths**); not duplicated work the .NET 10 JIT already optimizes for the same pattern
- [ ] Verification was run after edits

## Validation

For substantive server-side performance changes:

1. Run `dotnet build` in `multiplayer/server/`
2. Check lints for edited files
3. In the final response, briefly note what hot path was improved and what kind of work was removed

## Example Triggers

Use this skill when the user asks for things like:

- "make the server handle more clients"
- "optimize movement handling"
- "improve websocket performance"
- "reduce server allocations"
- "speed up nearby-player lookups"
- "review server-side performance"
