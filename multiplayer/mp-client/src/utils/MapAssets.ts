import type { Scene } from 'phaser';

import { LOAD_MAP_ASSETS_ON_DEMAND } from '../Config';
import { ASSETS, AssetType, type AssetData } from '../constants/Assets';
import { HBSpriteFile } from '../game/assets/HBSprite';
import { HBMap } from '../game/assets/HBMap';
import { setMap } from './RegistryUtils';
import { isTreeSpriteIndex } from './SpriteUtils';

const tilePackLoadPromisesByScene = new WeakMap<Scene, Map<string, Promise<void>>>();
const tilePackShutdownHookRegistered = new WeakSet<Scene>();

function getTilePackPromises(scene: Scene): Map<string, Promise<void>> {
    let m = tilePackLoadPromisesByScene.get(scene);
    if (!m) {
        m = new Map();
        tilePackLoadPromisesByScene.set(scene, m);
    }
    if (!tilePackShutdownHookRegistered.has(scene)) {
        tilePackShutdownHookRegistered.add(scene);
        scene.events.once('shutdown', () => {
            m!.clear();
            tilePackShutdownHookRegistered.delete(scene);
        });
    }
    return m;
}

/** True when map `.amd` and tile `.spr` packs load lazily at GameWorld start. */
export function shouldLoadMapAssetsOnDemand(): boolean {
    return LOAD_MAP_ASSETS_ON_DEMAND;
}

function getMapAssetByFileName(mapFileName: string): AssetData {
    const asset = ASSETS.find(
        (a) => a.assetType === AssetType.MAP && a.fileName === mapFileName,
    );
    if (!asset) {
        throw new Error(`[MapAssets] Unknown map file: ${mapFileName}`);
    }
    return asset;
}

const sortedTileSpriteAssets: AssetData[] = ASSETS.filter(
    (a) => a.assetType === AssetType.TILE_SPRITE,
).sort((a, b) => (a.tileStartIndex ?? 0) - (b.tileStartIndex ?? 0));

function getTileSpriteAssetForIndex(index: number): AssetData {
    let chosen: AssetData | undefined;
    for (const a of sortedTileSpriteAssets) {
        const start = a.tileStartIndex ?? 0;
        if (start <= index) {
            chosen = a;
        } else {
            break;
        }
    }
    if (!chosen) {
        throw new Error(`[MapAssets] No tile sprite pack covers global tile index ${index}`);
    }
    return chosen;
}

/**
 * Ground and map-object sprite indices referenced by the parsed map, plus derived indices.
 * Tree shadows use `map-tile-(treeIndex + 50)` (see {@link GameAsset.applyShadowIfTree}); those
 * textures are not stored in the .amd and must be pulled in with `treeshadows.spr` (see GameAsset tree shadow).
 */
export function collectRequiredTileIndices(hbMap: HBMap): Set<number> {
    const indices = new Set<number>();
    for (let y = 0; y < hbMap.sizeY; y++) {
        for (let x = 0; x < hbMap.sizeX; x++) {
            const tile = hbMap.tiles[y][x];
            if (tile.sprite >= 0) {
                indices.add(tile.sprite);
            }
            if (tile.objectSprite > 0) {
                indices.add(tile.objectSprite);
            }
        }
    }
    for (const idx of indices) {
        if (isTreeSpriteIndex(idx)) {
            indices.add(idx + 50);
        }
    }
    return indices;
}

export function resolveTileSpriteAssets(indices: Set<number>): AssetData[] {
    const byKey = new Map<string, AssetData>();
    for (const idx of indices) {
        const asset = getTileSpriteAssetForIndex(idx);
        byKey.set(asset.key, asset);
    }
    return [...byKey.values()];
}

async function loadTileSpritePackOnce(scene: Scene, asset: AssetData): Promise<void> {
    const promises = getTilePackPromises(scene);
    const existing = promises.get(asset.key);
    if (existing) {
        return existing;
    }

    const start = asset.tileStartIndex ?? 0;
    if (scene.textures.exists(`map-tile-${start}`)) {
        return Promise.resolve();
    }

    const promise = (async () => {
        if (!asset.spriteType) {
            throw new Error(`[MapAssets] Tile asset ${asset.key} is missing spriteType`);
        }
        const response = await fetch(`assets/sprites/${asset.fileName}`);
        if (!response.ok) {
            throw new Error(
                `[MapAssets] Failed to fetch tile sprite ${asset.fileName}: ${response.status} ${response.statusText}`,
            );
        }
        const arrayBuffer = await response.arrayBuffer();
        scene.cache.binary.add(asset.key, arrayBuffer);
        const hbFile = new HBSpriteFile(
            asset.key,
            asset.spriteType,
            asset.exportFramesAsDataUrls || false,
            asset.tileStartIndex,
        );
        await hbFile.load(scene);
    })().catch((error) => {
        promises.delete(asset.key);
        throw error;
    });

    promises.set(asset.key, promise);
    return promise;
}

/**
 * Fetches the map binary, parses it, loads only required tile `.spr` packs, and registers the map on the scene.
 */
export async function prepareMapForGameWorld(scene: Scene, mapFileName: string): Promise<HBMap> {
    const startedAt = performance.now();
    const mapAsset = getMapAssetByFileName(mapFileName);
    const mapKey = mapAsset.key;

    const response = await fetch(`assets/maps/${mapFileName}`);
    if (!response.ok) {
        throw new Error(
            `[MapAssets] Failed to fetch map ${mapFileName}: ${response.status} ${response.statusText}`,
        );
    }
    const buffer = await response.arrayBuffer();

    const map = new HBMap(mapKey);
    map.loadFromBuffer(buffer);

    const tileAssets = resolveTileSpriteAssets(collectRequiredTileIndices(map));
    await Promise.all(tileAssets.map((a) => loadTileSpritePackOnce(scene, a)));

    setMap(scene, mapKey, map);
    const elapsedMs = performance.now() - startedAt;
    console.log(
        `[MapAssets] On-demand map ready: ${mapFileName} (${tileAssets.length} tile pack(s), ${map.sizeX}x${map.sizeY}) in ${elapsedMs.toFixed(2)}ms`,
    );
    return map;
}
