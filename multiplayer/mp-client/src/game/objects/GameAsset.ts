import type { GameObjects, Scene } from 'phaser';
import { ShadowManager } from '../../utils/ShadowManager';
import { canvasToScreenPosition, CELL_CENTER_PIXEL_OFFSET, convertPixelPosToWorldPos } from '../../utils/CoordinateUtils';
import { GameAssetVisualEffect, getFrameNameFromSpriteFrame } from '../../utils/GameAssetVisualEffect';
import { EventBus } from '../EventBus';
import type { PivotFrame } from '../../Types';
import {
    HIGH_DEPTH,
    LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND,
    PLAYER_ITEM_APPEARANCE_PENDING_TEXTURE,
    SPRITES_WITH_SHADOWS,
} from '../../Config';
import { getItemEquippedAppearanceSpriteNames } from '../../constants/Assets';
import { getPivotData, isDebugModeEnabled } from '../../utils/RegistryUtils';
import { isTreeSpriteIndex } from '../../utils/SpriteUtils';
import { IN_DEBUG_MODE_CHANGE, OUT_UI_HOVER_SPRITE_FRAME_DEBUG } from '../../constants/EventNames';
import type { Effect } from '../../constants/Items';

/**
 * Represents a single frame or animation that can be drawn on the scene.
 * Uses Helbreath sprite format: pivot points, directional animations, optional debug visualization.
 */
export class GameAsset {
    /** The Phaser sprite object that renders the asset */
    public readonly sprite: GameObjects.Sprite;

    /** The Phaser scene this asset belongs to */
    public scene: Scene;

    /** The base x coordinate before pivot offset is applied */
    private baseX: number;

    /** The base y coordinate before pivot offset is applied */
    private baseY: number;

    /** Array of pivot data for each frame in the sprite sheet */
    private spriteSheetPivots: PivotFrame[] | undefined;

    /** The starting frame index for the current direction (if directional) */
    private directionStartFrame?: number;

    /** The ending frame index for the current direction (if directional) */
    private directionEndFrame?: number;

    /** Whether the current animation should loop (true for looping, false for non-looping) */
    private isAnimationLooping: boolean = true;

    /** Animation type controlling frame playback behavior */
    private animationType: AnimationType = AnimationType.FullFrame;

    /** Starting frame index for SubFrame animations */
    private animationFrameStartIndex: number = 0;

    /** Re-entrancy guard to prevent infinite recursion when setCurrentFrame triggers ANIMATION_UPDATE */
    private _isHandlingFrameLimit: boolean = false;

    /** Graphics object used for debug visualization */
    private debugGraphics: GameObjects.Graphics;

    /** Whether this asset is non-animated (has a fixed frameIndex) */
    private isNonAnimated = false;

    /** The frame index for non-animated sprites */
    private fixedFrameIndex?: number;

    /** The sprite name (without extension) */
    private spriteName: string;

    /** The sprite sheet index within the sprite file */
    private spriteSheetIndex?: number;

    /** Equipped item layer waiting for lazy `.spr` load; invisible placeholder until promoted. */
    private pendingLazyPlayerItemAppearance = false;

    /** Shadow manager for rendering shadow beneath the asset (when enabled) */
    private shadowManager: ShadowManager | undefined = undefined;

    /** Tree shadow GameAsset for trees (sprite index 100-145) */
    private treeShadowAsset: GameAsset | undefined = undefined;

    /** Whether the cursor is currently hovering over this sprite */
    private isHovering = false;

    /** Handler function for pointerover event - stored so we can deregister it */
    private pointerOverHandler?: () => void;

    /** Handler function for pointerout event - stored so we can deregister it */
    private pointerOutHandler?: () => void;

    /** Handler function for pointermove event - stored so we can deregister it */
    private pointerMoveHandler?: () => void;

    /** Stable handler for `changedata-debug-mode` (Phaser emits parent, new value, previous value). */
    private debugModeChangeHandler = (_parent: unknown, value: boolean) => {
        this.onDebugModeChange(value);
    };

    /** Callback from config, invoked when animation reaches a new frame (not invoked during construction) */
    private onAnimationFrameChangeCallback?: (relativeFrameIndex: number) => void;

    /** Guards callback invocation until construction completes (avoids accessing parent's this before super() returns) */
    private _constructionComplete = false;

    /** Previous frame index for detecting frame changes */
    private previousFrameIndex: number = -1;

    /** Item/status overlays and tints (glare, glow, saturate, spawn protection). */
    private visualEffects: GameAssetVisualEffect;

    /** Ghost sprite for trail effect during movement (semi-transparent copy behind main sprite). */
    private ghostSprite: GameObjects.Sprite | undefined;

