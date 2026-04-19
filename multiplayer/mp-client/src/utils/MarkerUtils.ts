import type { Scene } from 'phaser';
import { FloatingText } from '../game/effects/FloatingText';

/**
 * Pixel anchor for floating physical damage numbers (e.g. server monster hits).
 */
export type PhysicalDamageMarkerPosition = {
    x: number;
    y: number;
};

/**
 * Spawns a floating red damage number at the given screen position.
 */
export function createPhysicalDamageMarker(
    scene: Scene,
    position: PhysicalDamageMarkerPosition,
    damageDealt: number,
): void {
    new FloatingText(scene, {
        text: String(-damageDealt),
        x: position.x,
        y: position.y,
        fontSize: 17,
        color: '#d93030',
        bold: true,
        horizontalOffset: 4,
        upwardTravelPxPerSec: 32,
        totalDurationMs: 2100,
        fadeDurationMs: 1000,
    });
}
