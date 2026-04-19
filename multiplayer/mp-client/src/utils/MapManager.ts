import type { Scene } from 'phaser';
import { HBMap, TILE_SIZE } from '../game/assets/HBMap';
import type { GameAsset } from '../game/objects/GameAsset';
import type { Player } from '../game/objects/Player';
import { convertWorldPosToPixelPos, convertPixelPosToWorldPos } from './CoordinateUtils';
import {
    MAP_OBJECT_COLLISION_ALPHA,
    MAP_OBJECT_COLLISION_GRID_RADIUS_CELLS,
    MAP_OBJECT_COLLISION_RADIUS_CELLS,
} from '../Config';
import { EventBus } from '../game/EventBus';
import { DOWNLOAD_MAP_SNAPSHOT, GENERATE_MINIMAP, MAP_SNAPSHOT_SHRINK_MULTIPLIER } from '../Config';
import { getMap, getCachedMinimap, setCachedMinimap } from './RegistryUtils';
import { getMusicManager } from './RegistryUtils';
import { getMapData } from '../constants/Maps';
import { Minimap } from '../constants/Assets';
import { OUT_UI_MINIMAP_CAPTURED, OUT_UI_MINIMAP_LOADING, OUT_UI_SET_SELECTED_MUSIC } from '../constants/EventNames';

export interface MapManagerConfig {
    scene: Scene;
    cameraManager?: {
        setBounds: (width: number, height: number) => void;
        setZoom: (zoom: number) => void;
    };
    /** Initial map filename (e.g. 'aresden.amd') when provided by server */
    initialMapName?: string;
    /** Initial music file (e.g. 'aresden.mp3') when provided by server */
    initialMusicFile?: string;
    /** Whether to play map music when map loads */
    playMapMusic?: boolean;
    /** Called before taking minimap snapshot (e.g. to hide loading overlay) */
    onBeforeSnapshot?: () => void;
    /** Called after taking minimap snapshot (e.g. to restore loading overlay) */
    onAfterSnapshot?: () => void;
}

/**
 * Manages map loading, rendering, and minimap capture.
 */
export class MapManager {
    private scene: Scene;
    private cameraManager: MapManagerConfig['cameraManager'] | undefined;
    private initialMapName: string | undefined;
    private initialMusicFile: string | undefined;
    private playMapMusic: boolean;
    private onBeforeSnapshot?: () => void;
    private onAfterSnapshot?: () => void;

    /** Whether minimap capture is in progress (prevents setZoom from updating GameStateManager) */
    private capturingMinimap = false;

    constructor(config: MapManagerConfig) {
        this.scene = config.scene;
        this.cameraManager = config.cameraManager;
        this.initialMapName = config.initialMapName;
        this.initialMusicFile = config.initialMusicFile;
        this.playMapMusic = config.playMapMusic ?? true;
        this.onBeforeSnapshot = config.onBeforeSnapshot;
        this.onAfterSnapshot = config.onAfterSnapshot;
    }

    /**
     * Sets the camera manager (call after CameraManager is created to resolve init order).
     */
    public setCameraManager(cameraManager: MapManagerConfig['cameraManager']): void {
        this.cameraManager = cameraManager;
    }

    public setInitialMusicFile(musicFile: string | undefined): void {
        this.initialMusicFile = musicFile;
    }

    /**
     * Returns the current map name (e.g. 'aresden.amd').
     * Must be provided by server via InitialGameWorldState.mapName.
     */
    public getCurrentMapName(): string {
        if (!this.initialMapName) {
            throw new Error('[MapManager] Map name must be provided by server (InitialGameWorldState.mapName)');
        }
        return this.initialMapName;
    }

    /**
     * Returns the current map. Uses initialMapName when provided (from server), otherwise GameStateManager.
     */
    public getCurrentMap(): HBMap {
        return getMap(this.scene, this.getCurrentMapName());
    }

    /**
     * Returns whether minimap capture is currently in progress.
     */
    public isCapturingMinimap(): boolean {
        return this.capturingMinimap;
    }

    /**
     * Resets the capturing state (e.g. on shutdown).
     */
    public resetCapturingState(): void {
        this.capturingMinimap = false;
    }

