import type { Scene } from 'phaser';
import { GameObject, GameObjectState } from './GameObject';
import type { GameAssetConfig } from './GameAsset';
import { Direction, toDirection, worldCellCenterPixelX, worldCellCenterPixelY } from '../../utils/CoordinateUtils';
import type { HBMap } from '../assets/HBMap';
import type { SoundManager } from '../../utils/SoundManager';
import { DEFAULT_ANIMATION_FRAME_RATE } from '../../Config';
import { EventBus } from '../EventBus';
import { NPC_DEAD } from '../../constants/EventNames';
import { ShadowManager } from '../../utils/ShadowManager';
import { createLightRadiusOverlay } from '../../utils/SpriteUtils';

type NPCConfig = {
    x: number;
    y: number;
    spriteName: string;
    displayName: string;
    /** Facing 0–7 (maps to sprite sheet index). */
    direction: number;
    soundManager: SoundManager;
    map: HBMap;
    npcId: string;
};

/**
 * Represents an NPC in the game.
 * Stationary character that displays an idle animation.
 * All NPC animations start from index 0 (8 frames per direction).
 */
export class NPC extends GameObject {
    /** Display name shown in UI */
    private displayName: string;

    /** Unique NPC instance id from server (int64 as string on the wire). */
    private npcId: string;

    /** Whether the NPC is destroyed */
    private dead: boolean = false;

    /** Light radius overlay rendered underneath the NPC */
    private lightRadiusOverlay: Phaser.GameObjects.Sprite | undefined;

    constructor(scene: Scene, config: NPCConfig) {
        // NPC sprite sheet index = direction (0-7). Each sheet has 8 frames starting at index 0.
        const spriteSheetIndex = config.direction;

        const pixelX = worldCellCenterPixelX(config.x);
        const pixelY = worldCellCenterPixelY(config.y);

        const assetConfigs: Omit<GameAssetConfig, 'x' | 'y'>[] = [
            {
                spriteName: config.spriteName,
                spriteSheetIndex,
                direction: 0, // Use frames 0-7 within the sprite sheet
                framesPerDirection: 8,
                frameRate: DEFAULT_ANIMATION_FRAME_RATE,
            },
        ];

        super(scene, {
            x: config.x,
            y: config.y,
            assets: assetConfigs,
            soundManager: config.soundManager,
            map: config.map,
            movementSpeedMs: 0,
        });

        this.displayName = config.displayName;
        this.npcId = config.npcId;
        const dir = toDirection(config.direction);
        this.direction = dir === Direction.None ? Direction.South : dir;

        // Override asset positions to center NPC in cell
        for (const asset of this.assets) {
            asset.setPosition(pixelX, pixelY);
        }

        // Cast shadow using the NPC's own animation sprite
        this.shadowManager = new ShadowManager({
            scene,
            shadowSpriteName: config.spriteName,
            shadowSpriteSheetIndex: spriteSheetIndex,
            worldX: config.x,
            worldY: config.y,
            frameRate: DEFAULT_ANIMATION_FRAME_RATE,
        });

        this.lightRadiusOverlay = createLightRadiusOverlay(scene, pixelX, pixelY);

        this.updateDepth();
        this.updateShadowDepth();
    }

    protected switchState(_state: GameObjectState, _forceUpdate?: boolean): void {
    }

    /** Frees the cell and notifies `GameWorld` via `NPC_DEAD`. */
    public kill(): void {
        if (this.dead) {
            return;
        }
        this.dead = true;

        this.markCurrentTileFree();
        EventBus.emit(NPC_DEAD, { npcId: this.npcId });
    }

    public isDead(): boolean {
        return this.dead;
    }

    public getDisplayName(): string {
        return this.displayName;
    }

    public getNPCId(): string {
        return this.npcId;
    }

    public destroy(): void {
        if (!this.dead) {
            this.markCurrentTileFree();
        }
        if (this.lightRadiusOverlay) {
            this.lightRadiusOverlay.destroy();
            this.lightRadiusOverlay = undefined;
        }
        super.destroy();
    }
}
