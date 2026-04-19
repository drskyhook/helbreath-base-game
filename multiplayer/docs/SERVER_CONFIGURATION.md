# Server configuration (`Config/`)

These JSON files sit in `multiplayer/server/Config/`. When you start the server, it reads them from its **working folder** (usually the folder you run the server from). You can use uppercase or lowercase in the JSON names; they are treated the same.

**After you change any config, restart the server** so the new values load.

The server checks many values when it starts; invalid numbers or broken references will stop startup with an error. For the exact rules, see `multiplayer/server/Config.cs` (and shared numeric codes in `multiplayer/server/Commons.cs`).

---

## `Settings.json`

One main object that controls the listening port, how often the world updates, chat limits, movement and anti-cheat behaviour, and **default monster stats** when a field is missing in `Monsters.json`.

### Main options

| Setting | What it does |
| --- | --- |
| `port` | Which **network port** the server listens on (allowed range 1–65535). Players connect to this port. |
| `initialMap` | The **world id** new players start in. Must match an `id` from `GameWorlds.json`. If `spawnToRandomMap` is on, a random world is used instead. |
| `logoutTime` | How many **seconds** the logout process takes. The **client enforces this as well**: the player must wait this long before logout finishes. Use it to tune how long someone stays “in the world” during logout. |
| `courseCorrection` | When **on**, if the tile you walk into is blocked, the server tries a **side step** instead of canceling the move. That **lowers the chance of “bumps”**—sudden position resets when movement conflicts with walls or other actors. |
| `spawnInMiddle` | **On:** search for a free spawn starting at the **map center**. **Off:** start from a **random** tile, then search outward for a valid spot. |
| `spawnToRandomMap` | **On:** new players go to a **random** world (if at least one exists). **Off:** use `initialMap`. |
| `chatMessageMaxLength` | Maximum length of a chat message in characters (must be greater than zero). |
| `maxCellsJumpDistance` | How far the **client’s reported position** can differ from the **server’s position** (in map tiles) before the server **forces a snap back**. This allows **a bit of harmless desync** from lag before correcting the player. |
| `maxDroppedItemsInStack` | How many separate item stacks the server remembers on one ground cell (must be greater than zero). Only the newest top entry is shown to players. |
| `enableZeroCopyProtobufTransfer` | **On:** outbound data uses a serialization path that allocates less temporary memory. That **reduces how often memory cleanup runs**; fewer long “pause the whole program” cleanup stops means **more stable ping and responsiveness** for players. Throughput can differ, so treat it as tuning. |
| `maxConsecutiveOutboundSendFailures` | After this many failed sends in a row, the server drops the connection. **0** turns this off. |

### `threads` — worker layout

The server can spread work across several background workers. You usually only change this when tuning performance for many players or worlds.

| Setting | What it does |
| --- | --- |
| `gameWorldWorkers` | How many **worker threads** run game worlds (must be at least 1). Each world can be pinned to a worker in `GameWorlds.json`. |
| `globalWorldWorkerThread` | Optional **worker index** (0, 1, 2, …) for the shared “global” world. If you **omit** it, assignment follows the same round-robin style as unpinned worlds. |

### `radius` — distance in map tiles

Distances are measured in **tiles** from the player, along the grid (like a rectangle around you, not a circle).

| Setting | What it does |
| --- | --- |
| `viewRadiusX`, `viewRadiusY` | How far around the player the server **syncs other entities** (monsters, players, etc.) for what you can “see.” |
| `cameraRadiusX`, `cameraRadiusY` | How far from the player a **spell target** is allowed to be when the client asks to cast (same “box” idea as the view). |

### `timings` — seconds and milliseconds

Some values are in **seconds**, some in **milliseconds**; the table says which.

