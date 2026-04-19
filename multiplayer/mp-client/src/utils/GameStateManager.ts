import { EventBus } from '../game/EventBus';
import {
    OUT_UI_SET_CAMERA_ZOOM,
    OUT_UI_SET_MUSIC_VOLUME,
    OUT_UI_SET_SOUND_VOLUME,
} from '../constants/EventNames';

/**
 * Represents the saved game state structure stored in localStorage.
 */
interface GameStateStorage {
    /** Stable client identity used for reconnect authentication */
    networkId?: string;
    /** Last-used character display name from the connect dialog; persisted after a successful login */
    characterName?: string;
    /** Camera zoom level as percentage (20-200, where 100 = zoom 1.0) */
    cameraZoom: number;
    /** Music volume (0-100) */
    musicVolume: number;
    /** Sound volume (0-100) */
    soundVolume: number;
}

/**
 * Manages game state persistence to localStorage.
 * Provides methods to update individual state fields and save the complete state.
 */
export class GameStateManager {
    /** Stable client identity used for reconnect authentication */
    private networkId = GameStateManager.createNetworkId();
    /** Last-used character display name from the connect dialog */
    private characterName: string | undefined;
    /** Camera zoom level as percentage (20-200, where 100 = zoom 1.0) */
    private cameraZoom = 100;
    /** Music volume (0-100) */
    private musicVolume = 50;
    /** Sound volume (0-100) */
    private soundVolume = 50;

    private readonly STORAGE_KEY = 'gameState';

    private static createNetworkId(): string {
        return crypto.randomUUID();
    }

    constructor() {
        let shouldPersist = false;

        // Load all fields from localStorage
        try {
            const gameStateJson = localStorage.getItem(this.STORAGE_KEY);
            if (gameStateJson) {
                // localStorage returns string; JSON.parse returns unknown. Cast to Partial<GameStateStorage>
                // after parse - we validate each field below before use.
                const gameState = JSON.parse(gameStateJson) as Partial<GameStateStorage> & {
                    gender?: unknown;
                    skinColor?: unknown;
                    underwearColorIndex?: unknown;
                    hairStyleIndex?: unknown;
                    attackType?: unknown;
                    attackMode?: unknown;
                    runMode?: unknown;
                };
                this.networkId = typeof gameState.networkId === 'string' && gameState.networkId.length > 0
                    ? gameState.networkId
                    : this.networkId;
                shouldPersist = gameState.networkId !== this.networkId;
                if (typeof gameState.characterName === 'string' && gameState.characterName.trim().length > 0) {
                    this.characterName = gameState.characterName.trim();
                }
                this.cameraZoom = (gameState.cameraZoom !== undefined && gameState.cameraZoom >= 20 && gameState.cameraZoom <= 200)
                    ? gameState.cameraZoom
                    : this.cameraZoom;
                this.musicVolume = (gameState.musicVolume !== undefined && gameState.musicVolume >= 0 && gameState.musicVolume <= 100)
                    ? gameState.musicVolume
                    : this.musicVolume;
                this.soundVolume = (gameState.soundVolume !== undefined && gameState.soundVolume >= 0 && gameState.soundVolume <= 100)
                    ? gameState.soundVolume
                    : this.soundVolume;
                // Drop stale pre-server-authority inventory persistence on the next save.
                const legacyInventoryState = gameState as Partial<{
                    equippedItems: unknown;
                    baggedItems: unknown;
                    nextItemUid: unknown;
                }>;
                shouldPersist ||= legacyInventoryState.equippedItems !== undefined
                    || legacyInventoryState.baggedItems !== undefined
                    || legacyInventoryState.nextItemUid !== undefined;
                // Server-authority fields: rewrite localStorage without legacy keys.
                if (gameState.gender !== undefined
                    || gameState.skinColor !== undefined
                    || gameState.underwearColorIndex !== undefined
                    || gameState.hairStyleIndex !== undefined
                    || gameState.attackType !== undefined
                    || gameState.attackMode !== undefined
                    || gameState.runMode !== undefined) {
                    shouldPersist = true;
                }
            } else {
                shouldPersist = true;
            }
        } catch (error) {
            console.warn('[GameStateManager] Failed to load game state from localStorage:', error);
            shouldPersist = true;
        }

        if (shouldPersist) {
            this.saveGameState();
        }

        // Emit events to sync React layer state
        EventBus.emit(OUT_UI_SET_CAMERA_ZOOM, this.cameraZoom);
        EventBus.emit(OUT_UI_SET_MUSIC_VOLUME, this.musicVolume);
        EventBus.emit(OUT_UI_SET_SOUND_VOLUME, this.soundVolume);
    }

    /**
     * Saves the current game state to localStorage.
     */
    public saveGameState(): void {
        try {
            const gameState: GameStateStorage = {
                networkId: this.networkId,
                cameraZoom: this.cameraZoom,
                musicVolume: this.musicVolume,
                soundVolume: this.soundVolume,
            };
            if (this.characterName !== undefined && this.characterName.length > 0) {
                gameState.characterName = this.characterName;
            }
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(gameState));
            console.log('[GameStateManager] Saved game state:', gameState);
        } catch (error) {
            console.warn('[GameStateManager] Failed to save game state to localStorage:', error);
        }
    }

    /**
     * Sets the camera zoom level as percentage (20-200, where 100 = zoom 1.0).
     * Call this every time camera zoom changes.
     */
    public setCameraZoom(zoom: number): void {
        this.cameraZoom = zoom >= 20 && zoom <= 200 ? zoom : this.cameraZoom;
    }

    /**
     * Sets the music volume (0-100).
     * Call this every time music volume slider changes.
     */
    public setMusicVolume(volume: number): void {
        this.musicVolume = volume >= 0 && volume <= 100 ? volume : this.musicVolume;
    }

    public getNetworkId(): string {
        return this.networkId;
    }

    /** Returns the last persisted character name from the connect dialog, if any. */
    public getCharacterName(): string | undefined {
        return this.characterName;
    }

    /** Persists the character name to localStorage after a successful server connection. */
    public setCharacterName(name: string): void {
        const trimmed = name.trim();
        if (trimmed.length === 0) {
            return;
        }
        this.characterName = trimmed;
        this.saveGameState();
    }

    /**
     * Gets the camera zoom level as percentage (20-200, where 100 = zoom 1.0).
     */
    public getCameraZoom(): number {
        return this.cameraZoom;
    }

    /**
     * Gets the music volume (0-100).
     */
    public getMusicVolume(): number {
        return this.musicVolume;
    }

    /**
     * Sets the sound volume (0-100).
     * Call this every time sound volume slider changes.
     */
    public setSoundVolume(volume: number): void {
        this.soundVolume = volume >= 0 && volume <= 100 ? volume : this.soundVolume;
    }

    /**
     * Gets the sound volume (0-100).
     */
    public getSoundVolume(): number {
        return this.soundVolume;
    }
}
