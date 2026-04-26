import type { Scene } from 'phaser';

import { LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND } from '../Config';
import { AssetType, getItemEquippedAppearanceSpriteNames, getPlayerItemAppearanceAssetData, type AssetData } from '../constants/Assets';
import { ItemTypes, getItemById, type EquipmentSlot, type InventoryItem } from '../constants/Items';
import { Gender } from '../Types';
import { HBSpriteFile } from '../game/assets/HBSprite';

const PREFETCH_EQUIPMENT_SLOTS: EquipmentSlot[] = [
    ItemTypes.WEAPON,
    ItemTypes.SHIELD,
    ItemTypes.ARMOR,
    ItemTypes.HAUBERK,
    ItemTypes.LEGGINGS,
    ItemTypes.BOOTS,
    ItemTypes.HELMET,
    ItemTypes.CAPE,
    ItemTypes.ACCESSORY,
];

const playerItemAppearanceLoadPromises = new Map<string, Promise<void>>();
const playerItemAssetLoadPromises = new Map<string, Promise<void>>();

/** True when equipped item appearance sprites should be fetched lazily. */
export function shouldLoadPlayerItemAppearanceOnDemand(): boolean {
    return LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND;
}

/**
 * True when this basename appears in the item catalog as an equipped appearance and the first
 * sheet texture is not registered yet.
 */
export function isPlayerItemAppearanceLazyEligible(scene: Scene, spriteName: string): boolean {
    return (
        LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND &&
        getItemEquippedAppearanceSpriteNames().has(spriteName) &&
        !scene.textures.exists(`sprite-${spriteName}-0`)
    );
}

/**
 * Gender-resolved equipped appearance basenames for standard gear slots (matches
 * `PlayerAppearanceManager.resolveGearFromEquippedItems`).
 */
export function collectEquippedItemAppearanceSpriteBasenamesForPrefetch(
    equippedItems: Partial<Record<EquipmentSlot, InventoryItem>>,
    gender: Gender,
): string[] {
    const out: string[] = [];
    for (const slot of PREFETCH_EQUIPMENT_SLOTS) {
        const inv = equippedItems[slot];
        if (!inv) {
            continue;
        }
        const def = getItemById(inv.itemId);
        if (!def) {
            continue;
        }
        const basename = gender === Gender.MALE ? def.equippedSpriteMale : def.equippedSpriteFemale;
        if (basename) {
            out.push(basename);
        }
    }
    return [...new Set(out)];
}

/** True when the `.spr` for this gender-resolved equipped sprite basename is registered. */
export function arePlayerItemAppearanceLoaded(scene: Scene, spriteName: string): boolean {
    const asset = getPlayerItemAppearanceAssetData(spriteName);
    return asset.assetType === AssetType.SPRITE && scene.textures.exists(`${asset.key}-0`);
}

/** Fetches and registers one equipped item appearance `.spr` (shared promise per basename). */
export function loadPlayerItemAppearanceOnDemand(scene: Scene, spriteName: string): Promise<void> {
    if (!LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND || arePlayerItemAppearanceLoaded(scene, spriteName)) {
        return Promise.resolve();
    }

    const existing = playerItemAppearanceLoadPromises.get(spriteName);
    if (existing) {
        return existing;
    }

    console.log(`[PlayerItemAppearanceLoader] Starting fetch for '${spriteName}'`);

    const promise = loadPlayerItemAppearanceAssets(scene, spriteName)
        .then(() => {
            console.log(`[PlayerItemAppearanceLoader] Loaded item appearance ${spriteName}`);
        })
        .catch((error) => {
            playerItemAppearanceLoadPromises.delete(spriteName);
            throw error;
        });

    playerItemAppearanceLoadPromises.set(spriteName, promise);
    return promise;
}

async function loadPlayerItemAppearanceAssets(scene: Scene, spriteName: string): Promise<void> {
    const asset = getPlayerItemAppearanceAssetData(spriteName);
    if (asset.assetType !== AssetType.SPRITE) {
        return;
    }
    if (scene.textures.exists(`${asset.key}-0`)) {
        return;
    }

    const startedAt = performance.now();
    await loadAssetOnce(scene, asset);
    console.log(
        `[PlayerItemAppearanceLoader] Registered ${asset.fileName} in ${(performance.now() - startedAt).toFixed(2)}ms`,
    );
}

function loadAssetOnce(scene: Scene, asset: AssetData): Promise<void> {
    if (asset.assetType === AssetType.SPRITE && scene.textures.exists(`${asset.key}-0`)) {
        return Promise.resolve();
    }

    const loadKey = `${asset.assetType}:${asset.key}`;
    const existing = playerItemAssetLoadPromises.get(loadKey);
    if (existing) {
        return existing;
    }

    const promise = fetchAndRegisterPlayerItemSprite(scene, asset);
    playerItemAssetLoadPromises.set(loadKey, promise);
    return promise.catch((error) => {
        playerItemAssetLoadPromises.delete(loadKey);
        throw error;
    });
}

async function fetchAndRegisterPlayerItemSprite(scene: Scene, asset: AssetData): Promise<void> {
    if (!asset.spriteType) {
        throw new Error(`Player item appearance asset ${asset.key} is missing spriteType`);
    }

    const response = await fetch(`assets/sprites/${asset.fileName}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch item appearance ${asset.fileName}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    scene.cache.binary.add(asset.key, arrayBuffer);

    const hbFile = new HBSpriteFile(asset.key, asset.spriteType, asset.exportFramesAsDataUrls || false, asset.tileStartIndex);
    await hbFile.load(scene);
}