| Setting | Unit | What it does |
| --- | --- | --- |
| `disconnectTime` | **Seconds** | If someone **disconnects abruptly** (closes the app, loses power, network drop) **before** finishing a proper logout, their character can **stay standing in the world** for this long—**vulnerable** like a normal idle player. Also used as a time limit for connections that never finish setup. |
| `arrowSpeed` | **Pixels per second** | How fast arrows (and similar projectiles) are treated for **travel time** when calculating hits. Must be greater than zero. |
| `blizzardSpellDamageDelayMs` | **Milliseconds** | Extra delay layered onto blizzard-style damage timing. |
| `playerPickupAnimationTime` | **Milliseconds** | How long a pickup action is considered to take. Must be greater than zero. |
| `playerBowAnimationTime` | **Milliseconds** | Bow-related animation timing the server expects. Must be greater than zero. |
| `spawnProtectionTime` | **Seconds** | After you **change game worlds**, you stay **invulnerable** for this long. **0** turns protection off. **Moving, attacking, or casting a spell ends spawn protection early.** |
| `knockbackTimeMs` | **Milliseconds** | How long knockback is considered to last. Must be greater than zero. |
| `antiHackTimingLagFactor` | **0.0–1.0** | Extra **leniency** on top of ping variance for **combat timing checks**. Higher values give more room for **network jitter** so legitimate players are less likely to be flagged; too high weakens those checks. |

### `ping` — keep-alive and timing

| Setting | Unit | What it does |
| --- | --- | --- |
| `timeout` | **Milliseconds** | If the server goes this long **without receiving a ping** from the client, it **disconnects** that client. |
| `interval` | **Milliseconds** | How often the **client is expected to ping** the server (the “heartbeat” spacing). |
| `allowedVariance` | **Milliseconds** | The **maximum ping swing** (jitter) the server **accepts** when applying **anti-cheat timing** rules. |
| `varianceSampleSize` | count | How many recent ping samples are used to estimate that variance (must be greater than zero). |

### `gameWorld` — simulation and message handling

| Setting | Unit | What it does |
| --- | --- | --- |
| `tickInterval` | **Milliseconds** | How often the **game world simulation** runs (logic updates, AI ticks, etc.). Must be greater than zero. |
| `incomingMessagesQueueSize` | count | How many incoming player messages can wait in line **per world** (must be greater than zero). |
| `incomingMessagesBatchSizePerDispatch` | count | How many messages one “batch” can process when a worker wakes up (must be greater than zero). |

### `monsterDefaults` — fallbacks for `Monsters.json`

These apply when a monster entry **does not** set its own value. Any field whose name ends in **`Time`** is measured in **milliseconds**. **`attackSpeed`** is also in **milliseconds** (length of one full swing), even though the name does not end in `Time`.

| Setting | What it does |
| --- | --- |
| `chaseDistance` | How close a player must be (in tiles, “king’s move” distance) before the monster **starts chasing**. |
| `chaseMaxDistance` | How far the monster will **keep following** before giving up. **Omit** here and in the monster row if you want **no default cap** from settings. |
| `attackSpeed` | Length of a full attack swing in **milliseconds** (must be greater than zero). |
| `attackDamageMin`, `attackDamageMax` | Lowest and highest damage for a normal hit (random roll between them). |
| `attackRecoveryTime` | **Milliseconds** of **pause after an attack** before the monster can attack again (the gap between swings). |
| `minIdleTime`, `maxIdleTime` | **Milliseconds** the AI waits between wander steps when idle (minimum and maximum). |
| `hp` | Hit points (must be greater than zero). |
| `corpseDecayTime` | **Milliseconds** before a corpse disappears. |
| `respawnTime` | **Milliseconds** after a dwell monster dies before a **replacement** can spawn (for world spawners). |

### `movementSpeedViolationsChecker` — anti-speeding

This block configures one of the **anti-cheat guards** that catches players who move **faster than their allowed speed** (edited clients or extreme abuse). If someone triggers it too often in a short window, they get **briefly frozen** as a penalty.

| Setting | What it does |
| --- | --- |
| `verbose` | **On:** print extra messages to the server console when violations happen. |
| `limit` | How many “too fast” moves are allowed inside the time window before punishment (must be greater than zero). |
| `window` | Length of that window in **seconds** (must be greater than zero). |
| `segmentsPerWindow` | Internal slicing of the window for counting (must be greater than zero). |
| `paralysisDuration` | How long the **forced stand-still** lasts, in **seconds**. |
| `maxPingVariance` | Upper cap on ping jitter used in related timing checks (non-negative). |