    /**
     * Creates a new GameAsset instance.
     * Sets up the sprite, loads pivot data, configures animations, and initializes debug tools.
     * 
     * @param scene - The Phaser scene to add the asset to
     * @param config - Configuration object specifying position, sprite, and animation settings
     */
    constructor(scene: Scene, config: GameAssetConfig) {
        this.scene = scene;
        this.baseX = config.x;
        this.baseY = config.y;
        this.spriteName = config.spriteName;
        this.spriteSheetIndex = config.spriteSheetIndex;

        // Validate spriteSheetIndex requirement
        if (!config.mapObject && config.spriteSheetIndex === undefined) {
            throw new Error('spriteSheetIndex is required when mapObject is not true');
        }

        // Build texture key based on whether this is a map object
        let textureKey: string;
        let animationKey: string;

        const usePendingItemPlaceholder = config.pendingLazyPlayerItemAppearance === true;

        if (config.mapObject) {
            // Map objects: Phaser texture key is the basename (e.g. `map-tile-123`), not `sprite-*`.
            textureKey = config.spriteName;
            animationKey = config.spriteName;
        } else if (usePendingItemPlaceholder) {
            textureKey = PLAYER_ITEM_APPEARANCE_PENDING_TEXTURE;
            animationKey = textureKey;
            this.pendingLazyPlayerItemAppearance = true;
        } else {
            textureKey = `sprite-${config.spriteName}-${config.spriteSheetIndex}`;
            animationKey = textureKey;
        }

        // Check if texture exists
        if (!usePendingItemPlaceholder && !scene.textures.exists(textureKey)) {
            throw new Error(`Texture "${textureKey}" does not exist`);
        }

        // Check if frame index exists in texture (if frameIndex is specified)
        if (!usePendingItemPlaceholder && config.frameIndex !== undefined) {
            const texture = scene.textures.get(textureKey);
            if (!texture.has(String(config.frameIndex))) {
                throw new Error(`Frame index ${config.frameIndex} does not exist in texture "${textureKey}"`);
            }
        }

        // Initialize animation type and looping behavior
        this.animationType = config.animationType ?? AnimationType.FullFrame;
        this.animationFrameStartIndex = config.animationFrameStartIndex ?? 0;
        this.isAnimationLooping = config.isLooping ?? true;

        // Calculate directional frame range if direction is specified
        if (config.direction !== undefined) {
            const framesPerDirection = config.framesPerDirection ?? 8;
            this.directionStartFrame = config.direction * framesPerDirection;
            this.directionEndFrame = this.directionStartFrame + framesPerDirection - 1;
        }

        // Store callback from config (not invoked during construction to avoid parent accessing this before super() returns)
        this.onAnimationFrameChangeCallback = config.onAnimationFrameChange;

        // Retrieve pivot data from global registry
        if (!usePendingItemPlaceholder) {
            const pivotData = getPivotData(scene, textureKey, config.spriteName, config.mapObject ?? false);

            if (config.mapObject) {
                // For map objects, the pivot data is stored as a single sprite sheet (index 0)
                if (pivotData && pivotData.spriteSheetPivots[0]) {
                    this.spriteSheetPivots = pivotData.spriteSheetPivots[0];
                }
            } else {
                // For regular sprites, use the sprite sheet index
                if (pivotData && config.spriteSheetIndex !== undefined && pivotData.spriteSheetPivots[config.spriteSheetIndex]) {
                    this.spriteSheetPivots = pivotData.spriteSheetPivots[config.spriteSheetIndex];
                }
            }
        }

        // Check if this is a tree (sprite index 100-145) and create tree shadow before rendering tree
        this.applyShadowIfTree(config);

        // Create sprite at given coordinates
        if (config.frameIndex !== undefined) {
            this.sprite = scene.add.sprite(config.x, config.y, textureKey, config.frameIndex);
            this.isNonAnimated = true;
            this.fixedFrameIndex = config.frameIndex;
        } else {
            this.sprite = scene.add.sprite(config.x, config.y, textureKey);
        }

        this.sprite.setOrigin(0, 0); // Set anchor point to top-left

        // Must exist before applyPivotOffset (syncs overlay positions when pivots move the sprite).
        this.visualEffects = new GameAssetVisualEffect(this.scene, this.sprite, () => this.fixedFrameIndex);

        if (config.frameIndex !== undefined) {
            this.applyPivotOffset(config.frameIndex);
        }

        if (usePendingItemPlaceholder) {
            this.sprite.setVisible(false);
        }

        if (config.alpha !== undefined) {
            this.sprite.setAlpha(config.alpha ?? 1);
        }

        if (config.tint !== undefined) {
            this.sprite.setTint(config.tint);
        }

        this.visualEffects.setItemEffects(config.effects);

        // Always create debug graphics, but control visibility based on global setting and hover state
        // Use very high depth (50000) to ensure debug info always renders on top of other sprites
        this.debugGraphics = scene.add.graphics().setDepth(HIGH_DEPTH);

        // Pointer event listeners for hover detection will be registered only when debug mode is enabled
        // See enableHoverDetection() and disableHoverDetection() methods

        // Set initial visibility based on global debug setting and hover state
        this.updateDebugVisibility();

        // Set up animation event listeners for pivot correction and frame limiting
        this.sprite.on(Phaser.Animations.Events.ANIMATION_START, (_anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
            this.applyFramePivotOffset(frame);
            this.updateDebug(frame);
            this.emitAnimationFrameChange(frame);
        });
        this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, (_anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
            this.applyFramePivotOffset(frame);
            this.handleDirectionalFrameLimit(frame);
            this.updateDebug(frame);
            this.emitAnimationFrameChange(frame);
        });

        // Check initial debug mode state and enable/disable interactivity accordingly
        if (isDebugModeEnabled(scene)) {
            this.enableHoverDetection();
        }

        // Listen for global debug mode changes
        scene.registry.events.on(IN_DEBUG_MODE_CHANGE, this.debugModeChangeHandler);

        // Play animation if it exists
        if (!usePendingItemPlaceholder && config.frameIndex === undefined) {
            if (scene.anims.exists(animationKey)) {
                // Constructor animations are typically looping (no repeat specified means default/infinite)
                this.isAnimationLooping = true;
                this.sprite.play({
                    key: animationKey,
                    startFrame: this.directionStartFrame ?? 0,
                    frameRate: config.frameRate ?? 10
                });
            } else {
                console.warn(`Animation key "${animationKey}" does not exist. Sprite created but not animating.`);
            }
        }

        // Create shadow for sprites that have shadows enabled
        if (!usePendingItemPlaceholder) {
            this.drawShadowIfNecessary(config);
        }

