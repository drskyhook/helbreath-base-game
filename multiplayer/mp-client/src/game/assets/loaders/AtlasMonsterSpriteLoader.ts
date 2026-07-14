import type { Scene } from 'phaser';
import type { AssetData } from '../../../constants/Assets';
import type { MonsterSpriteLoader } from './MonsterSpriteLoader';

export class AtlasMonsterSpriteLoader implements MonsterSpriteLoader {
    public isLoaded(scene: Scene, asset: AssetData): boolean {
        return scene.textures.exists(asset.key);
    }

    public async load(_scene: Scene, asset: AssetData): Promise<void> {
        throw new Error(
            `Atlas loading is not implemented yet for monster sprite ${asset.key}`,
        );
    }
}