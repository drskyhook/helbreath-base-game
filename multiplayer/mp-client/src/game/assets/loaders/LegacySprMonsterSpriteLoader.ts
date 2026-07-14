import type { Scene } from 'phaser';
import type { AssetData } from '../../../constants/Assets';
import { HBSpriteFile } from '../HBSprite';
import type { MonsterSpriteLoader } from './MonsterSpriteLoader';

export class LegacySprMonsterSpriteLoader implements MonsterSpriteLoader {
    public isLoaded(scene: Scene, asset: AssetData): boolean {
        return scene.textures.exists(`${asset.key}-0`);
    }

    public async load(scene: Scene, asset: AssetData): Promise<void> {
        if (!asset.spriteType) {
            throw new Error(`Monster sprite asset ${asset.key} is missing spriteType`);
        }

        const response = await fetch(`assets/sprites/${asset.fileName}`);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch monster sprite ${asset.fileName}: ` +
                `${response.status} ${response.statusText}`,
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        scene.cache.binary.add(asset.key, arrayBuffer);

        const hbFile = new HBSpriteFile(
            asset.key,
            asset.spriteType,
            asset.exportFramesAsDataUrls ?? false,
            asset.tileStartIndex,
        );

        await hbFile.load(scene);
    }
}