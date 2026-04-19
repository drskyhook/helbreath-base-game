import type { Scene } from 'phaser';
import { SpikeFieldInstance } from './SpikeFieldInstance';
import type { Effect } from '../effects/Effect';

export type SpikeFieldConfig = {
    /** Called when each effect is created. Returns onDestroy to remove from effects array. */
    onEffectCreated?: (effect: Effect) => () => void;
};

/**
 * Creates one server-authoritative Spike Field ground-effect instance.
 */
export function createSpikeField(
    scene: Scene,
    pixelX: number,
    pixelY: number,
    config: SpikeFieldConfig = {}
): SpikeFieldInstance {
    return new SpikeFieldInstance(scene, pixelX, pixelY, {
        onEffectCreated: config.onEffectCreated,
    });
}
