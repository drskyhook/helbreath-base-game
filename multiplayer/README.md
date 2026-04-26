# Multiplayer stack

Authoritative game server (C#) and browser client (Phaser + React) with a shared Protobuf wire format.

| Component | README |
|-----------|--------|
| **Browser client** | [`mp-client/README.md`](./mp-client/README.md) |
| **Game server** | [`server/README.md`](./server/README.md) |

Shared design docs live under [`docs/`](./docs/). Network schemas are in [`proto/`](./proto/).

## Asset loading and ZIP

Both browser clients support **ZIP** vs **per-file** loading (`ENABLE_ZIP_LOADING` in each client’s `Config.ts`) and **`pnpm compress-assets`** (see [`sp-client/README.md` § Asset Loading](../sp-client/README.md#asset-loading) and [`sp-client/docs/ASSET_LOADING.md`](../sp-client/docs/ASSET_LOADING.md)).

When **lazy loading** is enabled for monsters, maps/tiles, and/or player equipment appearance (`LOAD_MONSTER_ASSETS_ON_DEMAND`, `LOAD_MAP_ASSETS_ON_DEMAND`, `LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND`), the asset script **strips** those files from `assets.zip`, so the archive becomes **quite small**. **ZIP bundling is then much less valuable** for shrinking or simplifying the overall download—most bytes are fetched later as individual files. A small zip can still offer a **minor** benefit on CDNs that bill **per HTTP request or per file** (fewer round-trips for whatever remains in the bundle). Many deployments use lazy loading together with **`ENABLE_ZIP_LOADING = false`** and static asset hosting.