### `debug`

| Setting | What it does |
| --- | --- |
| `enableGcLogs` | **On:** log extra information about memory cleanup (garbage collection). |
| `profileMonstersAILoop` | **On:** periodically log how long monster AI is taking (useful when tuning performance). |

---

## `Monsters.json`

A **list** of monster **templates** (species). The server uses them for world population, summon lists, and sending the monster directory to clients.

**Important:** Monster `id` values must run **0, 1, 2, … up to n−1** with **no gaps** and **no duplicates**, where *n* is how many entries you have.

| Field | What it does |
| --- | --- |
| `id` | Stable number used in `GameWorlds.json` and elsewhere. |
| `name` | Display name (required, non-empty). |
| `sprite` | Which art set the **client** shows (required). |
| `movementSpeed` | Milliseconds per step; **0** means the creature does not walk. Lower number = faster steps. |
| `chaseDistance` | Optional: tiles at which it **notices** a target (defaults from `monsterDefaults`). |
| `chaseMaxDistance` | Optional: how far it will **follow** (defaults may apply; can be “no cap”). |
| `attackRange` | Optional: reach in tiles (default 1). |
| `attackSpeed` | Optional: full swing time in **milliseconds**. |
| `attackDamageMin`, `attackDamageMax` | Optional: damage range (defaults from `monsterDefaults`). |
| `attackRecoveryTime` | Optional: **pause between attacks** in **milliseconds**—the gap after a swing before the next one can start. |
| `minIdleTime`, `maxIdleTime` | Optional: wander/idle delays in **milliseconds**. |
| `attackType` | Optional: **0** hit without forced flinch, **1** flinch/interrupt, **2** stun, **3** knockback. |
| `allegiance` | Optional: **0** hostile (attacks on sight), **1** neutral (fights back if hit), **2** friendly—**does not attack players**, but **will attack other monsters** (typically hostile ones). Default is hostile. |
| `attackStunDuration` | Optional: stun length in ms when using stun mode. |
| `rangedAttack` | Optional: **true** means ranged attacks use arrow-style timing and visuals. |
| `hp`, `corpseDecayTime`, `respawnTime` | Optional: health, corpse time, respawn delay (times in **ms** where applicable). |

### Optional `spells` on a monster

Each row:

| Field | What it does |
| --- | --- |
| `spellId` | Must match an entry in `Spells.json`. |
| `castProbability` | A number from **0 to 1**: chance each AI tick to try that spell. |

Monster spells must be **damage** spells with a `damageType` set. **Ground-effect** spells and **buff-only** spells are not allowed here.

---

## `NPCs.json`

A simple **directory** of NPCs (names for shops, summon UI, etc.). The client picks sprites from its own data using these ids.

**Same id rule as monsters:** ids must be **0 … n−1** with no gaps or duplicates.

| Field | What it does |
| --- | --- |
| `id` | Number used in `GameWorlds.json` when placing an NPC. |
| `name` | Display name (required). |

---

## `GameWorlds.json`

Each entry is one **playable world** (a map instance players can enter). The `id` string is what you put in `Settings.json` `initialMap` and in teleport targets.

| Field | What it does |
| --- | --- |
| `id` | Unique world key (no two worlds may share it). |
| `name` | Label players might see. |
| `map` | Which map file to load from `Config/maps/` (and related assets). |
| `music` | Optional music filename sent to the client. |
| `workerThread` | Optional: which **worker thread index** runs this world. If omitted, worlds are spread automatically. |
| `teleportLocs` | Optional: tiles that **teleport** you to another world (see below). |
| `dwellAreas` | Optional: where to **spawn wandering monsters** (see below). |
| `npcs` | Optional: fixed **NPC positions** (see below). |

### `teleportLocs`

Each block lists **source tiles** (`locs`) that trigger a jump, and a **target** world id plus **x,y** on that map. The destination world must exist in this file.

### `dwellAreas`

Each row picks a **monster id** from `Monsters.json`, a **count**, and an optional **rectangle** `x1,y1,x2,y2`. If you omit the rectangle, the whole map is used. Corner order does not matter; the server uses the smallest box that contains both corners.

### `npcs`

