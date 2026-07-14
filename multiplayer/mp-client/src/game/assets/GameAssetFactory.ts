import type { Scene } from 'phaser';
import { GameAsset, type GameAssetConfig } from '../objects/GameAsset';

export function createGameAsset(
    scene: Scene,
    config: GameAssetConfig,
): GameAsset {
    return new GameAsset(scene, config);
}