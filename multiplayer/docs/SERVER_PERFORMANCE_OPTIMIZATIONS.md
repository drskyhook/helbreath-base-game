# Server performance optimizations

This document explains **why** the multiplayer server is structured for **low tail latency** and **high throughput**, with emphasis on **reducing allocations in hot paths** so the garbage collector runs less often and **stop-the-world (STW) pauses** stay rare and short.

For **thread ownership and where packets flow**, see [SERVER_THREADING_AND_PACKET_FLOW.md](./SERVER_THREADING_AND_PACKET_FLOW.md).

## Goals

- **Latency:** smooth world ticks, predictable outbound sends, minimal GC-induced stalls on worker threads and WebSocket loops.
- **Throughput:** scale to many concurrent connections without turning movement, visibility, or send paths into `O(total players)` work.
- **GC pressure:** prefer **reuse**, **value-type iteration**, and **explicit scratch buffers** over per-operation heap churn; avoid **LINQ** and **allocating enumerables** on paths that run every message, movement, or tick.

## Runtime and GC behavior

At startup, `Server.cs` sets `GCSettings.LatencyMode = GCLatencyMode.SustainedLowLatency`. That asks the runtime to favor **shorter blocking GC pauses** over maximizing throughput for background collection—aligned with an interactive server where occasional work deferral is preferable to long STW interruptions.

This does not remove the need to **allocate less** in hot code: sustained allocation rates still drive **Gen0** collections; heavier promotion can still trigger **Gen2** pauses. The main levers here are **application-side** (buffers, scratch collections, data structures). Optional `debug.enableGcLogs` in `Config/Settings.json` enables `GarbageCollectorMonitor`, which logs GC events for profiling.

## Network edge: `Server.cs`

### Inbound WebSockets

Each connection rents two byte buffers from `ArrayPool<byte>.Shared`:

- **`receiveBuffer`** — primary frame read buffer.
- **`messageScratch`** — only used when a protobuf message spans multiple WebSocket frames; single-frame messages use a slice of `receiveBuffer` without copying.

That avoids **per-message `new byte[]`** on the read path while capping assembled message size (`MaxIncomingWebSocketMessageBytes`) to bound memory.

### Outbound protobuf and `enableZeroCopyProtobufTransfer`

Outbound messages are serialized into a **rented** byte array sized with `IMessage.CalculateSize()`, then sent; the buffer is **returned to the pool** in a `finally` block.

`Config/Settings.json` exposes **`enableZeroCopyProtobufTransfer`** (`Settings.EnableZeroCopyProtobufTransfer` in `Config.cs`):

- **`true`:** encode with **span-based** `WriteTo(Span<byte>)` on the rented buffer. This path tends to produce **less garbage** than wrapping a `MemoryStream` and `CodedOutputStream`, which helps **latency** when GC would otherwise bite; benchmarks in-repo showed **slightly lower throughput** than the stream path.
- **`false`:** encode via **`MemoryStream` over the rented array** + **`CodedOutputStream`**. Comments in `SendOutgoingMessagesAsync` note **higher Gen0 churn** and occasional large-generation pauses under stress, but **somewhat higher throughput** in stress tests.

Choose based on whether you optimize for **raw send throughput** or **tail latency / GC stability**. The send path also avoids `CodedOutputStream.CheckNoSpaceLeft()` when writing to a stream (that API can throw in this configuration); length is validated by comparing `MemoryStream.Position` to `CalculateSize()` after `Flush()`.

### Other edge patterns

- **Broadcast reuse:** e.g. the worlds list (`NetworkManager.CreateWorldsList`) and monsters list messages are built **once at startup** and **reused** for every connecting client instead of rebuilding identical protobuf trees per connection.
- **Per-connection send queue:** `Channel<ServerMessage>` with a **single-reader** outbound loop serializes under a **send lock**, keeping the model simple without allocating per-send wrapper types beyond the message itself.

## Game world hot paths: scratch containers

