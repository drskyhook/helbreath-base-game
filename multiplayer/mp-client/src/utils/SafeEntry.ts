import { EventBus } from '../game/EventBus';

/**
 * Runs a synchronous callback and logs failures so errors do not propagate from
 * event/timer/socket entry points.
 */
export function runSafeSync(context: string, fn: () => void): void {
    try {
        fn();
    } catch (error) {
        console.error(`[${context}]`, error);
    }
}

/**
 * Subscribes to EventBus with per-listener error isolation. Do not use when the
 * same listener reference must be passed to `EventBus.off(event, listener)`.
 */
export function subscribeSafe(
    scope: string,
    eventName: string | symbol,
    /** Payload types vary per event; callers keep typed handlers at registration sites. */
    handler: (...args: any[]) => void,
): void {
    EventBus.on(eventName, (...args: any[]) => {
        try {
            handler(...args);
        } catch (error) {
            console.error(`[${scope}:${String(eventName)}]`, error);
        }
    });
}
