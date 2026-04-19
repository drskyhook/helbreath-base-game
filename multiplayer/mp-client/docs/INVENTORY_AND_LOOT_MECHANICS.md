# Inventory and Loot Mechanics

This guide describes how the inventory system and ground-item rendering work in the mp-client. Inventory remains server-authoritative, and top-most ground items are now mirrored from server `ground_states_*` packets rather than a client-side loot tracker.

---

## Overview

| Component | Location | Purpose |
|-----------|----------|---------|
| **InventoryManager** | `src/utils/InventoryManager.ts` | Mirrors the server-authoritative bag/equipment state locally and sends inventory requests |
| **InventoryDialog** | `src/ui/dialogs/InventoryDialog.tsx` | React UI for viewing/editing inventory; drag-and-drop, equip, consume, drop |
| **NetworkManager** | `src/utils/NetworkManager.ts` | Stores the authoritative in-view ground-state cells received from the server |
| **GroundItem** | `src/game/objects/GroundItem.ts` | Phaser GameAsset that renders a dropped item on the map |

---

## Data Structures

### InventoryItem

```ts
interface InventoryItem {
  itemId: number;       // References Items.ts definition
  itemUid: number;     // Unique per instance (for stacking, drag, etc.)
  bagX?: number;       // Pixel X in bag (undefined = center)
  bagY?: number;       // Pixel Y in bag (undefined = center)
  quantity?: number;   // For stackable items (default 1)
  effectOverrides?: Effect[];  // Per-instance effects (e.g. TINT_INVENTORY)
}
```

### GroundLootItem

```ts
interface GroundLootItem {
  itemId: number;
  itemUid: number;
  quantity: number;
  effectOverrides?: Effect[];
}
```

### Item Types and Equipment Slots

- **ItemTypes**: `WEAPON`, `SHIELD`, `ARMOR`, `HAUBERK`, `LEGGINGS`, `HELMET`, `CAPE`, `BOOTS`, `ACCESSORY`, `NECKLACE`, `RING`, `MISC`
- **Equipment slots**: Single-slot items use their `ItemTypes`; rings use `RING_SLOT_LEFT` and `RING_SLOT_RIGHT`
- **MISC** is not equippable; consumable MISC items can be consumed via double-click or context menu

---

## InventoryManager

**Registry key:** `INVENTORY_MANAGER_KEY` (via `getInventoryManager`)

### State

- `equippedItems`: `Partial<Record<EquipmentSlot, InventoryItem>>` — one item per slot
- `baggedItems`: `InventoryItem[]` — free-form bag with optional `bagX`/`bagY`
- `nextItemUid`: private counter for new items

### Initialization

- Loads from `GameStateManager.getInventoryState()` (persisted in localStorage)
- Emits `EQUIP_ITEM` and `ITEM_ADDED_TO_BAG` for each item so the UI store syncs
- Ensures tinted inventory sprites are emitted for items with `TINT_INVENTORY` effect

### Event Handlers

| Event | Action |
|-------|--------|
| `ITEM_MOVED_TO_BAG` | Move equipped item to bag, or update bag item position |
| `ITEM_EQUIP_REQUESTED` | Equip bag item; unequip conflicting items (blocked slots, gender mismatch) |
| `ITEM_CREATE_REQUESTED` | Add new item to bag (stack if stackable) |
| `ITEM_BAG_ITEM_BROUGHT_TO_FRONT` | Move bag item to end of array (z-order) |
| `ITEM_CONSUMED_REQUESTED` | Consume consumable MISC item (decrement stack or remove) |
| `ITEM_DROP_TO_GROUND_REQUESTED` | Send a drop request to the server; bag changes only when the server confirms them |
| `IN_UI_CHANGE_GENDER` | Unequip items that don't match new gender |

### Equip Logic

- **Rings**: If no `targetSlot`, tries left then right; if both occupied, replaces left
- **Blocked slots**: `blockedItemSlots` on item def (e.g. two-handed weapon blocks shield) — unequips blocked items first
- **Gender**: Items with `gender` must match player gender to equip

### Persistence

- `persistInventory()` calls `GameStateManager.setInventoryState()` and `saveGameState()`
- Invoked after every inventory mutation

---

## InventoryDialog (React UI)

**Store:** `inventoryDialogStore` — syncs with InventoryManager via EventBus

### Layout

- **Equipment slots**: Helmet, Weapon, Armor, Hauberk, Shield, Leggings, Cape, Boots, Accessory, Necklace, Ring Left, Ring Right
- **Bag area**: Free-form drop zone; items can be placed anywhere with `bagX`/`bagY`

### Drag and Drop

- **Drag threshold**: 8px — below this, release cancels drag (enables double-click)
- **Double-click fallback**: 400ms window for synthetic double-click when native `dblclick` doesn't fire
- **Sources**: Equipment slot or bag
- **Targets**: Bag (reposition), equipment slot (equip), or outside dialog (drop to ground)

### Ring Targeting

- When dragging a ring from bag, the closer of left/right slot is highlighted as drop target
- `getCloserRingSlot(clientX, clientY)` uses distance to slot centers

