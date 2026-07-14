import type { Scene } from 'phaser';
import type { AssetData } from '../../../constants/Assets';

export interface MonsterSpriteLoader {
    isLoaded(scene: Scene, asset: AssetData): boolean;
    load(scene: Scene, asset: AssetData): Promise<void>;
}