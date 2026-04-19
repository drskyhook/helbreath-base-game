import { Events } from 'phaser';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface ToastRequestedEvent {
    message: string;
    severity: ToastSeverity;
    /** Duration in ms. When set, toast closes after this delay. Omit for container default (e.g. 3000 ms). */
    autoClose?: number;
    /** When true (logout countdown info toast), App stores the toast id for early dismiss via EventBus. */
    trackForLogoutDismiss?: boolean;
}

/**
 * Phaser EventEmitter for cross-component communication.
 * Used to emit events between React UI, Phaser scenes, and game objects.
 */
export const EventBus = new Events.EventEmitter();