import type { Scene } from 'phaser';
import { EventBus } from '../game/EventBus';
import { runSafeSync } from './SafeEntry';
import { TILE_SIZE } from '../game/assets/HBMap';
import { getGameStateManager } from './RegistryUtils';
import {
    IN_UI_CAMERA_MOVE_UP,
    IN_UI_CAMERA_MOVE_DOWN,
    IN_UI_CAMERA_MOVE_LEFT,
    IN_UI_CAMERA_MOVE_RIGHT,
    IN_UI_CHANGE_CAMERA_ZOOM,
    IN_UI_CHANGE_CAMERA_FOLLOW_PLAYER,
    IN_UI_CHANGE_CAMERA_SHAKE,
    IN_UI_CHANGE_POST_PROCESSING,
    OUT_UI_CAMERA_FOLLOW_PLAYER_CHANGED,
} from '../constants/EventNames';
import { cameraDialogStore } from '../ui/store/CameraDialog.store';
import type { PostProcessingMode } from '../ui/store/CameraDialog.store';

export interface CameraManagerConfig {
    scene: Scene;
    /** When true, setZoom skips updating GameStateManager (e.g. during minimap capture) */
    isCapturingMinimap?: () => boolean;
    /** Returns pixel position for follow target, or undefined if no target (reuse same Vector2 each call to avoid allocations). */
    getFollowTarget?: () => Phaser.Math.Vector2 | undefined;
}

/**
 * Manages camera behavior: follow target, zoom, bounds, and UI-driven movement.
 * Listens for React UI events and updates the main camera accordingly.
 */
export class CameraManager {
    private scene: Scene;
    private isCapturingMinimap: () => boolean;
    private getFollowTarget: () => Phaser.Math.Vector2 | undefined;
    private cameraFollowPlayer = true;
    private cameraShakingDegree = 0;
    private cameraShakeEnabled = true;

    private boundMoveUp: () => void;
    private boundMoveDown: () => void;
    private boundMoveLeft: () => void;
    private boundMoveRight: () => void;
    private boundChangeZoom: (zoom: number) => void;
    private boundChangeFollowPlayer: (enabled: boolean) => void;
    private boundChangeCameraShake: (enabled: boolean) => void;
    private boundChangePostProcessing: (mode: PostProcessingMode) => void;

    constructor(config: CameraManagerConfig) {
        this.scene = config.scene;
        this.isCapturingMinimap = config.isCapturingMinimap ?? (() => false);
        this.getFollowTarget = config.getFollowTarget ?? (() => undefined);

        this.boundMoveUp = () => runSafeSync('CameraManager:moveUp', () => this.moveCamera(0, -TILE_SIZE));
        this.boundMoveDown = () => runSafeSync('CameraManager:moveDown', () => this.moveCamera(0, TILE_SIZE));
        this.boundMoveLeft = () => runSafeSync('CameraManager:moveLeft', () => this.moveCamera(-TILE_SIZE, 0));
        this.boundMoveRight = () => runSafeSync('CameraManager:moveRight', () => this.moveCamera(TILE_SIZE, 0));
        this.boundChangeZoom = (zoom: number) =>
            runSafeSync('CameraManager:changeZoom', () => this.setZoom(zoom));
        this.boundChangeFollowPlayer = (enabled: boolean) =>
            runSafeSync('CameraManager:changeFollowPlayer', () => this.setFollowPlayer(enabled));
        this.boundChangeCameraShake = (enabled: boolean) =>
            runSafeSync('CameraManager:changeCameraShake', () => this.setCameraShakeEnabled(enabled));
        this.boundChangePostProcessing = (mode: PostProcessingMode) =>
            runSafeSync('CameraManager:changePostProcessing', () => this.applyPostProcessing(mode));
    }

    private applyPostProcessing(mode: PostProcessingMode): void {
        const camera = this.scene.cameras?.main;
        if (!camera) {
            return;
        }

        camera.removePostPipeline('FXAAPostFX');

        switch (mode) {
            case 'fxaa':
                camera.setPostPipeline('FXAAPostFX');
                break;
            case 'none':
                break;
        }
    }

    public setupEventListeners(): void {
        EventBus.on(IN_UI_CAMERA_MOVE_UP, this.boundMoveUp);
        EventBus.on(IN_UI_CAMERA_MOVE_DOWN, this.boundMoveDown);
        EventBus.on(IN_UI_CAMERA_MOVE_LEFT, this.boundMoveLeft);
        EventBus.on(IN_UI_CAMERA_MOVE_RIGHT, this.boundMoveRight);
        EventBus.on(IN_UI_CHANGE_CAMERA_ZOOM, this.boundChangeZoom);
        EventBus.on(IN_UI_CHANGE_CAMERA_FOLLOW_PLAYER, this.boundChangeFollowPlayer);
        EventBus.on(IN_UI_CHANGE_CAMERA_SHAKE, this.boundChangeCameraShake);
        EventBus.on(IN_UI_CHANGE_POST_PROCESSING, this.boundChangePostProcessing);

        // Apply initial post-processing state from store
        const { postProcessing } = cameraDialogStore.state;
        this.applyPostProcessing(postProcessing);
    }