        this._constructionComplete = true;
    }

    /** Minimal frame stand-in for static sprites so debug overlay matches animated path. */
    private createMockFrame(frameIndex: number): Phaser.Animations.AnimationFrame {
        return {
            index: frameIndex,
            textureFrame: frameIndex,
            frame: { name: String(frameIndex) } as Phaser.Textures.Frame
        } as Phaser.Animations.AnimationFrame;
    }

    /**
     * Sets or clears item effects (e.g. glare, glow, tint appearance). Call when equipped item changes.
     */
    public setItemEffects(effects?: Effect[]): void {
        this.visualEffects.setItemEffects(effects);
    }

    /**
     * Sets or clears saturate overlay (berserk, etc.).
     */
    public setSaturateOverlay(enabled: boolean, color: number = 0xff4444, alpha: number = 0.5): void {
        this.visualEffects.setSaturateOverlay(enabled, color, alpha);
    }

    public setChilledTint(chilled: boolean): void {
        this.visualEffects.setChilledTint(chilled);
    }

    public setDisconnectedTint(disconnected: boolean): void {
        this.visualEffects.setDisconnectedTint(disconnected);
    }

    public setSpawnProtectionGlow(enabled: boolean): void {
        this.visualEffects.setSpawnProtectionGlow(enabled);
    }

    /**
     * Checks if this is a tree (sprite index 100-145) and creates a tree shadow if applicable.
     * 
     * @param config - The configuration object used to create this GameAsset
     */
    private applyShadowIfTree(config: GameAssetConfig): void {
        if (!config.mapObject) {
            return;
        }

        // Extract sprite index from spriteName (e.g., "map-tile-100" -> 100)
        const spriteIndexMatch = config.spriteName.match(/^map-tile-(\d+)$/);
        if (!spriteIndexMatch) {
            return;
        }

        const spriteIndex = parseInt(spriteIndexMatch[1], 10);

        // If sprite index is between 100 and 145, it's a tree - render tree shadow
        if (!isTreeSpriteIndex(spriteIndex)) {
            return;
        }

        const shadowSpriteIndex = spriteIndex + 50; // Shadow sprite index = tree sprite index + 50
        const shadowX = config.x + CELL_CENTER_PIXEL_OFFSET;
        const shadowY = config.y + CELL_CENTER_PIXEL_OFFSET;

        try {
            // Create tree shadow GameAsset before the tree
            this.treeShadowAsset = new GameAsset(this.scene, {
                x: shadowX,
                y: shadowY,
                spriteName: `map-tile-${shadowSpriteIndex}`,
                mapObject: true,
                frameIndex: config.frameIndex, // Use same frame as tree
                alpha: 0.5 // Set transparency to match player shadows (50% opacity)
            });

            // Set shadow depth to render below the tree (will be updated when tree depth is set)
            // We'll update this in setDepth() method
        } catch (error) {
            console.warn(`Failed to create tree shadow for tree sprite ${spriteIndex}:`, error);
            this.treeShadowAsset = undefined;
        }
    }

    /**
     * Creates shadow for sprites that have shadows enabled.
     * 
     * @param config - The configuration object used to create this GameAsset
     */
    private drawShadowIfNecessary(config: GameAssetConfig): void {
        // Create shadow for sprites that have shadows enabled
        if (SPRITES_WITH_SHADOWS.includes(this.spriteName)) {
            // Map objects should have static shadows (no animation, no frame rate)
            const isMapObject = config.mapObject ?? false;

            this.shadowManager = new ShadowManager({
                scene: this.scene,
                shadowSpriteName: this.spriteName,
                shadowSpriteSheetIndex: config.mapObject ? 0 : (config.spriteSheetIndex ?? 0),
                worldX: convertPixelPosToWorldPos(config.x),
                worldY: convertPixelPosToWorldPos(config.y),
                // Don't set frameRate for map objects - they should be static
                frameRate: isMapObject ? undefined : (config.frameRate ?? 10),
                mapObject: isMapObject,
                // Use the same frameIndex as the GameAsset for map objects (if specified)
                frameIndex: isMapObject ? config.frameIndex : undefined,
            });

            // Update shadow position and depth initially
            this.updateShadowPosition();
            this.updateShadowDepth();
        }
    }

    /**
     * Enables hover detection by making the sprite interactive and registering event listeners.
     * This allows pointer events to be captured for debug visualization.
     * Only called when debug mode is enabled.
     */
    private enableHoverDetection(): void {
        try {
            // Always make sprite interactive when enabling hover detection
            // Even if sprite.input exists, it might be disabled from previous disableInteractive() call
            if (!this.sprite.input || !this.sprite.input.enabled) {
                // Make sprite interactive to receive pointer events for hover detection
                // Configure to allow pointer events to pass through to the scene so movement commands still work
                // By not listening to pointerdown/pointerup, we ensure those events reach the scene
                this.sprite.setInteractive({
                    useHandCursor: false,
                    pixelPerfect: false
                });
            }

            // Register event listeners only if they haven't been registered yet
            if (!this.pointerOverHandler) {
                this.pointerOverHandler = () => {
                    this.isHovering = true;
                    this.updateDebugVisibility();
                    // Immediately update debug text when hovering starts
                    if (isDebugModeEnabled(this.scene)) {
                        if (this.isNonAnimated && this.fixedFrameIndex !== undefined) {
                            this.updateDebug(this.createMockFrame(this.fixedFrameIndex));
                        } else if (this.sprite.anims && this.sprite.anims.currentFrame) {
                            this.updateDebug(this.sprite.anims.currentFrame);
                        }
                    }
                };

                this.pointerOutHandler = () => {
                    this.isHovering = false;
                    this.updateDebugVisibility();
                };

                this.pointerMoveHandler = () => {
                    // Continuously update debug info as mouse moves while hovering
                    if (this.isHovering) {
                        if (isDebugModeEnabled(this.scene)) {
                            if (this.isNonAnimated && this.fixedFrameIndex !== undefined) {
                                this.updateDebug(this.createMockFrame(this.fixedFrameIndex));
                            } else if (this.sprite.anims && this.sprite.anims.currentFrame) {
                                this.updateDebug(this.sprite.anims.currentFrame);
                            }
                        }
                    }
                };

                this.sprite.on('pointerover', this.pointerOverHandler);
                this.sprite.on('pointerout', this.pointerOutHandler);
                this.sprite.on('pointermove', this.pointerMoveHandler);
            }
        } catch (error) {
            console.error(`Error enabling hover detection for GameAsset: ${error}`);
        }
    }

    /**
     * Disables hover detection by removing interactivity from the sprite and de-registering event listeners.
     * This prevents pointer events from being captured, allowing movement commands to work unimpeded.
     * Called when debug mode is disabled.
     */
    private disableHoverDetection(): void {
        // Deregister event listeners if they were registered
        if (this.pointerOverHandler) {
            this.sprite.off('pointerover', this.pointerOverHandler);
            this.pointerOverHandler = undefined;
        }

        if (this.pointerOutHandler) {
            this.sprite.off('pointerout', this.pointerOutHandler);
            this.pointerOutHandler = undefined;
        }

        if (this.pointerMoveHandler) {
            this.sprite.off('pointermove', this.pointerMoveHandler);
            this.pointerMoveHandler = undefined;
        }

        if (this.sprite.input) {
            this.sprite.disableInteractive();
            // Reset hover state when disabling
            this.isHovering = false;
            this.updateDebugVisibility();
        }
    }

    private onDebugModeChange(value: boolean): void {
        // Enable or disable hover detection based on debug mode
        if (value) {
            this.enableHoverDetection();
        } else {
            this.disableHoverDetection();
        }

        this.updateDebugVisibility();
        // For non-animated sprites, update debug info when debug mode is toggled on and hovering
        if (value && this.isHovering && this.isNonAnimated && this.fixedFrameIndex !== undefined) {
            this.updateDebug(this.createMockFrame(this.fixedFrameIndex));
        } else if (value && this.isHovering && this.sprite.anims && this.sprite.anims.currentFrame) {
            this.updateDebug(this.sprite.anims.currentFrame);
        }
    }

    /**
     * Applies pivot offset to sprite position based on the current animation frame.
     * Extracts the frame index from the animation frame and calls applyPivotOffset.
     * 
     * @param frame - The current animation frame from Phaser's animation system
     */
    private applyFramePivotOffset(frame: Phaser.Animations.AnimationFrame): void {
        // Get frame index from frame
        const frameName = frame.textureFrame ?? frame.frame?.name ?? frame.index;
        const frameIndex = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);

        this.applyPivotOffset(frameIndex);
    }

    /**
     * Applies pivot offset to sprite position based on the frame index.
     * Looks up pivot data for the frame and adjusts sprite position accordingly.
     * Only applies offset if pivot data exists and frame dimensions are non-zero.
     * 
     * @param frameIndex - The index of the frame to get pivot data for
     */
    private applyPivotOffset(frameIndex: number): void {
        if (!this.spriteSheetPivots) {
            return;
        }

        // Look up pivot data by frame index
        const pivotData = this.spriteSheetPivots[frameIndex];
        if (!pivotData) {
            return;
        }

        const pivotX = (pivotData.width !== 0 && pivotData.height !== 0) ? pivotData.pivotX : 0;
        const pivotY = (pivotData.width !== 0 && pivotData.height !== 0) ? pivotData.pivotY : 0;

        // Apply pivot offset: add pivot to base position
        this.sprite.setPosition(this.baseX + pivotX, this.baseY + pivotY);

        this.visualEffects.syncOverlayPositionsToSprite();

        // Update shadow position if shadow is enabled
        this.updateShadowPosition();
    }

    private listFrameIndexFromAnimEntry(f: Phaser.Animations.AnimationFrame): number {
        const tf = f.textureFrame;
        if (typeof tf === 'number') {
            return tf;
        }
        if (f.frame?.name !== undefined && f.frame.name !== '') {
            return parseInt(String(f.frame.name), 10);
        }
        return f.index;
    }

    /** Keeps playback inside the active direction/window (see {@link AnimationType}). */
    private handleDirectionalFrameLimit(frame: Phaser.Animations.AnimationFrame): void {
        if (this._isHandlingFrameLimit) {
            return;
        }

        const frameName = frame.textureFrame ?? frame.frame?.name ?? frame.index;
        const frameIndex = typeof frameName === 'number' ? frameName : parseInt(String(frameName), 10);

        switch (this.animationType) {
            case AnimationType.DirectionalSubFrame: {
                if (this.directionStartFrame === undefined || this.directionEndFrame === undefined) {
                    return;
                }
                if (frameIndex >= this.directionStartFrame && frameIndex <= this.directionEndFrame) {
                    return;
                }
                const currentAnim = this.sprite.anims.currentAnim;
                if (!currentAnim?.frames) {
                    return;
                }
                const pastEnd = frameIndex > this.directionEndFrame;
                const targetFrameIndex = (!this.isAnimationLooping && pastEnd)
                    ? this.directionEndFrame
                    : this.directionStartFrame;
                const targetFrame = currentAnim.frames.find(
                    (f) => this.listFrameIndexFromAnimEntry(f) === targetFrameIndex
                );
                if (!targetFrame) {
                    return;
                }
                this._isHandlingFrameLimit = true;
                try {
                    this.sprite.anims.setCurrentFrame(targetFrame);
                    if (!this.isAnimationLooping && pastEnd) {
                        this.sprite.anims.stop();
                    }
                } finally {
                    this._isHandlingFrameLimit = false;
                }
                return;
            }
            case AnimationType.SubFrame: {
                if (this.directionStartFrame === undefined || this.directionEndFrame === undefined) {
                    return;
                }
                const actualStartFrame = this.directionStartFrame + this.animationFrameStartIndex;
                const actualEndFrame = this.directionEndFrame + this.animationFrameStartIndex;
                if (frameIndex >= actualStartFrame && frameIndex <= actualEndFrame) {
                    return;
                }
                if (!this.isAnimationLooping) {
                    return;
                }
                const currentAnim = this.sprite.anims.currentAnim;
                const targetFrame = currentAnim?.frames?.find((f: Phaser.Animations.AnimationFrame) => f.index === actualStartFrame)
                    ?? currentAnim?.frames?.[actualStartFrame];
                if (!targetFrame?.frame) {
                    return;
                }
                this._isHandlingFrameLimit = true;
                try {
                    this.sprite.anims.setCurrentFrame(targetFrame);
                } finally {
                    this._isHandlingFrameLimit = false;
                }
                return;
            }
            case AnimationType.FullFrame:
            default: {
                if (!this.isAnimationLooping) {
                    return;
                }
                if (this.directionStartFrame === undefined || this.directionEndFrame === undefined) {
                    return;
                }
                if (frameIndex >= this.directionStartFrame && frameIndex <= this.directionEndFrame) {
                    return;
                }
                const currentAnim = this.sprite.anims.currentAnim;
                if (!currentAnim?.frames) {
                    return;
                }
                const targetFrame = currentAnim.frames.find(
                    (f) => this.listFrameIndexFromAnimEntry(f) === this.directionStartFrame
                );
                if (!targetFrame) {
                    return;
                }
                this._isHandlingFrameLimit = true;
                try {
                    this.sprite.anims.setCurrentFrame(targetFrame);
                } finally {
                    this._isHandlingFrameLimit = false;
                }
            }
        }
    }

    /**
     * Updates the visibility of debug graphics based on debug mode and hover state.
     * Graphics (frame, anchor, pivot points) are always shown when debug mode is enabled.
     * Text is handled by React layer.
     */
    private updateDebugVisibility(): void {
        const debugEnabled = isDebugModeEnabled(this.scene);
        // Graphics are always visible when debug mode is enabled
        this.debugGraphics.setVisible(debugEnabled);

        // If debug mode is enabled, update debug graphics (and text if hovering)
        if (debugEnabled) {
            if (this.isNonAnimated && this.fixedFrameIndex !== undefined) {
                this.updateDebug(this.createMockFrame(this.fixedFrameIndex));
            } else if (this.sprite.anims && this.sprite.anims.currentFrame) {
                this.updateDebug(this.sprite.anims.currentFrame);
            }
        } else {
            // Clear debug info from React when debug mode is disabled or not hovering
            EventBus.emit(OUT_UI_HOVER_SPRITE_FRAME_DEBUG, undefined);
        }

        // Clear debug info when not hovering
        if (!this.isHovering) {
            EventBus.emit(OUT_UI_HOVER_SPRITE_FRAME_DEBUG, undefined);
        }
    }

    /**
     * Updates debug graphics and text with current frame information.
     * Draws:
     * - Green rectangle around the frame bounds
     * - Red crosshair at sprite position
     * - Blue crosshair at pivot point (if available)
     * - Emits event with debug info to React layer (only when hovering)
     * 
     * @param frame - The current animation frame from Phaser's animation system
     */
    private updateDebug(frame: Phaser.Animations.AnimationFrame): void {
        // Skip if debug mode is not enabled
        if (!isDebugModeEnabled(this.scene)) {
            return;
        }

        // Get frame index from frame
        const frameName = frame.textureFrame ?? frame.frame?.name ?? frame.index;
        const frameIndex = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);

        // Look up pivot data by frame index
        const pivotData = this.spriteSheetPivots?.[frameIndex];
        const hasPivotData = !!pivotData && pivotData.width !== 0 && pivotData.height !== 0;

        const frameWidth = this.sprite.frame?.width ?? this.sprite.displayWidth;
        const frameHeight = this.sprite.frame?.height ?? this.sprite.displayHeight;

        const topLeftX = this.sprite.x - (this.sprite.originX * frameWidth);
        const topLeftY = this.sprite.y - (this.sprite.originY * frameHeight);
        const pivotX = hasPivotData ? pivotData!.pivotX : 0;
        const pivotY = hasPivotData ? pivotData!.pivotY : 0;
        const pivotWorldX = hasPivotData ? (topLeftX + pivotX) : this.sprite.x;
        const pivotWorldY = hasPivotData ? (topLeftY + pivotY) : this.sprite.y;

        this.debugGraphics.clear();

        // Filled overlay at 25% opacity when hovering
        if (this.isHovering) {
            this.debugGraphics.fillStyle(0x00ff00, 0.25);
            this.debugGraphics.fillRect(topLeftX, topLeftY, frameWidth, frameHeight);
        }

        // Draw green stroke rectangle around frame bounds
        this.debugGraphics.lineStyle(1, 0x00ff00, 1);
        this.debugGraphics.strokeRect(topLeftX, topLeftY, frameWidth, frameHeight);
        this.debugGraphics.lineStyle(1, 0xff0000, 1);
        this.debugGraphics.lineBetween(this.sprite.x - 6, this.sprite.y, this.sprite.x + 6, this.sprite.y);
        this.debugGraphics.lineBetween(this.sprite.x, this.sprite.y - 6, this.sprite.x, this.sprite.y + 6);
        this.debugGraphics.lineStyle(1, 0x00aaff, 1);
        this.debugGraphics.lineBetween(pivotWorldX - 4, pivotWorldY, pivotWorldX + 4, pivotWorldY);
        this.debugGraphics.lineBetween(pivotWorldX, pivotWorldY - 4, pivotWorldX, pivotWorldY + 4);

        // Emit debug info to React layer when hovering
        if (this.isHovering) {
            const pointer = this.scene.input.activePointer;
            const { screenX, screenY } = canvasToScreenPosition(pointer.x, pointer.y, this.scene.game);

            // Convert scene position to world coordinates
            const worldX = convertPixelPosToWorldPos(this.sprite.x);
            const worldY = convertPixelPosToWorldPos(this.sprite.y);

            EventBus.emit(OUT_UI_HOVER_SPRITE_FRAME_DEBUG, {
                frame: frameIndex,
                pivotX,
                pivotY,
                hasPivot: hasPivotData,
                posX: this.sprite.x,
                posY: this.sprite.y,
                worldX,
                worldY,
                topLeftX,
                topLeftY,
                spriteName: this.spriteName,
                spriteSheetIndex: this.spriteSheetIndex,
                mouseX: screenX,
                mouseY: screenY,
                depth: this.sprite.depth,
            });
        }
    }

    /**
     * Called when the animation reaches a new frame.
     * Subclasses can override this to handle frame-specific logic (e.g., playing sounds at specific frames).
     * Default implementation does nothing.
     *
     * @param relativeFrameIndex - Frame index relative to the current direction (0-7 for 8-frame directions)
     */
    protected onAnimationFrameChange(_relativeFrameIndex: number): void {
        // Default implementation does nothing
        // Subclasses can override this to handle frame changes
    }

    /**
     * Detects frame changes and invokes the protected hook and config callback.
     */
    private emitAnimationFrameChange(frame: Phaser.Animations.AnimationFrame): void {
        const frameName = frame.textureFrame ?? frame.frame?.name ?? frame.index;
        const absoluteFrameIndex = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);

        if (absoluteFrameIndex === this.previousFrameIndex) {
            return;
        }
        this.previousFrameIndex = absoluteFrameIndex;

        // For SubFrame animations, account for animationFrameStartIndex so relative frame
        // is 0-based within the animation sequence (handles specialized frames not starting from 0)
        const animationStartFrame = this.directionStartFrame !== undefined
            ? this.directionStartFrame + (this.animationType === AnimationType.SubFrame ? this.animationFrameStartIndex : 0)
            : 0;
        const relativeFrameIndex = this.directionStartFrame !== undefined
            ? absoluteFrameIndex - animationStartFrame
            : absoluteFrameIndex;

        this.onAnimationFrameChange(relativeFrameIndex);
        if (this._constructionComplete) {
            this.onAnimationFrameChangeCallback?.(relativeFrameIndex);
        }
    }

    /**
     * Called when a non-looping animation has finished playing.
     * Subclasses can override this to handle animation completion (e.g., for attack/death animations).
     * Default implementation does nothing.
     */
    protected animationFinished(): void {
        // Default implementation does nothing
        // Subclasses can override this to handle animation completion
    }

    /**
     * Gets the current relative frame position (0-7) within the current direction.
     * Returns undefined if no animation is playing or direction frame ranges are not set.
     * 
     * @returns The relative frame index (0-7) or undefined
     */
    public getCurrentRelativeFrame(): number | undefined {
        if (this.pendingLazyPlayerItemAppearance) {
            return undefined;
        }
        if (!this.sprite.anims?.isPlaying || this.directionStartFrame === undefined) {
            return undefined;
        }

        const currentFrame = this.sprite.anims.currentFrame;
        if (!currentFrame) {
            return undefined;
        }

        // Get current absolute frame index
        const frameName = currentFrame.textureFrame ?? currentFrame.frame?.name ?? currentFrame.index;
        const absoluteFrameIndex = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);

        // For SubFrame, account for animationFrameStartIndex (handles specialized frames not starting from 0)
        const animationStartFrame = this.directionStartFrame + (this.animationType === AnimationType.SubFrame ? this.animationFrameStartIndex : 0);
        return absoluteFrameIndex - animationStartFrame;
    }

    /**
     * Plays a specific animation with a specific direction.
     * This is an atomic operation that updates direction frame ranges, pivot data, and plays the animation.
     * 
     * @param animationKey - The animation key to play (format: sprite-{name}-{index})
     * @param direction - The direction index (0-7)
     * @param frameRate - Optional frame rate for animation (default: 10)
     * @param relativeFrame - Optional relative frame position (0-7) to start from within the direction
     * @param repeat - Optional repeat count (0 = play once, undefined = loop)
     * @param framesPerDirection - Optional number of frames per direction (default: 8)
     * @param animationType - Optional animation type (default: current animation type)
     * @param animationFrameStartIndex - Optional starting frame index for SubFrame animations (default: 0)
     * @param isLooping - Optional looping behavior (default: true, or false if repeat is 0)
     */
    public playAnimationWithDirection(animationKey: string, direction: number, frameRate = 10, relativeFrame?: number, repeat?: number, framesPerDirection?: number, animationType?: AnimationType, animationFrameStartIndex?: number, isLooping?: boolean): void {
        if (!this.sprite || !this.sprite.anims) {
            return;
        }
        if (this.pendingLazyPlayerItemAppearance) {
            return;
        }
        try {
            if (!this.scene.anims.exists(animationKey)) {
                console.warn(`Animation key "${animationKey}" does not exist`);
                return;
            }

            // Extract sprite name and sheet index from animation key
            // Format: sprite-{name}-{index}
            const match = animationKey.match(/^sprite-(.+)-(\d+)$/);
            if (match) {
                const spriteName = match[1];
                const spriteSheetIndex = parseInt(match[2], 10);

                // Update pivot data for the new spritesheet
                const pivotData = getPivotData(this.scene, '', spriteName, false);
                if (pivotData && pivotData.spriteSheetPivots[spriteSheetIndex]) {
                    this.spriteSheetPivots = pivotData.spriteSheetPivots[spriteSheetIndex];
                } else {
                    // No pivot data found for this spritesheet
                    this.spriteSheetPivots = undefined;
                }
            }

            // Update animation type and start index if provided
            if (animationType !== undefined) {
                this.animationType = animationType;
            }
            if (animationFrameStartIndex !== undefined) {
                this.animationFrameStartIndex = animationFrameStartIndex;
            }

            // Update direction frame ranges BEFORE playing
            const actualFramesPerDirection = framesPerDirection ?? 8;
            this.directionStartFrame = direction * actualFramesPerDirection;
            this.directionEndFrame = this.directionStartFrame + actualFramesPerDirection - 1;

            // Calculate the absolute frame index to start from
            // For SubFrame animations, add the animationFrameStartIndex offset
            let startFrame: number;
            if (this.animationType === AnimationType.SubFrame) {
                // For SubFrame, start from the directionStartFrame + animationFrameStartIndex
                startFrame = this.directionStartFrame + this.animationFrameStartIndex;
                if (relativeFrame !== undefined) {
                    startFrame += Math.max(0, Math.min(actualFramesPerDirection - this.animationFrameStartIndex - 1, relativeFrame));
                }
            } else {
                // For other types, use the standard logic
                startFrame = relativeFrame !== undefined
                    ? this.directionStartFrame + Math.max(0, Math.min(actualFramesPerDirection - 1, relativeFrame))
                    : this.directionStartFrame;
            }

            const anim = this.scene.anims.get(animationKey);
            const frameCount = anim?.frames?.length ?? 0;
            if (frameCount < 1) {
                console.warn(`Animation key "${animationKey}" has no frames`);
                return;
            }

            startFrame = Math.max(0, Math.min(frameCount - 1, startFrame));

            this.stopCurrentAnimationForSwitch(animationKey);

            // Reset to frame 0 when starting from a non-zero frame to avoid carryover from previous animation
            if (startFrame > 0) {
                const firstFrame = anim?.frames?.[0];
                if (firstFrame?.frame) {
                    this.sprite.anims.setCurrentFrame(firstFrame);
                }
            }

            // Play the animation from the correct starting frame
            const playConfig: Phaser.Types.Animations.PlayAnimationConfig = {
                key: animationKey,
                startFrame: startFrame,
                frameRate: frameRate
            };
            
            // Only set repeat if explicitly provided
            if (repeat !== undefined) {
                playConfig.repeat = repeat;
            }
            
            // Track whether this animation should loop
            // Priority: explicit isLooping parameter > repeat parameter > current value
            if (isLooping !== undefined) {
                this.isAnimationLooping = isLooping;
            } else {
                // - undefined: uses animation default (usually -1 for infinite) -> looping
                // - -1: infinite loop -> looping
                // - 0: play once -> not looping
                // - > 0: repeat that many times -> looping during playback (Phaser handles stopping)
                this.isAnimationLooping = repeat === undefined || repeat !== 0;
            }
            
            try {
                this.sprite.play(playConfig);
            } catch (error) {
                this.resetAnimationStateForSwitch(animationKey);
                this.setStaticFrameFromAnimation(animationKey, startFrame);
                throw error;
            }

            // Sync overlays to parent's current frame (do not play—overlays must respect parent's
            // DirectionalSubFrame/SubFrame limits; playing would cycle through all frames).
            this.visualEffects.syncOverlayFramesAfterAnimationPlay();
        } catch (error) {
            this.resetAnimationStateForSwitch(animationKey);
            console.error(`Error playing animation with direction for GameAsset`, this, error);
        }
    }

    private setStaticFrameFromAnimation(animationKey: string, frameIndex: number): void {
        const anim = this.scene.anims.get(animationKey);
        const frame = anim?.frames?.[frameIndex] ?? anim?.frames?.[0];
        if (!frame?.frame) {
            return;
        }

        this.sprite.setTexture(frame.frame.texture.key, frame.frame.name);
        this.applyFramePivotOffset(frame);
        this.updateDebug(frame);
    }

    private stopCurrentAnimationForSwitch(nextAnimationKey: string): void {
        const animationState = this.sprite.anims;
        if (!animationState.isPlaying) {
            return;
        }

        if (!animationState.currentAnim || !animationState.currentFrame) {
            this.resetAnimationStateForSwitch(nextAnimationKey);
            return;
        }

        try {
            animationState.stop();
        } catch (error) {
            console.warn(
                `[GameAsset] Resetting stale animation state before playing "${nextAnimationKey}"`,
                error,
            );
            this.resetAnimationStateForSwitch(nextAnimationKey);
        }
    }

    private resetAnimationStateForSwitch(nextAnimationKey: string): void {
        type MutableAnimationState = {
            currentAnim?: Phaser.Animations.Animation | null;
            currentFrame?: Phaser.Animations.AnimationFrame | null;
            hasStarted?: boolean;
            isPlaying?: boolean;
            nextAnim?: Phaser.Animations.Animation | string | null;
            stopAfterDelay?: number;
            stopAfterRepeat?: number;
            stopOnFrame?: Phaser.Animations.AnimationFrame | null;
        };

        const animationState = this.sprite.anims as unknown as MutableAnimationState;
        animationState.currentAnim = null;
        animationState.currentFrame = null;
        animationState.nextAnim = null;
        animationState.stopOnFrame = null;
        animationState.stopAfterDelay = 0;
        animationState.stopAfterRepeat = 0;
        animationState.hasStarted = false;
        animationState.isPlaying = false;

        console.warn(`[GameAsset] Recovered stale animation state before playing "${nextAnimationKey}"`);
    }

    /**
     * Sets the position of the asset.
     * Updates baseX and baseY, and reapplies pivot offset if applicable.
     * 
     * @param x - The new x coordinate (in pixel coordinates)
     * @param y - The new y coordinate (in pixel coordinates)
     */
    public setPosition(x: number, y: number): void {
        this.baseX = x;
        this.baseY = y;

        // Re-apply pivot offset based on current frame
        if (this.sprite.frame) {
            const frameName = this.sprite.frame.name;
            const frameIndex = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);
            this.applyPivotOffset(frameIndex);
        } else {
            this.sprite.setPosition(x, y);
            this.visualEffects.syncOverlayPositionsToSprite();
        }

        // Update shadow position if shadow is enabled
        this.updateShadowPosition();
    }

    /**
     * Updates or hides the ghost sprite (trail effect during movement).
     * Ghost is a semi-transparent copy positioned behind the main sprite in the direction of travel.
     *
     * @param visible - Whether the ghost should be visible
     * @param offsetX - X offset in pixels (positive = ghost to the right of main sprite)
     * @param offsetY - Y offset in pixels (positive = ghost below main sprite)
     */
    public updateGhostSprite(visible: boolean, offsetX: number, offsetY: number): void {
        if (!visible) {
            if (this.ghostSprite) {
                this.ghostSprite.setVisible(false);
            }
            return;
        }
        if (this.isMapObject()) {
            return;
        }
        const textureKey = this.sprite.texture?.key;
        if (!textureKey) {
            return;
        }
        if (!this.ghostSprite) {
            const frame = this.sprite.anims?.currentFrame ?? this.sprite.frame;
            const frameName = getFrameNameFromSpriteFrame(frame, this.fixedFrameIndex);
            const texture = this.scene.textures.get(textureKey);
            const safeFrame = texture.has(frameName) ? frameName : '0';
            this.ghostSprite = this.scene.add.sprite(this.sprite.x, this.sprite.y, textureKey, safeFrame);
            this.ghostSprite.setOrigin(0, 0);
            this.ghostSprite.setAlpha(0.4);
            this.ghostSprite.setTint(0x666666);
            this.ghostSprite.setDepth(this.sprite.depth - 1);
            this.ghostSprite.setVisible(true);
            this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.syncGhostFrame);
            this.sprite.on(Phaser.Animations.Events.ANIMATION_START, this.syncGhostFrame);
        }
        this.ghostSprite.setPosition(this.sprite.x + offsetX, this.sprite.y + offsetY);
        this.ghostSprite.setDepth(this.sprite.depth - 1);
        this.ghostSprite.setVisible(this.sprite.visible);
        this.syncGhostFrame();
    }

    private syncGhostFrame = (): void => {
        if (!this.ghostSprite) {
            return;
        }
        const textureKey = this.sprite.texture?.key;
        if (textureKey && this.ghostSprite.texture?.key !== textureKey) {
            this.destroyGhostSprite();
            return;
        }
        const frame = this.sprite.anims?.currentFrame ?? this.sprite.frame;
        const frameName = getFrameNameFromSpriteFrame(frame, this.fixedFrameIndex);
        if (this.ghostSprite.frame?.name !== frameName) {
            this.ghostSprite.setFrame(frameName);
        }
    };

    private destroyGhostSprite(): void {
        if (this.ghostSprite) {
            this.sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE, this.syncGhostFrame);
            this.sprite.off(Phaser.Animations.Events.ANIMATION_START, this.syncGhostFrame);
            this.ghostSprite.destroy();
            this.ghostSprite = undefined;
        }
    }

    /**
     * Sets the depth of the sprite for proper rendering order.
     * Higher depth values render on top of lower depth values.
     * 
     * @param depth - The depth value to set
     */
    public setDepth(depth: number): void {
        // map-tile-422 renders +1 on top of regular depth for proper layering
        const actualDepth = this.isMapObject() && this.spriteName === 'map-tile-422'
            ? depth + 100
            : depth;
        this.sprite.setDepth(actualDepth);

        this.visualEffects.updateOverlayDepths(actualDepth);

        if (this.ghostSprite) {
            this.ghostSprite.setDepth(actualDepth - 1);
        }

        // Tree shadow sits well below the canopy in depth units (large gap so sorting stays stable).
        if (this.treeShadowAsset) {
            this.treeShadowAsset.setDepth(actualDepth - 500);
        }

        // Update shadow depth if shadow is enabled
        this.updateShadowDepth();
    }

    /**
     * Gets the current depth of the sprite.
     * 
     * @returns The depth value
     */
    public getDepth(): number {
        return this.sprite.depth;
    }

    /**
     * Returns true if this asset's sprite animation is currently playing.
     *
     * @returns True when animation is playing, false when stopped or no animation exists
     */
    public isAnimationPlaying(): boolean {
        return this.sprite?.anims?.isPlaying ?? false;
    }

    /** True for HBMap map decals (`spriteName` `map-tile-*`; constructed with `mapObject: true`). */
    public isMapObject(): boolean {
        return this.spriteName.startsWith('map-tile-');
    }

    /**
     * Returns the tree shadow GameAsset if this asset has one (trees only).
     * Used for RenderTexture capture to include shadows in the correct draw order.
     */
    public getTreeShadowAsset(): GameAsset | undefined {
        return this.treeShadowAsset;
    }

    /**
     * Sets the alpha transparency of the sprite.
     * 
     * @param alpha - The alpha value (0-1)
     */
    public setAlpha(alpha: number): void {
        this.sprite.setAlpha(alpha);
        this.visualEffects.setAlpha(alpha);
    }

    /**
     * Sets the visibility of the sprite.
     *
     * @param visible - Whether the sprite should be visible
     */
    public setVisible(visible: boolean): void {
        this.sprite.setVisible(visible);
        this.visualEffects.setVisible(visible);
    }

    /**
     * Gets the bounding rectangle of the sprite in world coordinates.
     * 
     * @returns A rectangle object with x, y, width, height
     */
    public getBounds(): { x: number; y: number; width: number; height: number } {
        const bounds = this.sprite.getBounds();
        return {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
        };
    }

    /**
     * Updates the shadow sprite position to match the asset's current position.
     */
    private updateShadowPosition(): void {
        if (!this.shadowManager) {
            return;
        }

        // Use sprite's actual position (which includes pivot offset)
        // The sprite position is at the pivot point (baseX + pivotX, baseY + pivotY)
        const spriteX = this.sprite.x;
        const spriteY = this.sprite.y;

        // Get current frame index to look up pivot data
        let frameIndex: number;
        if (this.isNonAnimated && this.fixedFrameIndex !== undefined) {
            frameIndex = this.fixedFrameIndex;
        } else {
            const currentFrame = this.sprite.anims.currentFrame;
            if (!currentFrame) {
                return;
            }
            const frameName = currentFrame.textureFrame ?? currentFrame.frame?.name ?? currentFrame.index;
            frameIndex = typeof frameName === 'number' ? frameName : parseInt(frameName, 10);
        }

        // Get object's pivot data for current frame
        let objectPivotX = 0;
        let objectPivotY = 0;
        if (this.spriteSheetPivots && this.spriteSheetPivots[frameIndex]) {
            const pivotFrame = this.spriteSheetPivots[frameIndex];
            if (pivotFrame.width !== 0 && pivotFrame.height !== 0) {
                objectPivotX = pivotFrame.pivotX;
                objectPivotY = pivotFrame.pivotY;
            }
        }

        // Get object's frame dimensions
        const objectFrame = this.sprite.frame;
        const objectFrameWidth = objectFrame?.width ?? this.sprite.displayWidth;
        const objectFrameHeight = objectFrame?.height ?? this.sprite.displayHeight;

        // Pass sprite position and pivot data to shadow manager
        // Shadow manager will calculate position relative to this, accounting for shadow's pivot and origin
        this.shadowManager.updatePositionFromSprite(
            spriteX,
            spriteY,
            objectPivotX,
            objectPivotY,
            objectFrameWidth,
            objectFrameHeight
        );
    }

    /**
     * Updates the shadow depth to render just below the asset.
     */
    private updateShadowDepth(): void {
        if (!this.shadowManager) {
            return;
        }

        const assetDepth = this.sprite.depth;
        this.shadowManager.updateDepth(assetDepth);
    }

    /**
     * Gets the current sprite name.
     * @returns The sprite name without extension
     */
    public getSpriteName(): string {
        return this.spriteName;
    }

    /** True while this layer waits for a lazy equipped-item `.spr` fetch. */
    public isPendingLazyPlayerItemAppearance(): boolean {
        return this.pendingLazyPlayerItemAppearance;
    }

    /**
     * Swaps placeholder texture after `loadPlayerItemAppearanceOnDemand` registers the real sheet.
     */
    public promotePendingPlayerItemAppearance(): void {
        if (!this.pendingLazyPlayerItemAppearance || this.spriteSheetIndex === undefined) {
            return;
        }

        // Lazy load can finish after this layer’s sprite was destroyed (despawn / teardown); Phaser’s
        // setTexture requires an attached scene.
        if (!this.sprite.scene || !this.sprite.active) {
            this.pendingLazyPlayerItemAppearance = false;
            return;
        }

        const textureKey = `sprite-${this.spriteName}-${this.spriteSheetIndex}`;
        if (!this.scene.textures.exists(textureKey)) {
            console.error(`[GameAsset] Missing texture after lazy item load: ${textureKey}`);
            return;
        }

        this.pendingLazyPlayerItemAppearance = false;

        const pivotData = getPivotData(this.scene, textureKey, this.spriteName, false);
        if (pivotData && pivotData.spriteSheetPivots[this.spriteSheetIndex] !== undefined) {
            this.spriteSheetPivots = pivotData.spriteSheetPivots[this.spriteSheetIndex];
        } else {
            this.spriteSheetPivots = undefined;
        }

        const startFrame = this.directionStartFrame ?? 0;
        this.sprite.setTexture(textureKey, startFrame);
        this.applyPivotOffset(startFrame);
        this.visualEffects.syncOverlayFramesAfterAnimationPlay();
    }

    /**
     * When equipping a different item whose `.spr` is not loaded, hide and show placeholder until fetch completes.
     */
    public retargetPlayerItemAppearanceToPending(scene: Scene): void {
        if (!LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND || !getItemEquippedAppearanceSpriteNames().has(this.spriteName)) {
            return;
        }
        if (scene.textures.exists(`sprite-${this.spriteName}-0`)) {
            if (this.pendingLazyPlayerItemAppearance) {
                this.promotePendingPlayerItemAppearance();
            }
            return;
        }

        this.pendingLazyPlayerItemAppearance = true;
        if (this.sprite.anims.isPlaying) {
            this.sprite.anims.stop();
        }
        this.sprite.setTexture(PLAYER_ITEM_APPEARANCE_PENDING_TEXTURE, 0);
        this.spriteSheetPivots = undefined;
        this.sprite.setVisible(false);
    }
    
    /**
     * Changes the sprite name for subsequent animations.
     * Used for sprite overrides in monster animations.
     * The actual texture change happens when playAnimationWithDirection is called.
     * @param newSpriteName - The new sprite name (without extension)
     */
    public setSpriteName(newSpriteName: string): void {
        this.spriteName = newSpriteName;
    }
    
    /**
     * Destroys the GameAsset and cleans up all associated resources.
     * Removes event listeners, destroys the sprite, and cleans up debug graphics and text.
     */
    public destroy(): void {
        this.visualEffects.destroy();
        this.destroyGhostSprite();

        // Destroy tree shadow asset if it exists
        if (this.treeShadowAsset) {
            this.treeShadowAsset.destroy();
            this.treeShadowAsset = undefined;
        }

        // Destroy shadow manager if it exists
        if (this.shadowManager) {
            this.shadowManager.destroy();
            this.shadowManager = undefined;
        }

        // Remove debug mode change listener
        this.scene.registry.events.off(IN_DEBUG_MODE_CHANGE, this.debugModeChangeHandler);

        this.sprite.destroy();
        this.debugGraphics.destroy();
    }
}

/** How sprite animation frames map from the sheet onto playback (directional strip vs full sheet, etc.). */
export enum AnimationType {
    FullFrame = 'FullFrame',
    DirectionalSubFrame = 'DirectionalSubFrame',
    SubFrame = 'SubFrame',
}

/** Constructor options for {@link GameAsset}. */
export type GameAssetConfig = {
    x: number;
    y: number;
    spriteName: string;
    /** Required when `mapObject` is false. */
    spriteSheetIndex?: number;
    /** When true, texture key is basename `spriteName` (map decals from HBMap). */
    mapObject?: boolean;
    direction?: number;
    framesPerDirection?: number;
    frameIndex?: number;
    alpha?: number;
    tint?: number;
    frameRate?: number;
    animationType?: AnimationType;
    animationFrameStartIndex?: number;
    isLooping?: boolean;
    onAnimationFrameChange?: (relativeFrameIndex: number) => void;
    effects?: Effect[];
    /** When true, use invisible placeholder until equipped item `.spr` is lazy-loaded. */
    pendingLazyPlayerItemAppearance?: boolean;
};
