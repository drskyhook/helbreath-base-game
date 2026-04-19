import type { Scene } from 'phaser';
import { drawEffectAtPixelCoords } from '../../utils/EffectUtils';
import { EFFECT_POISON_CLOUD } from '../../constants/Effects';
import type { Effect } from '../effects/Effect';

export type PoisonCloudInstanceConfig = {
    /** Called when effect is created. Returns onDestroy callback to remove from effects array. */
    onEffectCreated?: (effect: Effect) => () => void;
};

/**
 * A single poison cloud tile. Uses Poison Cloud effect (effect4 sheet 4) in a loop.
 * Lifetime is server-driven: destroyed when the matching ground effect is removed from the server.
 */
export class PoisonCloudInstance {
    private effect: Effect | undefined;
    private onDestroyRef: () => void = () => {};

    constructor(
        scene: Scene,
        pixelX: number,
        pixelY: number,
        config?: PoisonCloudInstanceConfig
    ) {
        this.effect = drawEffectAtPixelCoords(
            scene,
            pixelX,
            pixelY,
            EFFECT_POISON_CLOUD,
            {
                infiniteLoop: true,
                frameRate: 10,
                startAnimationFrame: Phaser.Math.Between(0, 10), // 0-10 frames
                onDestroy: () => this.onDestroyRef(),
            }
        );

        if (this.effect) {
            const remove = config?.onEffectCreated?.(this.effect);
            if (remove) {
                this.onDestroyRef = remove;
            }
        }
    }

    public destroy(): void {
        this.effect?.destroy();
        this.effect = undefined;
    }
}