    public destroyEventListeners(): void {
        EventBus.off(IN_UI_CAMERA_MOVE_UP, this.boundMoveUp);
        EventBus.off(IN_UI_CAMERA_MOVE_DOWN, this.boundMoveDown);
        EventBus.off(IN_UI_CAMERA_MOVE_LEFT, this.boundMoveLeft);
        EventBus.off(IN_UI_CAMERA_MOVE_RIGHT, this.boundMoveRight);
        EventBus.off(IN_UI_CHANGE_CAMERA_ZOOM, this.boundChangeZoom);
        EventBus.off(IN_UI_CHANGE_CAMERA_FOLLOW_PLAYER, this.boundChangeFollowPlayer);
        EventBus.off(IN_UI_CHANGE_CAMERA_SHAKE, this.boundChangeCameraShake);
        EventBus.off(IN_UI_CHANGE_POST_PROCESSING, this.boundChangePostProcessing);
    }

    private setCameraShakeEnabled(enabled: boolean): void {
        this.cameraShakeEnabled = enabled;
    }

    /**
     * Updates camera position each frame. Call from scene update loop.
     * Follows the target when follow mode is enabled.
     * Applies camera shake when active.
     */
    public update(): void {
        runSafeSync('CameraManager:update', () => {
            const camera = this.scene.cameras?.main;
            if (!camera) {
                return;
            }

            if (this.cameraFollowPlayer) {
                const target = this.getFollowTarget();
                if (target) {
                    camera.scrollX = target.x - camera.width / 2;
                    camera.scrollY = target.y - camera.height / 2;
                }
            }

            if (this.cameraShakingDegree > 0) {
                const offsetX = this.cameraShakingDegree - Phaser.Math.Between(0, this.cameraShakingDegree * 2 - 1);
                const offsetY = this.cameraShakingDegree - Phaser.Math.Between(0, this.cameraShakingDegree * 2 - 1);
                camera.scrollX += offsetX;
                camera.scrollY += offsetY;
                this.cameraShakingDegree = Math.max(0, this.cameraShakingDegree - 1);
            }
        });
    }

    /**
     * Triggers camera shake based on effect distance from screen center.
     * Uses the same formula as the reference: intensity decreases with distance.
     *
     * @param effectPixelX Effect position X in world pixels
     * @param effectPixelY Effect position Y in world pixels
     * @param multiplier Optional intensity multiplier (e.g. 2 for stronger effects)
     */
    public setCameraShake(effectPixelX: number, effectPixelY: number, multiplier?: number): void {
        if (!this.cameraShakeEnabled) {
            return;
        }
        const camera = this.scene.cameras?.main;
        if (!camera) {
            return;
        }

        const camCenterX = camera.scrollX + camera.width / 2;
        const camCenterY = camera.scrollY + camera.height / 2;
        const distPixels = Math.max(
            Math.abs(effectPixelX - camCenterX),
            Math.abs(effectPixelY - camCenterY)
        );
        const sDist = distPixels / TILE_SIZE;

        let degree = (5 - sDist) * 2;
        if (degree <= 0) {
            degree = 0;
        }
        if (multiplier !== undefined && multiplier !== 0) {
            degree *= multiplier;
        }
        if (degree <= 2) {
            return;
        }

        this.cameraShakingDegree = degree;
    }

    public moveCamera(deltaX: number, deltaY: number): void {
        if (!this.scene.cameras?.main) {
            return;
        }
        this.scene.cameras.main.scrollX += deltaX;
        this.scene.cameras.main.scrollY += deltaY;

        if (this.cameraFollowPlayer) {
            this.setFollowPlayer(false);
            EventBus.emit(OUT_UI_CAMERA_FOLLOW_PLAYER_CHANGED, false);
        }
    }

    public setZoom(zoom: number): void {
        if (!this.scene.cameras?.main) {
            return;
        }
        this.scene.cameras.main.setZoom(zoom);
        if (!this.isCapturingMinimap()) {
            getGameStateManager(this.scene.game).setCameraZoom(zoom * 100);
        }
    }

    public setFollowPlayer(enabled: boolean): void {
        this.cameraFollowPlayer = enabled;

        if (enabled) {
            const target = this.getFollowTarget();
            if (target && this.scene.cameras?.main) {
                const camera = this.scene.cameras.main;
                camera.scrollX = target.x - camera.width / 2;
                camera.scrollY = target.y - camera.height / 2;
            }
        }
    }

    public getFollowPlayer(): boolean {
        return this.cameraFollowPlayer;
    }

    public setBounds(width: number, height: number): void {
        this.scene.cameras?.main?.setBounds(0, 0, width, height);
    }

    public centerOn(x: number, y: number): void {
        this.scene.cameras?.main?.centerOn(x, y);
    }
}