    /**
     * Renders map tiles and objects, sets up camera, optionally captures minimap.
     * Calls finishedCallback with the map when done.
     *
     * @param finishedCallback - Called when map setup (and minimap capture if enabled) is complete
     */
    public startMinimapCapture(finishedCallback: (map: HBMap) => void): void {
        const map = this.getCurrentMap();
        const mapFileName = this.getCurrentMapName();
        const mapData = getMapData(mapFileName);
        const minimapType = mapData?.minimap ?? Minimap.ON_DEMAND_GENERATED;

        // Notify UI that minimap is loading (shows "Loading minimap")
        EventBus.emit(OUT_UI_MINIMAP_LOADING, {
            minimap: minimapType,
            mapName: mapFileName,
            mapSizeX: map.sizeX,
            mapSizeY: map.sizeY,
        });

        // Render map tiles and objects
        map.renderMapTiles(this.scene);
        map.renderMapObjects(this.scene);

        // Set up camera
        this.cameraManager?.setBounds(map.sizeX * TILE_SIZE, map.sizeY * TILE_SIZE);
        this.cameraManager?.setZoom(1);

        // Play music for the current map when map loads (if enabled)
        if (this.playMapMusic && this.initialMusicFile) {
            this.playInitialMusic();
        }

        const shouldGenerateMinimap = GENERATE_MINIMAP && minimapType === Minimap.ON_DEMAND_GENERATED;
        if (shouldGenerateMinimap) {
            this.captureMinimap(map, () => finishedCallback(map));
        } else {
            finishedCallback(map);
        }
    }

    public playInitialMusic(): void {
        const musicFile = this.initialMusicFile || 'default.mp3';
        getMusicManager(this.scene).playMusic(musicFile);
        EventBus.emit(OUT_UI_SET_SELECTED_MUSIC, musicFile);
    }

    /**
     * Captures a minimap image of the entire game world.
     * Temporarily zooms out the camera to capture the full map, then scales down the image.
     * Emits the minimap image to React layer via EventBus.
     * Uses cache to avoid regenerating minimap if it already exists for the current map.
     *
     * @param map - The HBMap instance containing map dimensions
     * @param finishedCallback - Callback function to execute after minimap capture is complete
     */
    public captureMinimap(map: HBMap, finishedCallback: () => void): void {
        const mapName = this.getCurrentMapName();

        const cachedMinimap = getCachedMinimap(this.scene, mapName);
        if (cachedMinimap) {
            console.log(`[MapManager] Using cached minimap for ${mapName}`);
            EventBus.emit(OUT_UI_MINIMAP_CAPTURED, {
                dataUrl: cachedMinimap.dataUrl,
                scale: cachedMinimap.scale,
                originalSize: cachedMinimap.originalSize
            });
            this.scene.time.delayedCall(0, finishedCallback);
            return;
        }

        console.log(`[MapManager] Generating minimap for ${mapName}`);
        const mapWidth = map.sizeX * TILE_SIZE;
        const mapHeight = map.sizeY * TILE_SIZE;

        this.capturingMinimap = true;

        const originalScrollX = this.scene.cameras.main.scrollX;
        const originalScrollY = this.scene.cameras.main.scrollY;

        const configWidth = this.scene.game.config.width;
        const configHeight = this.scene.game.config.height;
        const gameWidth = typeof configWidth === 'number' ? configWidth : parseInt(String(configWidth), 10);
        const gameHeight = typeof configHeight === 'number' ? configHeight : parseInt(String(configHeight), 10);

        const zoomX = gameWidth / mapWidth;
        const zoomY = gameHeight / mapHeight;
        const fitZoom = Math.min(zoomX, zoomY);

        const minimapWidth = Math.ceil(Math.min(mapWidth * fitZoom, gameWidth));
        const minimapHeight = Math.ceil(Math.min(mapHeight * fitZoom, gameHeight));

        console.log(`[MapManager] Creating minimap: map size ${mapWidth}x${mapHeight}, canvas ${gameWidth}x${gameHeight}`);
        console.log(`[MapManager] Fit zoom: ${fitZoom}, minimap size ${minimapWidth}x${minimapHeight}`);

        this.cameraManager?.setZoom(fitZoom);

        this.scene.time.delayedCall(50, () => {
            this.onBeforeSnapshot?.();

            this.scene.time.delayedCall(20, () => {
                const doMinimap = () =>
                    this.takeMinimapSnapshot(map, mapName, fitZoom, minimapWidth, minimapHeight, originalScrollX, originalScrollY, finishedCallback);

                if (DOWNLOAD_MAP_SNAPSHOT) {
                    this.captureAndDownloadFullResolution(map, mapName, doMinimap);
                } else {
                    doMinimap();
                }
            });
        });
    }

