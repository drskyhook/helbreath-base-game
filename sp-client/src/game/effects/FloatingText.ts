import type { Scene } from 'phaser';
import { NATIVE_OVERLAY_FLOATING_TEXT_REQUESTED } from '../../constants/EventNames';
import { EventBus } from '../EventBus';

/**
 * Configuration for creating a FloatingText instance.
 */
export type FloatingTextConfig = {
    /** Text to display */
    text: string;
    /** X position in pixels (origin, text travels upward from here) */
    x: number;
    /** Y position in pixels (origin, text travels upward from here) */
    y: number;
    /** Font size in pixels */
    fontSize?: number;
    /** Text colour (hex string, e.g. '#ff0000') */
    color?: string;
    /** Upward travel speed in pixels per second */
    upwardTravelPxPerSec?: number;
    /** Total duration in milliseconds before destroy */
    totalDurationMs: number;
    /** Fade duration in milliseconds. Fade starts at (totalDurationMs - fadeDurationMs). 0 = no fade, destroyed immediately at end. */
    fadeDurationMs?: number;
    /** Whether the font is bold */
    bold?: boolean;
    /** Horizontal offset in pixels. Negative = shift left, positive = shift right. */
    horizontalOffset?: number;
};

export type NativeFloatingTextPayload = {
    scene: Scene;
    text: string;
    x: number;
    y: number;
    fontSize: number;
    color: string;
    upwardTravelPxPerSec: number;
    totalDurationMs: number;
    fadeDurationMs: number;
    bold: boolean;
    fontFamily: string;
};

const FLOATING_TEXT_FONT_FAMILY = "'Georgia', serif";

/**
 * Represents numerical or textual indicators on the game canvas.
 * Renders through the native browser overlay above Phaser.
 * Text travels upward from origin and fades out before being destroyed.
 */
export class FloatingText {
    constructor(scene: Scene, config: FloatingTextConfig) {
        const fontSize = config.fontSize ?? 16;
        const color = config.color ?? '#ffffff';
        EventBus.emit(NATIVE_OVERLAY_FLOATING_TEXT_REQUESTED, {
            scene,
            text: config.text,
            x: config.x + (config.horizontalOffset ?? 0),
            y: config.y,
            fontSize,
            color,
            upwardTravelPxPerSec: config.upwardTravelPxPerSec ?? 0,
            totalDurationMs: config.totalDurationMs,
            fadeDurationMs: config.fadeDurationMs ?? 0,
            bold: config.bold ?? false,
            fontFamily: FLOATING_TEXT_FONT_FAMILY,
        } satisfies NativeFloatingTextPayload);
    }

    public destroy(): void {
        // Browser overlay owns native text lifetime after construction.
    }
}
