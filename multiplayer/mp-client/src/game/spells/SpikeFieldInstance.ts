import type { Scene } from 'phaser';
import { drawEffectAtPixelCoords } from '../../utils/EffectUtils';
import { EFFECT_SPIKE_FIELD } from '../../constants/Effects';
import type { Effect } from '../effects/Effect';

export type SpikeFieldInstanceConfig = {
    /** Called when effect is created. Returns onDestroy callback to remove from effects array. */
    onEffectCreated?: (effect: Effect) => () => void;
};

/**
 * A single spike field tile. Uses Spike Field effect (effect3 sheet 4) in a loop.
 * Lifetime is server-driven: destroyed when the matching ground effect is removed from the server.
 */
export class SpikeFieldInstance {
    private effect: Effect | undefined;
    private onDestroyRef: () => void = () => {};

    constructor(
        scene: Scene,
        pixelX: number,
        pixelY: number,
        config?: SpikeFieldInstanceConfig
    ) {
        this.effect = drawEffectAtPixelCoords(
            scene,
            pixelX,
            pixelY,
            EFFECT_SPIKE_FIELD,
            {
                infiniteLoop: true,
                frameRate: 10,
                startAnimationFrame: Phaser.Math.Between(0, 4), // 0-4 frames
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
