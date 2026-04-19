/**
 * Single-slot debounce: each {@link schedule} resets the wait; only the last callback runs.
 */
export class DebounceTimer {
    private timerId: ReturnType<typeof setTimeout> | undefined;

    public constructor(private readonly delayMs: number) {}

    /** True while a callback is scheduled and not yet invoked. */
    public get isPending(): boolean {
        return this.timerId !== undefined;
    }

    public schedule(fn: () => void): void {
        if (this.timerId !== undefined) {
            clearTimeout(this.timerId);
        }
        this.timerId = setTimeout(() => {
            this.timerId = undefined;
            fn();
        }, this.delayMs);
    }

    public cancel(): void {
        if (this.timerId !== undefined) {
            clearTimeout(this.timerId);
            this.timerId = undefined;
        }
    }
}