### Context Menu (Right-Click on Bag Item)

- **Equip** — if equippable and gender matches
- **Consume** — if MISC and consumable
- **Drop** — always available

### Hover Overlay

- `InventoryItemHoverOverlay` shows item name, type, quantity, stackable, consumable, effect colors
- Suppressed during context menu
- Debounced `mouseLeave` (50ms) to reduce flicker between overlapping items

### Sprite Display

- Uses `spriteFrameMap` from `appStore` (extracted from Phaser)
- `getItemInventorySpriteKeyWithOverrides()` for TINT_INVENTORY items
- Stackable items show quantity badge
- Bag items use `getBagItemDisplaySize()` with optional `scale` from item def

---

## Server-Authoritative Ground Items

- The server owns dropped-item stacks per world cell.
- The client only renders the current top-most item for each visible cell.
- `NetworkManager` merges `ground_states_entered_range` / `ground_states_left_range` into its in-view ground-state map, and `GameWorld` mirrors that into `GroundItem` sprites.

---

## GroundItem

**Extends:** `GameAsset`

### Rendering

- Uses `item-ground.spr` or `item-pack` (when display-large-items enabled)
- Sprite index from `getDroppedItemSpriteIndex()` (falls back to `itemSpriteIndex` if not set)
- Gender: `itemDef.gender ?? playerGender`
- Tint applied for `TINT_INVENTORY` items
- Position: tile center (`convertWorldPosToPixelPos(worldX/Y) + TILE_SIZE/2`)

### Events

- `IN_UI_CHANGE_GENDER` — update texture if item has no fixed gender
- `IN_UI_TOGGLE_DISPLAY_LARGE_ITEMS` — switch between item-ground and item-pack

### Hover

- `getHoverInfo(mouseX, mouseY)` returns `InventoryItemHoverInfo` for overlay
- `source: 'ground'` distinguishes from bag/equipped hover

---

## Event Flow

### Drop to Ground

1. User drags bag item outside InventoryDialog → `ITEM_DROP_TO_GROUND_REQUESTED`
2. InventoryManager sends the drop request to the server
3. Server removes the bag item, updates the ground stack, and sends `item_removed_from_bag` plus ground-state deltas
4. GameWorld updates the visible `GroundItem` sprite from the authoritative ground-state packet

### Pick Up from Ground

1. User left-clicks own cell → `player.requestPickUp()` (see [INPUT_HANDLING.md](./INPUT_HANDLING.md))
2. Player sends `player_pickup_requested` to start the authoritative pickup animation flow
3. When the animation finishes, `Player` sends the pickup-complete request to the server
4. Server removes the top-most item from the ground stack, adds it to the bag, and reveals the next stack entry if needed
5. GameWorld updates the visible `GroundItem` sprite from the authoritative ground-state packet

### Stackable Items

- **Server add to bag**: If existing bag item has same `itemId`, the server increments `quantity` and sends an updated bag item
- **Consume**: Decrement quantity or remove if 1
- **Drop**: Entire stack dropped as one (quantity preserved in GroundLootItem)

---

## Key Event Names

| Event | Direction | Payload |
|-------|-----------|---------|
| `EQUIP_ITEM` | InventoryManager → UI | `{ itemType, itemId?, itemUid, bagX?, bagY?, effectOverrides? }` |
| `ITEM_MOVED_TO_BAG` | UI → InventoryManager | `{ itemUid, itemType, bagX?, bagY? }` |
| `ITEM_ADDED_TO_BAG` | InventoryManager → UI | `{ item: InventoryItem }` |
| `ITEM_REMOVED_FROM_BAG` | InventoryManager → UI | `{ itemUid }` |
| `ITEM_BAG_POSITION_UPDATED` | InventoryManager → UI | `{ itemUid, bagX, bagY }` |
| `ITEM_QUANTITY_UPDATED` | InventoryManager → UI | `{ itemUid, quantity }` |
| `ITEM_EQUIP_REQUESTED` | UI → InventoryManager | `{ item, itemType, targetSlot? }` |
| `ITEM_CONSUMED_REQUESTED` | UI → InventoryManager | `{ item }` |
| `ITEM_DROP_TO_GROUND_REQUESTED` | UI → InventoryManager | `{ itemUid }` |
| `GROUND_STATES_ENTERED_RANGE_RECEIVED` | NetworkManager → GameWorld | `GroundStateCellEventData[]` |
| `GROUND_STATES_LEFT_RANGE_RECEIVED` | NetworkManager → GameWorld | `GroundStateCellRemovedEventData[]` |

---

## Related Files

- `src/constants/Items.ts` — Item definitions, `getItemById`, sprite helpers, effect merging
- `src/constants/EventNames.ts` — Event name constants
- `src/ui/store/InventoryDialog.store.ts` — TanStack store synced via EventBus
- `src/ui/store/InventoryItemHoverOverlay.store.ts` — Hover overlay state
- `src/game/scenes/GameWorld.ts` — ground-state listeners and `groundItems` sprite array
- `src/utils/GameStateManager.ts` — `getInventoryState()`, `setInventoryState()`