    private takeMinimapSnapshot(
        map: HBMap,
        mapName: string,
        fitZoom: number,
        minimapWidth: number,
        minimapHeight: number,
        originalScrollX: number,
        originalScrollY: number,
        finishedCallback: () => void
    ): void {
        const mapWidth = map.sizeX * TILE_SIZE;
        const mapHeight = map.sizeY * TILE_SIZE;

        this.scene.game.renderer.snapshot((image: Phaser.Display.Color | HTMLImageElement) => {
            this.onAfterSnapshot?.();

            if (image instanceof HTMLImageElement) {
                const renderedWidth = Math.ceil(mapWidth * fitZoom);
                const renderedHeight = Math.ceil(mapHeight * fitZoom);

                console.log(`[MapManager] Snapshot size: ${image.width}x${image.height}`);
                console.log(`[MapManager] Rendered map on canvas: ${renderedWidth}x${renderedHeight} at offset (0, 0)`);

                const canvas = document.createElement('canvas');
                canvas.width = minimapWidth;
                canvas.height = minimapHeight;
                const ctx = canvas.getContext('2d', { alpha: false });

                if (ctx) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';

                    ctx.drawImage(
                        image,
                        0, 0,
                        renderedWidth,
                        renderedHeight,
                        0, 0,
                        minimapWidth,
                        minimapHeight
                    );

                    const dataUrl = canvas.toDataURL('image/png');

                    const scaleFactorX = minimapWidth / mapWidth;
                    const scaleFactorY = minimapHeight / mapHeight;
                    const scaleFactor = Math.min(scaleFactorX, scaleFactorY);

                    console.log(`[MapManager] Minimap captured: ${canvas.width}x${canvas.height}, scale: ${scaleFactor}`);

                    const originalSize = canvas.width;
                    setCachedMinimap(this.scene, mapName, { dataUrl, scale: scaleFactor, originalSize });
                    console.log(`[MapManager] Cached minimap for ${mapName}`);

                    EventBus.emit(OUT_UI_MINIMAP_CAPTURED, { dataUrl, scale: scaleFactor, originalSize });
                }
            }

            this.scene.cameras.main.setScroll(originalScrollX, originalScrollY);
            this.capturingMinimap = false;

            this.scene.time.delayedCall(50, finishedCallback);
        });
    }

    /**
     * Captures the scene by temporarily resizing the game canvas to (mapWidth/shrink) x (mapHeight/shrink),
     * using the normal render pipeline so tiles and objects render correctly. Stays within WebGL limits.
     * Runs before minimap so overlay stays hidden and trees/player are not yet in the scene.
     *
     * @param onComplete - Called after capture and restore; used to run minimap capture next.
     */
    private captureAndDownloadFullResolution(map: HBMap, mapName: string, onComplete: () => void): void {
        const mapWidth = map.sizeX * TILE_SIZE;
        const mapHeight = map.sizeY * TILE_SIZE;
        const shrink = Math.max(1, MAP_SNAPSHOT_SHRINK_MULTIPLIER);
        const captureWidth = Math.floor(mapWidth / shrink);
        const captureHeight = Math.floor(mapHeight / shrink);

        const configWidth = this.scene.game.config.width;
        const configHeight = this.scene.game.config.height;
        const gameWidth = typeof configWidth === 'number' ? configWidth : parseInt(String(configWidth), 10);
        const gameHeight = typeof configHeight === 'number' ? configHeight : parseInt(String(configHeight), 10);

        const savedZoom = this.scene.cameras.main.zoom;
        const savedScrollX = this.scene.cameras.main.scrollX;
        const savedScrollY = this.scene.cameras.main.scrollY;

        // Zoom so full map fits in capture viewport: visible world = viewport / zoom
        const fitZoom = Math.min(captureWidth / mapWidth, captureHeight / mapHeight);

        const doSnapshot = () => {
            this.scene.game.renderer.snapshot((image: Phaser.Display.Color | HTMLImageElement) => {
                this.scene.scale.resize(gameWidth, gameHeight);
                this.scene.cameras.resize(gameWidth, gameHeight);
                this.cameraManager?.setZoom(savedZoom);
                this.scene.cameras.main.setScroll(savedScrollX, savedScrollY);

                if (image instanceof HTMLImageElement) {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(image, 0, 0);
                        const link = document.createElement('a');
                        link.href = canvas.toDataURL('image/png');
                        link.download = `map-${mapName}-full.png`;
                        link.click();
                        console.log(`[MapManager] Map snapshot downloaded: ${image.width}x${image.height}px (shrink ${shrink}x from ${mapWidth}x${mapHeight})`);
                    }
                }
                onComplete();
            }, 'image/png');
        };

        const applyResizeAndCapture = () => {
            this.scene.scale.resize(captureWidth, captureHeight);
            this.scene.cameras.resize(captureWidth, captureHeight);
            this.scene.cameras.main.setScroll(0, 0);
            this.scene.cameras.main.setZoom(fitZoom);
            this.scene.cameras.main.setViewport(0, 0, captureWidth, captureHeight);
            // Wait for resize and one render frame before snapshot
            this.scene.time.delayedCall(100, doSnapshot);
        };

        applyResizeAndCapture();
    }

    /**
     * Map-object collision / transparency: when the player overlaps a static object and is behind it (lower depth),
     * fades the object. Uses the map spatial grid for candidate lookup.
     */
    public updateMapObjectCollisionsForPlayer(player: Player, previousColliding: Set<GameAsset>): Set<GameAsset> {
        const map = this.getCurrentMap();
        const spatialGrid = map.getSpatialGrid();

        const playerWorldX = player.getWorldX();
        const playerWorldY = player.getWorldY();
        const playerCellX = convertWorldPosToPixelPos(playerWorldX);
        const playerCellY = convertWorldPosToPixelPos(playerWorldY);
        const boundsRadiusCells = 1;
        const playerCellBounds = {
            x: playerCellX - boundsRadiusCells * TILE_SIZE,
            y: playerCellY - 4 * TILE_SIZE,
            width: TILE_SIZE * (1 + boundsRadiusCells * 2),
            height: TILE_SIZE * 5,
        };

        const playerDepth = player.getDepth();

        const candidateObjects = spatialGrid.getNearby(playerCellX, playerCellY, MAP_OBJECT_COLLISION_GRID_RADIUS_CELLS);

        const radiusSquared = MAP_OBJECT_COLLISION_RADIUS_CELLS * MAP_OBJECT_COLLISION_RADIUS_CELLS;
        const nearbyMapObjects = candidateObjects.filter((mapObject) => {
            const mapObjectPixelX = mapObject.sprite.x;
            const mapObjectPixelY = mapObject.sprite.y;
            const mapObjectWorldX = convertPixelPosToWorldPos(mapObjectPixelX);
            const mapObjectWorldY = convertPixelPosToWorldPos(mapObjectPixelY);
            const dx = mapObjectWorldX - playerWorldX;
            const dy = mapObjectWorldY - playerWorldY;
            return dx * dx + dy * dy <= radiusSquared;
        });

        const currentlyColliding = new Set<GameAsset>();

        for (const mapObject of nearbyMapObjects) {
            const mapObjectBounds = mapObject.getBounds();
            const mapObjectDepth = mapObject.getDepth();
            const isColliding = MapManager.rectanglesIntersect(playerCellBounds, mapObjectBounds);

            if (isColliding) {
                currentlyColliding.add(mapObject);
                if (playerDepth < mapObjectDepth) {
                    mapObject.setAlpha(MAP_OBJECT_COLLISION_ALPHA);
                } else {
                    mapObject.setAlpha(1.0);
                }
            } else if (previousColliding.has(mapObject)) {
                mapObject.setAlpha(1.0);
            }
        }

        for (const mapObject of previousColliding) {
            if (!currentlyColliding.has(mapObject)) {
                mapObject.setAlpha(1.0);
            }
        }

        return currentlyColliding;
    }

    private static rectanglesIntersect(
        rect1: { x: number; y: number; width: number; height: number },
        rect2: { x: number; y: number; width: number; height: number },
    ): boolean {
        return (
            rect1.x < rect2.x + rect2.width &&
            rect1.x + rect1.width > rect2.x &&
            rect1.y < rect2.y + rect2.height &&
            rect1.y + rect1.height > rect2.y
        );
    }
}
