/**
 * FIFO remote movement sync commands (mirrors {@link Player} pending queue semantics).
 * Used by {@link Player} for server-driven movement; kept in utils for shared typing.
 */
export type PendingSyncCommand =
    | { type: 'movementStep'; curX: number; curY: number; destX: number; destY: number; dashAttack: boolean }
    | { type: 'idleDirection'; direction: number }
    | { type: 'pickup'; direction: number; animationTimeMs: number }
    | { type: 'bowStance'; direction: number; animationTimeMs: number };

/**
 * Owns remote movement queue state and grace timing for deferred idle switches.
 * Wired from {@link Player}; game logic remains on Player and GameObject.
 */
export class PlayerMovementManager {
    /** FIFO: deferred remote movement is unshifted so it runs before idle commands pushed while walking. */
    public pendingSyncCommands: PendingSyncCommand[] = [];
    public pendingRemoteIdleSwitchMs: number | undefined;
    public remoteIdleContinuationGraceMs = 100;

    public clearQueue(): void {
        this.pendingSyncCommands = [];
    }
}
