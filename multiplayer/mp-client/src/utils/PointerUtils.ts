import { getObjectsNearPixel, getObjectsAtWorldCell } from './SpatialGrid';
import { convertPixelPosToWorldPos } from './CoordinateUtils';
import { TILE_SIZE } from '../game/assets/HBMap';
import { MonsterAllegiance } from '../Types';
import type { Monster } from '../game/objects/Monster';
import type { NPC } from '../game/objects/NPC';
import type { Player } from '../game/objects/Player';
import type { GroundItem } from '../game/objects/GroundItem';

/**
 * Pointer / hover hit testing in world pixel space (shared by GameWorld input and UI hover polling).
 */
export function getMonsterUnderWorldPixel(
    monsters: Monster[],
    worldPixelX: number,
    worldPixelY: number,
): Monster | undefined {
    const candidates = getObjectsNearPixel(
        monsters,
        (m) => ({ x: m.getAnimatedPixelX(), y: m.getAnimatedPixelY() }),
        worldPixelX,
        worldPixelY,
        10,
    );

    let topMonster: Monster | undefined;
    let topDepth = -Infinity;

    for (const monster of candidates) {
        const bounds = monster.getBounds();
        if (!bounds) {
            continue;
        }

        const inBounds =
            worldPixelX >= bounds.x &&
            worldPixelX <= bounds.x + bounds.width &&
            worldPixelY >= bounds.y &&
            worldPixelY <= bounds.y + bounds.height;

        if (inBounds) {
            const depth = monster.getDepth();
            if (depth > topDepth) {
                topDepth = depth;
                topMonster = monster;
            }
        }
    }
    return topMonster;
}

/** Hover UI: hostile invisible monsters are not shown; friendly invisible remain semi-visible. */
export function getMonsterUnderWorldPixelForHoverUi(
    monsters: Monster[],
    worldPixelX: number,
    worldPixelY: number,
): Monster | undefined {
    const m = getMonsterUnderWorldPixel(monsters, worldPixelX, worldPixelY);
    if (!m || m.isDead()) {
        return undefined;
    }
    if (m.hasInvisibilityBuff() && m.getAllegiance() !== MonsterAllegiance.Friendly) {
        return undefined;
    }
    return m;
}

export function getNpcUnderWorldPixelForHover(
    npcs: NPC[],
    worldPixelX: number,
    worldPixelY: number,
): NPC | undefined {
    const candidates = getObjectsNearPixel(
        npcs.filter((n) => !n.isDead()),
        (n) => ({ x: n.getAnimatedPixelX(), y: n.getAnimatedPixelY() }),
        worldPixelX,
        worldPixelY,
        10,
    );

    let topNpc: NPC | undefined;
    let topDepth = -Infinity;

    for (const npc of candidates) {
        const bounds = npc.getBounds();
        if (!bounds) {
            continue;
        }

        const inBounds =
            worldPixelX >= bounds.x &&
            worldPixelX <= bounds.x + bounds.width &&
            worldPixelY >= bounds.y &&
            worldPixelY <= bounds.y + bounds.height;

        if (inBounds) {
            const depth = npc.getDepth();
            if (depth > topDepth) {
                topDepth = depth;
                topNpc = npc;
            }
        }
    }
    return topNpc;
}

export function getOtherPlayerUnderWorldPixel(
    localPlayer: Player | undefined,
    playersById: Map<string, Player>,
    worldPixelX: number,
    worldPixelY: number,
): Player | undefined {
    const candidates = getObjectsNearPixel(
        Array.from(playersById.values()).filter((player) => player !== localPlayer && !player.isDead()),
        (player) => ({ x: player.getAnimatedPixelX(), y: player.getAnimatedPixelY() }),
        worldPixelX,
        worldPixelY,
        10,
    );

    let topPlayer: Player | undefined;
    let topDepth = -Infinity;
    for (const player of candidates) {
        const bounds = player.getBounds();
        if (!bounds) {
            continue;
        }
        const hitboxX = player.getAnimatedPixelX() - TILE_SIZE / 2;
        const inBounds =
            worldPixelX >= hitboxX &&
            worldPixelX <= hitboxX + TILE_SIZE &&
            worldPixelY >= bounds.y &&
            worldPixelY <= bounds.y + bounds.height;
        if (!inBounds) {
            continue;
        }
        const depth = player.getDepth();
        if (depth > topDepth) {
            topDepth = depth;
            topPlayer = player;
        }
    }

    return topPlayer;
}

/** All players under the cursor (including local) for UI hover. */
export function getPlayerUnderWorldPixelForHover(
    playersById: Map<string, Player>,
    worldPixelX: number,
    worldPixelY: number,
): Player | undefined {
    const candidates = getObjectsNearPixel(
        Array.from(playersById.values()).filter(
            (player) => !player.isDead() && (player.isLocalCharacter() || !player.hasInvisibilityBuff()),
        ),
        (player) => ({ x: player.getAnimatedPixelX(), y: player.getAnimatedPixelY() }),
        worldPixelX,
        worldPixelY,
        10,
    );

    let topPlayer: Player | undefined;
    let topDepth = -Infinity;
    for (const player of candidates) {
        const bounds = player.getBounds();
        if (!bounds) {
            continue;
        }
        const hitboxX = player.getAnimatedPixelX() - TILE_SIZE / 2;
        const inBounds =
            worldPixelX >= hitboxX &&
            worldPixelX <= hitboxX + TILE_SIZE &&
            worldPixelY >= bounds.y &&
            worldPixelY <= bounds.y + bounds.height;
        if (!inBounds) {
            continue;
        }
        const depth = player.getDepth();
        if (depth > topDepth) {
            topDepth = depth;
            topPlayer = player;
        }
    }

    return topPlayer;
}

export function getGroundItemUnderWorldCell(
    groundItems: GroundItem[],
    worldPixelX: number,
    worldPixelY: number,
): GroundItem | undefined {
    const cellX = convertPixelPosToWorldPos(worldPixelX);
    const cellY = convertPixelPosToWorldPos(worldPixelY);

    const candidates = getObjectsAtWorldCell(
        groundItems,
        (g) => ({ worldX: g.worldX, worldY: g.worldY }),
        cellX,
        cellY,
    );

    let topItem: GroundItem | undefined;
    let topDepth = -Infinity;

    for (const g of candidates) {
        const depth = g.getDepth();
        if (depth > topDepth) {
            topDepth = depth;
            topItem = g;
        }
    }
    return topItem;
}

export function getGroundItemUnderPointer(
    groundItems: GroundItem[],
    pointer: { x: number; y: number },
    camera: { scrollX: number; scrollY: number },
): GroundItem | undefined {
    const worldPixelX = pointer.x + camera.scrollX;
    const worldPixelY = pointer.y + camera.scrollY;
    return getGroundItemUnderWorldCell(groundItems, worldPixelX, worldPixelY);
}
