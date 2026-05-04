import type { Scene } from 'phaser';

import { LOAD_MONSTER_ASSETS_ON_DEMAND, MONSTER_PLACEHOLDER_SPRITE } from '../Config';
import { AssetType, getMonsterAssets, type AssetData } from '../constants/Assets';
import { HBSpriteFile } from '../game/assets/HBSprite';

const monsterAssetLoadPromises = new Map<string, Promise<void>>();
const assetLoadPromises = new Map<string, Promise<void>>();

/** True when monster assets should be fetched lazily in the current loading mode. */
export function shouldLoadMonsterAssetsOnDemand(): boolean {
    return LOAD_MONSTER_ASSETS_ON_DEMAND;
}

/** True while {@link loadMonsterAssetsOnDemand} has an unresolved promise for this monster basename. */
export function isMonsterAssetLoadInFlight(spriteName: string): boolean {
    return monsterAssetLoadPromises.has(spriteName);
}

/**
 * Returns true when every sprite and sound required by this monster is available in Phaser caches.
 * During {@link HBSpriteFile.load}, sheet 0 can be registered before higher indices; while the load
 * promise is unresolved, this returns false so callers keep the placeholder until the `.spr` is fully registered.
 */
export function areMonsterAssetsLoaded(scene: Scene, spriteName: string): boolean {
    const assetsRegistered = getMonsterAssets(spriteName).every((asset) => {
        switch (asset.assetType) {
            case AssetType.SPRITE:
                return scene.textures.exists(`${asset.key}-0`);
            case AssetType.SOUND:
                return scene.cache.audio.exists(asset.key);
            default:
                return true;
        }
    });
    return assetsRegistered && !isMonsterAssetLoadInFlight(spriteName);
}

/** Fetches, decodes, and registers one monster's sprite/sound assets for lazy rendering. */
export function loadMonsterAssetsOnDemand(scene: Scene, spriteName: string): Promise<void> {
    if (spriteName === MONSTER_PLACEHOLDER_SPRITE || areMonsterAssetsLoaded(scene, spriteName)) {
        return Promise.resolve();
    }

    const existing = monsterAssetLoadPromises.get(spriteName);
    if (existing) {
        return existing;
    }

    const promise = loadMonsterAssets(scene, spriteName)
        .then(() => {
            console.log(`[MonsterAssetLoader] Loaded monster assets for ${spriteName}`);
        })
        .catch((error) => {
            throw error;
        })
        .finally(() => {
            monsterAssetLoadPromises.delete(spriteName);
        });

    monsterAssetLoadPromises.set(spriteName, promise);
    return promise;
}

async function loadMonsterAssets(scene: Scene, spriteName: string): Promise<void> {
    const assets = getMonsterAssets(spriteName);
    const spriteAssets = assets.filter((asset) => asset.assetType === AssetType.SPRITE && !scene.textures.exists(`${asset.key}-0`));
    const soundAssets = assets.filter((asset) => asset.assetType === AssetType.SOUND && !scene.cache.audio.exists(asset.key));
    const startedAt = performance.now();

    await Promise.all([
        ...spriteAssets.map((asset) => loadAssetOnce(scene, asset)),
        ...soundAssets.map((asset) => loadAssetOnce(scene, asset)),
    ]);

    console.log(
        `[MonsterAssetLoader] Registered ${spriteAssets.length} sprites and ${soundAssets.length} sounds for ${spriteName} in ${(performance.now() - startedAt).toFixed(2)}ms`,
    );
}

function loadAssetOnce(scene: Scene, asset: AssetData): Promise<void> {
    if (
        (asset.assetType === AssetType.SPRITE && scene.textures.exists(`${asset.key}-0`)) ||
        (asset.assetType === AssetType.SOUND && scene.cache.audio.exists(asset.key))
    ) {
        return Promise.resolve();
    }

    const loadKey = `${asset.assetType}:${asset.key}`;
    const existing = assetLoadPromises.get(loadKey);
    if (existing) {
        return existing;
    }

    const promise = asset.assetType === AssetType.SPRITE
        ? fetchAndRegisterMonsterSprite(scene, asset)
        : fetchAndRegisterMonsterSound(scene, asset);
    assetLoadPromises.set(loadKey, promise);
    return promise.catch((error) => {
        assetLoadPromises.delete(loadKey);
        throw error;
    });
}

async function fetchAndRegisterMonsterSprite(scene: Scene, asset: AssetData): Promise<void> {
    if (!asset.spriteType) {
        throw new Error(`Monster sprite asset ${asset.key} is missing spriteType`);
    }

    const response = await fetch(`assets/sprites/${asset.fileName}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch monster sprite ${asset.fileName}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    scene.cache.binary.add(asset.key, arrayBuffer);

    const hbFile = new HBSpriteFile(asset.key, asset.spriteType, asset.exportFramesAsDataUrls || false, asset.tileStartIndex);
    await hbFile.load(scene);
}

async function fetchAndRegisterMonsterSound(scene: Scene, asset: AssetData): Promise<void> {
    const response = await fetch(`assets/sounds/${asset.fileName}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch monster sound ${asset.fileName}: ${response.status} ${response.statusText}`);
    }

    const soundManager = scene.sound as { context?: AudioContext };
    const audioContext = soundManager.context;
    if (!audioContext) {
        console.warn(`[MonsterAssetLoader] No audio context available, skipping ${asset.fileName}`);
        return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    scene.cache.audio.add(asset.key, audioBuffer);
}
