import type { Scene } from 'phaser';
import { drawEffectAtPixelCoords } from '../../utils/EffectUtils';
import { EFFECT_POSITIONAL_FIRE_1 } from '../../constants/Effects';
import type { Effect } from '../effects/Effect';

export type FireInstanceConfig = {
    /** Called when effect is created. Returns onDestroy callback to remove from effects array. */
    onEffectCreated?: (effect: Effect) => () => void;
};

/**
 * A single fire tile for Fire Wall. Uses Positional Fire 1 effect in a loop.
 * Persists until destroy() is called.
 */
export class FireInstance {
    private effect: Effect | undefined;
    private onDestroyRef: () => void = () => {};

    constructor(
        scene: Scene,
        pixelX: number,
        pixelY: number,
        config?: FireInstanceConfig
    ) {
        this.effect = drawEffectAtPixelCoords(
            scene,
            pixelX,
            pixelY,
            EFFECT_POSITIONAL_FIRE_1,
            {
                infiniteLoop: true,
                frameRate: 10,
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