Each row: **npcId** (from `NPCs.json`), **x,y** on the map, and **direction** 0–7 (which way the NPC faces). Two NPCs cannot share the same tile. NPCs cannot stand on a teleport source tile.

---

## `Items.json`

Defines items the server knows about (names, types, stacking, gender locks, visual effects). **Ids must be unique** but **do not** need to be consecutive.

| Field | What it does |
| --- | --- |
| `id` | Stable item number (should match the client item art registry). |
| `name` | Display name. |
| `itemType` | Category string such as `weapon`, `shield`, `armor`, `misc`, etc. The server only checks it is non-empty; the client decides icons and UI rules. |
| `blockedItemSlots` | Optional list of slots this item **conflicts** with (for example a two-hander blocking a shield). |
| `stackable` | Optional: whether stacks combine in bags/ground rules. |
| `consumable` | Optional: whether the item can be “used up.” |
| `effects` | Optional visual flair rows (see below). |
| `weaponType` | Optional: **0** melee, **1** bow. |
| `gender` | Optional: **0** male only, **1** female only. |

### `effects` rows

| Field | What it does |
| --- | --- |
| `effect` | Visual effect type index: **0** storm bringer, **1** star twinkle, **2** glare, **3** glow, **4** tint inventory, **5** tint appearance. |
| `effectColor` | Optional packed color number for tinting (the client draws it). |

---

## `Spells.json`

Defines spells for players and (where allowed) monsters. **Spell ids must be unique.**

### Damage shape (`damageType`)

If you **omit** `damageType`, the spell is treated as **buff-only** and must use `temporaryEffects` (for example invisibility).

Otherwise:

| Value | Meaning in simple terms |
| --- | --- |
| **0** | Area damage in a **rectangle** toward a target (classic “line” mage shot). |
| **1** | **Cone** or spreading pattern (blizzard-style fields use extra fields like `emissionSteps`). |
| **2** | **Line** that stays on the ground for a while (`duration` matters). |
| **3** | Single **tile** hit (no area radius). |
| **4** | **Ground effect** that sits on tiles (fire field, poison cloud, etc.). |

### Other common fields

| Field | What it does |
| --- | --- |
| `attackType` | How the hit behaves: **0** damage without forced flinch, **1** flinch/interrupt, **2** stun, **3** knockback (defaults to interrupt-style if omitted). |
| `aoeRadius` | Size of the effect in tiles where relevant. Not used for single-tile or pure buff spells. |
| `group` | For ground effects: which “family” the effect belongs to (fire, poison, spikes, ice storm) for stacking rules. |
| `tickRate` | For ground effects: how often periodic damage ticks, in **milliseconds**. If omitted, damage happens when someone **steps on** the tile. |
| `projectileSpeed` | How fast a projectile travels for timing (when used). |
| `projectileDistance` | Optional fixed travel distance for some rectangle spells (used with `projectileSpeed`). |
| `emissionSteps`, `startRadius`, `endRadius`, `startShards`, `endShards` | Used together for **cone** blizzard-style spells. |
| `duration` | Depends on spell type: line effects, ground lifetime, or short knockback windows—all in **milliseconds** where applicable. |
| `aimAssist` | **true** allows the client to help aim at a creature (lightning, some buffs). |
| `temporaryEffects` | Buffs or on-hit slows; each row has a **type** (0 invisibility, 1 chill, 2 berserk), a **group**, **duration** in ms, and optional speed multipliers within allowed bounds. |

**Note:** Combining damage with `temporaryEffects` is restricted: on-hit rows are mainly for **chill**-style debuffs; **invisibility** cannot be mixed onto damage spells in the validator.

---

## Cross-reference checklist

- `initialMap` and teleport `worldId` values must match a `GameWorlds.json` `id`.
- `dwellAreas.monsterId` must exist in `Monsters.json`.
- `npcs.npcId` must exist in `NPCs.json`.
- Monster `spells.spellId` must exist in `Spells.json` and follow monster spell rules.
- Each `map` name should have matching map data under `Config/maps/`.

For worker queues, batch sizes, and profiling, see `SERVER_PERFORMANCE_OPTIMIZATIONS.md`.
