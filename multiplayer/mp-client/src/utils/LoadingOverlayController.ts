import type { Scene } from 'phaser';
import { FRAMES_UNTIL_OVERLAY_REMOVAL, LOADING_OVERLAY_DEPTH, LOADING_TEXT_DEPTH } from '../Config';

/**
 * Owns the full-screen loading overlay and "Loading map..." text used during initial map load.
 * GameWorld drives frame countdown via {@link tickRemovalCountdown}.
 */
export class LoadingOverlayController {
    private loadingOverlay: Phaser.GameObjects.Rectangle | undefined = undefined;
    private loadingText: Phaser.GameObjects.Text | undefined = undefined;
    private framesUntilOverlayRemoval = 0;

    public constructor(private readonly scene: Scene) {}

    public getOverlay(): Phaser.GameObjects.Rectangle | undefined {
        return this.loadingOverlay;
    }

    public getText(): Phaser.GameObjects.Text | undefined {
        return this.loadingText;
    }

    /**
     * Brings overlay and label to top of the scene display list (call each frame while visible).
     */
    public bringToTop(): void {
        if (this.loadingOverlay && this.loadingText) {
            this.scene.children.bringToTop(this.loadingOverlay);
            this.scene.children.bringToTop(this.loadingText);
        }
    }

    /**
     * Decrements removal countdown; destroys overlay when it reaches zero.
     */
    public tickRemovalCountdown(): void {
        if (this.framesUntilOverlayRemoval > 0) {
            this.framesUntilOverlayRemoval--;
            if (this.framesUntilOverlayRemoval === 0) {
                if (this.loadingOverlay) {
                    this.loadingOverlay.destroy();
                    this.loadingOverlay = undefined;
                }
                if (this.loadingText) {
                    this.loadingText.destroy();
                    this.loadingText = undefined;
                }
            }
        }
    }

    /**
     * After minimap snapshot and camera zoom, defer overlay removal by {@link FRAMES_UNTIL_OVERLAY_REMOVAL}.
     */
    public scheduleRemovalAfterMapReady(): void {
        this.framesUntilOverlayRemoval = FRAMES_UNTIL_OVERLAY_REMOVAL;
    }

    /**
     * Creates black overlay + text, then runs `callback` on the next frame so the first paint shows loading.
     */
    public drawAndDeferLoad(callback: () => void): void {
        this.loadingOverlay = this.scene.add.rectangle(
            this.scene.scale.width / 2,
            this.scene.scale.height / 2,
            this.scene.scale.width,
            this.scene.scale.height,
            0x000000,
            1.0
        );
        this.loadingOverlay.setScrollFactor(0, 0);
        this.loadingOverlay.setDepth(LOADING_OVERLAY_DEPTH);

        this.loadingText = this.scene.add.text(
            this.scene.scale.width / 2,
            this.scene.scale.height / 2,
            'Loading map...',
            {
                fontFamily: 'Georgia, serif',
                fontSize: '20px',
                color: '#f4e4c1',
                fontStyle: 'bold',
            }
        );
        this.loadingText.setOrigin(0.5, 0.5);
        this.loadingText.setShadow(1, 1, '#1a0f0a', 2, true);
        this.loadingText.setScrollFactor(0, 0);
        this.loadingText.setDepth(LOADING_TEXT_DEPTH);

        this.scene.time.delayedCall(0, callback);
    }

    public destroyImmediate(): void {
        if (this.loadingOverlay) {
            this.loadingOverlay.destroy();
            this.loadingOverlay = undefined;
        }
        if (this.loadingText) {
            this.loadingText.destroy();
            this.loadingText = undefined;
        }
        this.framesUntilOverlayRemoval = 0;
    }
}
