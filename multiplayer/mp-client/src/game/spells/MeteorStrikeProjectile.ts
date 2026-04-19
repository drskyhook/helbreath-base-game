import type { Scene } from 'phaser';
import type { CameraManager } from '../../utils/CameraManager';
import { Effect } from '../effects/Effect';
import { getEffectByKey } from '../../constants/Effects';
import {
    EFFECT_METEOR_FALLING,
    EFFECT_BLUE_ORB,
    EFFECT_WHITE_ORB,
    EFFECT_FIRE_ORB,
    EFFECT_METEOR_STRIKE_IMPACT,
    EFFECT_METEOR_GROUND_EXPLOSION,
    EFFECT_METEOR_EXPLOSION,
} from '../../constants/Effects';
import { convertPixelPosToWorldPos } from '../../utils/CoordinateUtils';
import { drawEffect } from '../../utils/EffectUtils';
import type { SoundManager } from '../../utils/SoundManager';
import { TILE_SIZE } from '../assets/HBMap';

/** Horizontal offset from target cell center toward the meteor spawn (same units as server tile/pixel math). */
const METEOR_ORIGIN_OFFSET_X = 300;

export type MeteorStrikeProjectileConfig = {
    /** Projectile speed in pixels per second */
    projectileSpeed: number;
    /** Vertical distance in pixels from target to spawn point above the cursor; matches server `projectileDistance` / client `projectileDistancePx`. */
    projectileDistancePx: number;
    /** Sound manager for effect sounds */
    soundManager?: SoundManager;
    /** Player world X for spatial audio */
    playerWorldX?: number;
    /** Player world Y for spatial audio */
    playerWorldY?: number;
    /** Camera manager for shake on explosion */
    cameraManager?: CameraManager;
};

const PROJECTILE_EFFECT_KEYS = [
    EFFECT_METEOR_FALLING,
    EFFECT_BLUE_ORB,
    EFFECT_WHITE_ORB,
    EFFECT_FIRE_ORB,
] as const;

/**
 * Meteor Strike projectile. Travels from origin (cursor +300px X, -projectileDistancePx Y) to target (cursor).
 * Displays looping effects during flight: Meteor Falling, Blue Orb, White Orb, Fire Orb.
 * On arrival: Meteor Strike Impact, Meteor Ground Explosion, Meteor Explosion (in order, not looping).
 * When Meteor Explosion ends, all resources are cleaned up.
 */
export class MeteorStrikeProjectile {
    private scene: Scene;
    private config: MeteorStrikeProjectileConfig;
    private projectileEffects: Effect[] = [];
    private originX: number;
    private originY: number;
    private destPixelX: number;
    private destPixelY: number;
    private totalDistance: number;
    private traveledDistance: number = 0;
    private updateCallback: (time: number, delta: number) => void;

    constructor(
        scene: Scene,
        targetPixelX: number,
        targetPixelY: number,
        config: MeteorStrikeProjectileConfig
    ) {
        this.scene = scene;
        this.config = config;

        this.originX = targetPixelX + METEOR_ORIGIN_OFFSET_X;
        this.originY = targetPixelY - this.config.projectileDistancePx - TILE_SIZE / 2;
        this.destPixelX = targetPixelX;
        this.destPixelY = targetPixelY - TILE_SIZE / 2;

        this.totalDistance = Phaser.Math.Distance.Between(
            this.originX,
            this.originY,
            this.destPixelX,
            this.destPixelY
        );

        this.createProjectileEffects();

        this.updateCallback = (_time: number, delta: number) => this.update(delta);
        this.scene.events.on('update', this.updateCallback);
    }

    private createProjectileEffects(): void {
        const drawOptions = {
            soundManager: this.config.soundManager,
            playerWorldX: this.config.playerWorldX,
            playerWorldY: this.config.playerWorldY,
            infiniteLoop: true,
        };

        for (const effectKey of PROJECTILE_EFFECT_KEYS) {
            const config = getEffectByKey(effectKey);
            if (!config) {
                continue;
            }

            const effect = new Effect(this.scene, {
                config,
                pixelX: this.originX,
                pixelY: this.originY,
                ...drawOptions,
            });
            this.projectileEffects.push(effect);
        }
    }

    private update(delta: number): void {
        const speedPxPerMs = this.config.projectileSpeed / 1000;
        const moveDistance = speedPxPerMs * delta;
        this.traveledDistance += moveDistance;

        if (this.traveledDistance >= this.totalDistance) {
            this.onReachDestination();
            return;
        }

        const progress = this.traveledDistance / this.totalDistance;
        const currentX = this.originX + (this.destPixelX - this.originX) * progress;
        const currentY = this.originY + (this.destPixelY - this.originY) * progress;

        for (const effect of this.projectileEffects) {
            effect.setPosition(currentX, currentY);
        }
    }

    private onReachDestination(): void {
        const destWorldX = convertPixelPosToWorldPos(this.destPixelX);
        const destWorldY = convertPixelPosToWorldPos(this.destPixelY);

        const drawOptions = {
            soundManager: this.config.soundManager,
            playerWorldX: this.config.playerWorldX,
            playerWorldY: this.config.playerWorldY,
        };

        for (const effect of this.projectileEffects) {
            effect.destroy();
        }
        this.projectileEffects = [];
        this.destroy();

        this.config.cameraManager?.setCameraShake(this.destPixelX, this.destPixelY, 2);

        // Draw all impact effects simultaneously
        drawEffect(this.scene, destWorldX, destWorldY, EFFECT_METEOR_STRIKE_IMPACT, drawOptions);
        drawEffect(this.scene, destWorldX, destWorldY, EFFECT_METEOR_GROUND_EXPLOSION, drawOptions);
        drawEffect(this.scene, destWorldX, destWorldY, EFFECT_METEOR_EXPLOSION, drawOptions);
    }

    public destroy(): void {
        this.scene.events.off('update', this.updateCallback);
        for (const effect of this.projectileEffects) {
            effect.destroy();
        }
        this.projectileEffects = [];
    }
}
