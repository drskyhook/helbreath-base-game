import type { Scene } from 'phaser';

/**
 * Bow timing and arrow spawn scheduling extracted from {@link Player} for clarity.
 * Holds Phaser timer state only; attack resolution stays in Player.
 */
export class PlayerRangedCombatManager {
    /** When set, fires bow release (sound + arrow VFX) at half swing; cleared on cancel or completion. */
    public pendingBowArrowTimer: Phaser.Time.TimerEvent | undefined = undefined;

    public cancelPendingBowArrowSpawn(): void {
        if (this.pendingBowArrowTimer) {
            this.pendingBowArrowTimer.destroy();
            this.pendingBowArrowTimer = undefined;
        }
    }

    /** Fires `onFire` after `halfMs` (typically half the bow swing) via `scene.time.delayedCall`. */
    public scheduleBowArrowSpawn(scene: Scene, halfMs: number, onFire: () => void): void {
        this.cancelPendingBowArrowSpawn();
        this.pendingBowArrowTimer = scene.time.delayedCall(halfMs, () => {
            this.pendingBowArrowTimer = undefined;
            onFire();
        });
    }
}