`GameWorld` owns many **`private readonly` dictionaries, hash sets, and lists** exposed to helpers via `GameWorldRef` as **scratch** fields (names like `NearbyPlayersByIdScratch`, `PlayersPreviouslyInRangeScratch`, `MovementNewNeighborsScratch`, etc.).

**Pattern:**

- **Clear and refill** the same instances instead of **`new` per movement or visibility pass**.
- **Visibility diffs** use `HashSet.Clear` + `UnionWith(existingSnapshot)` rather than allocating a new `HashSet` each time (see NPC/monster/player visibility helpers).

These containers are **single-threaded per world** (mailbox + tick on the owning worker); they must **not** be shared across threads or held across `await` without a documented ownership change—see comments on `GameWorld` and [SERVER_THREADING_AND_PACKET_FLOW.md](./SERVER_THREADING_AND_PACKET_FLOW.md).

## Spatial queries: struct enumerators

`PlayersSpatialGrid` and `SpatialGrid<T>` expose **`readonly struct` query types** with **`struct` enumerators** so a `foreach` over nearby players **does not allocate** a boxed `IEnumerator` on the heap. The implementation documents that `HashSet<T>.Enumerator` is already a struct when you enumerate a hash set directly—same idea: **prefer enumeration shapes that stay on the stack**.

## Worker scheduling: `WorldWorker`

`WorldWorker` keeps a **`worldsTickScratch` list**: under lock it **`Clear`s** and **`AddRange(worlds)`** instead of **`worlds.ToArray()`** every tick. That avoids a **fresh array allocation per tick** per worker when iterating worlds for `Update`.

## Ping variance: ring buffer + stack-friendly scan

`PlayerPingTracker` stores deltas in a **`RingBuffer<long>`** and copies chronological samples into a **reusable `long[]` (`varianceScratch`)** to compute the spread statistic with a simple **for** loop max—avoiding LINQ and repeated **intermediate allocations**.

## Map occupancy: flat arrays

`GameWorldOccupancyTracker` uses **row-major `bool[]`** for occupied and teleport cells. Queries and updates are **index arithmetic** on fixed arrays—good cache locality and **no per-cell object graph** for “is this tile blocked?”.

## Principles for new code

1. **Hot path first:** movement, visibility fanout, mailbox dispatch, serialization, per-tick AI—profile or reason about allocations here.
2. **Prefer reuse over allocate-then-drop:** scratch lists/maps, `ArrayPool` for byte buffers, prebuilt static wire messages where content is identical.
3. **Avoid LINQ and lazy enumerables** in tight loops; prefer **for/foreach** over concrete collections or **stack-only struct iterators**.
4. **Struct iterators are not free complexity**—the .NET JIT continues to improve escape analysis and some patterns; add **struct enumerators** when you need a clear **zero-allocation contract** or profiling shows iterator boxing/allocation. Re-measure after SDK upgrades.
5. **Algorithm beats micro-opts:** spatial grids and local queries beat scanning **every** player; see `SERVER_THREADING_AND_PACKET_FLOW.md` for why world threading already avoids lock contention on gameplay state.

## Quick reference: where to look in code

| Concern | Location |
|--------|----------|
| GC latency mode, WebSocket buffers, zero-copy send flag | `server/Server.cs` |
| `enableZeroCopyProtobufTransfer` default / docs | `server/Config.cs`, `server/Config/Settings.json` |
| Scratch fields for movement / visibility / spells / ground state | `server/World/Game/GameWorld.cs`, `server/Helpers/Movement.cs`, `GroundStateVisibility.cs`, `Npc.cs`, … |
| Struct spatial iteration | `server/Utils/SpatialGrid.cs`, `PlayersSpatialGrid` in same file |
| Tick list reuse | `server/World/WorldWorker.cs` (`worldsTickScratch`) |
| Ping variance scratch array | `server/Helpers/PlayerPingTracker.cs`, `server/Utils/RingBuffer.cs` |
| Occupancy bitmask-style storage | `server/Utils/GameWorldOccupancyTracker.cs` |
| Optional GC event logging | `server/Utils/GarbageCollectorMonitor.cs` |
