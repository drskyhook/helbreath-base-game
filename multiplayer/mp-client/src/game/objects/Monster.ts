import type { Scene } from 'phaser';
import Phaser from 'phaser';
import { GameObject, GameObjectState } from './GameObject';
import type { GameAssetConfig } from './GameAsset';
import { AnimationType } from './GameAsset';
import { Direction, getNextDirection, toDirection, worldCellCenterPixelX, worldCellCenterPixelY } from '../../utils/CoordinateUtils';
import type { HBMap } from '../assets/HBMap';
import { TILE_SIZE } from '../assets/HBMap';
import { ShadowManager } from '../../utils/ShadowManager';
import type { SoundManager, SpatialConfig } from '../../utils/SoundManager';
import type { MonsterStatesConfig, StateAnimationConfig } from '../../constants/Monsters';
import { getSpriteFrameHeight } from '../../utils/SpriteUtils';
import { KNOCKBACK_DURATION_MS, MONSTER_CORPSE_FADE_ALPHA_STEP, DEFAULT_ANIMATION_FRAME_RATE, MONSTER_INTERRUPT_HIT_DURATION_MS, MONSTER_STUNLOCK_DURATION_MS } from '../../Config';
import { calculateSpatialAudio } from '../../utils/SpatialAudioUtils';
import { EventBus } from '../EventBus';
import { MONSTER_DEAD } from '../../constants/EventNames';
import { TAKE_DAMAGE_BLADE } from '../../constants/SoundFileNames';
import { AttackType, MonsterAllegiance, TemporaryEffectType } from '../../Types';
import { calculateAnimationDuration, calculateFrameRateFromDuration } from '../../utils/AnimationUtils';
import { MonsterEntityState } from '../../proto/generated/network';

/**
 * Monster animation states mapping to sprite sheet indexes.
 */
export enum MonsterState {
    /** Idle standing animation */
    Idle = 0,
    /** Moving animation */
    Move = 1,
    /** Attack animation */
    Attack = 2,
    /** Take damage animation (stationary) */
    TakeDamage = 3,
    /** Take damage animation while moving between cells */
    TakeDamageOnMove = 4,
    /** Death animation */
    Dead = 5,
    /** Take damage with knockback - plays TakeDamage animation while moving 1 cell away from attacker */
    TakeDamageWithKnockback = 6,
}

/**
 * Shadow display options for monsters.
 */
export enum MonsterShadow {
    /** No shadow displayed */
    NoShadow = 0,
    /** Body shadow displayed beneath the monster */
    BodyShadow = 1,
}

/**
 * Maps monster state to sprite sheet index base.
 * Idle uses spritesheets 0-7 (one per direction).
 * Move uses spritesheets 8-15 (one per direction).
 * Attack uses spritesheets 16-23 (one per direction).
 * TakeDamage/TakeDamageOnMove use spritesheets 24-31 (one per direction), duration matches MONSTER_STUNLOCK_DURATION_MS.
 * Dead uses spritesheets 32-39 (one per direction).
 */
const MONSTER_SPRITESHEET: Record<MonsterState, number> = {
    [MonsterState.Idle]: 0,  // Spritesheets 0-7 for idle
    [MonsterState.Move]: 8,  // Spritesheets 8-15 for movement
    [MonsterState.Attack]: 16, // Spritesheets 16-23 for attack
    [MonsterState.TakeDamage]: 24, // Spritesheets 24-31 for take damage
    [MonsterState.TakeDamageOnMove]: 24, // Same as TakeDamage
    [MonsterState.Dead]: 32, // Spritesheets 32-39 for death
    [MonsterState.TakeDamageWithKnockback]: 24, // Same as TakeDamage
};


/**
 * Configuration for creating a Monster instance.
 */
type MonsterConfig = {
    /** X coordinate in world map position */
    x: number;
    
    /** Y coordinate in world map position */
    y: number;
    
    /** Sprite name for the monster without extension (e.g., 'ettin') */
    spriteName: string;
    
    /** Display name shown in UI (e.g., 'Ettin', 'Dragon') */
    displayName: string;
    
    /** Direction the monster is facing (0-7) */
    direction: Direction;
    
    /** SoundManager instance for playing sound effects */
    soundManager: SoundManager;
    
    /** HBMap instance for collision checking */
    map: HBMap;
    
    /** State-specific configuration (sound and animation data) */
    states?: MonsterStatesConfig;

    /** Per-tile step duration in ms from server (0 = immobile). */
    movementSpeedMs: number;

    /** Full melee swing duration in ms from server. */
    attackSpeedMs: number;

    /** Listener X for monster spatial audio. */
    playerX: number;

    /** Listener Y for monster spatial audio. */
    playerY: number;

    hp: number;
    maxHp: number;

    attackDamage: number;

    attackType: AttackType;

    allegiance: MonsterAllegiance;
    
    /** When true, monster is spawned as an already-dead corpse from a range snapshot. */
    dead: boolean;

    /** Initial state from the latest monster snapshot. */
    state: MonsterEntityState;

    /** Unique monster ID from server range snapshots. */
    monsterId: string;
    
    /** Temporal coefficient controlling animation speed (defaults to 1.0) */
    temporalCoefficient?: number;
    
    /** Shadow display option (defaults to BodyShadow) */
    shadow?: MonsterShadow;
    
    /** Opacity/transparency of the monster sprite (defaults to 1.0, range 0.0-1.0) */
    opacity?: number;

    /** Transparency slider value 0-100 (0 = opaque, 100 = transparent). Applied at summon time only. Overrides opacity when provided. */
    transparency?: number;

    /** Chilled blue tint effect. Applied at summon time only. */
    chilledEffect?: boolean;

    /** Berserk red overlay effect. Applied at summon time only. */
    berserkedEffect?: boolean;

    /** Estimated height of the monster in pixels. Used to position damage indicator above the monster. */
    height?: number;
};

/**
 * Represents a monster in the game.
 * Extends GameObject and defaults to Idle state with appropriate animations.
 */
export class Monster extends GameObject {
    /** Current animation state */
    private currentState: MonsterState;
    
    /** Sprite name for the monster */
    private monsterSpriteName: string;
    
    /** Display name shown in UI (e.g., 'Ettin', 'Dragon') */
    private displayName: string;
    
    /** State-specific configuration (sound and animation data) */
    private states?: MonsterStatesConfig;
    
    /** Base FPS for attack idle-pose pacing from server `attackSpeedMs` and sprite frame count. */
    private attackSpeedFrameRate: number;
    
    /** Frame rate for movement animations */
    /** Calculated dynamically based on movement speed and monster type */
    private movementFrameRate: number;
    
    /** Number of frames in movement animation (varies by monster type) */
    private movementFrameCount: number;
    
    /** Player's world X coordinate for spatial audio. */
    private playerX: number;

    /** Player's world Y coordinate for spatial audio. */
    private playerY: number;
    
    /** Attack type: how damage affects the target when monster hits player */
    private attackType: AttackType;

    /** Hostility mode from the server. */
    private allegiance: MonsterAllegiance;

    /** When true, data-driven spawn uses chilled tint until overridden by server temporary effects. */
    private readonly spawnChilledVisual: boolean;

    /** When true, data-driven spawn uses berserk red overlay; combined with server Berserk buff in {@link onTemporaryEffectsChanged}. */
    private readonly spawnBerserkVisual: boolean;

    /** Attack damage dealt */
    private attackDamage: number;

    /** Full melee swing duration in ms (matches server `attackSpeedMs`). */
    private attackSpeedMs: number;

    /** Whether the monster is currently in attack animation */
    private isAttacking: boolean = false;

    /** When set, attack animation length matches `monster_attacked.attack_speed_ms`. */
    private attackAnimationDurationMs: number | undefined;

    /** When set, take-damage animation uses this duration (player interrupt hit); skips post-hit stunlock. */
    private takeDamageInterruptOnlyMs: number | undefined;

    /** When set, take-damage animation duration matches stun ms from the packet; same value drives post-hit stunlock via {@link pendingPostStunlockMs}. */
    private takeDamageStunlockAnimationMs: number | undefined;

    /** Consumed by {@link startStunlock} when a stun hit applied a stunlock window. */
    private pendingPostStunlockMs: number | undefined;

    /** Restores {@link GameObject} stunlock duration after a one-shot packet-driven stunlock. */
    private stunlockDurationRestore: number | undefined;

    /**
     * Best-effort timer for an initial `Move` snapshot from `monster_entered_range`.
     * That packet does not include step direction or timing, so the scene can only display a short move pose before idling.
     */
    private pendingSnapshotMoveIdleMs: number | undefined;

    /** Defers switching from Move to Idle after a grid step so brief gaps between server steps do not flash idle (same idea as remote players). */
    private pendingRemoteIdleSwitchMs: number | undefined;

    private remoteIdleContinuationGraceMs = 100;
    
    /** Whether the monster is marked for killing */
    private shouldKill: boolean = false;
    
    /** Whether the monster is in death animation */
    private dead: boolean = false;
    
    /** When true, corpse linger/removal is controlled by range packets; fade starts after {@link beginRemovalFade}. */
    private waitForRemovalSignal: boolean = false;

    /** Set when `monsters_left_range` arrives for this corpse; next frames apply corpse fade then removal. */
    private pendingRemovalFade: boolean = false;
    
    /** Current alpha/opacity value for fade out (0-255 range) */
    private currentAlpha: number = 255;
    
    /** Unique monster ID */
    private monsterId: string;

    /** Temporal coefficient controlling animation speed. */
    private temporalCoefficient: number;

    /**
     * Creates a new Monster instance.
     * 
     * @param scene - The Phaser scene to add the monster to
     * @param config - Configuration object with position, sprite, direction, and dependencies
     */
    constructor(scene: Scene, config: MonsterConfig) {
        const temporalCoefficient = config.temporalCoefficient ?? 1.0;
        const alpha = config.transparency !== undefined
            ? 1 - config.transparency / 100
            : (config.opacity ?? 1.0);
        
        // Calculate initial spriteSheetIndex for monster sprite based on direction
        const initialSpriteSheetIndex = MONSTER_SPRITESHEET[MonsterState.Idle] + config.direction;
        
        // Get idle animation frame count from config (if specified) to adjust frame rate
        // Standard idle has 8 frames, so scale proportionally
        const idleAnimationFrames = config.states?.idle?.animation?.animationFrames ?? 8;
        const idleFrameRate = DEFAULT_ANIMATION_FRAME_RATE * (idleAnimationFrames / 8) * temporalCoefficient;
        
        // Build the GameAsset configuration for the monster
        const assetConfigs: Omit<GameAssetConfig, 'x' | 'y'>[] = [
            {
                spriteName: config.spriteName,
                spriteSheetIndex: initialSpriteSheetIndex,
                // For monster sprite, spriteSheetIndex already encodes the direction (0-7 for idle)
                // So we always use direction 0 when creating, as the spriteSheetIndex itself represents the direction
                direction: 0,
                // Apply frame count adjustment and temporalCoefficient to initial Idle animation frame rate
                frameRate: idleFrameRate,
                // Apply opacity/transparency to the sprite
                alpha,
                onAnimationFrameChange: (relativeFrameIndex: number) => {
                    if ((this.currentState === MonsterState.TakeDamage || this.currentState === MonsterState.TakeDamageOnMove || this.currentState === MonsterState.TakeDamageWithKnockback) && relativeFrameIndex === 4) {
                        const spatialConfig = this.calculateSpatialConfig();
                        this.soundTracker.playOnceUntracked(TAKE_DAMAGE_BLADE, spatialConfig);
                    }
                },
            },
        ];

        super(scene, {
            x: config.x,
            y: config.y,
            assets: assetConfigs,
            soundManager: config.soundManager,
            map: config.map,
            movementSpeedMs: config.movementSpeedMs,
            stunlockDurationMs: MONSTER_STUNLOCK_DURATION_MS,
        });
        
        this.monsterSpriteName = config.spriteName;
        this.displayName = config.displayName;
        this.states = config.states;
        this.hp = config.hp;
        this.maxHp = config.maxHp;
        this.direction = config.direction;
        this.currentState = MonsterState.Idle;
        this.playerX = config.playerX;
        this.playerY = config.playerY;
        this.attackType = config.attackType;
        this.allegiance = config.allegiance;
        this.attackDamage = config.attackDamage;
        this.attackSpeedMs = config.attackSpeedMs;
        this.monsterId = config.monsterId;
        this.temporalCoefficient = temporalCoefficient;
        this.height = config.height ?? getSpriteFrameHeight(scene, config.spriteName, 0, 0);
        this.spawnChilledVisual = config.chilledEffect ?? false;
        this.spawnBerserkVisual = config.berserkedEffect ?? false;

        if (config.dead) {
            this.enterSpawnedCorpseState();
        }

        // Defer Idle after each step via `pendingRemoteIdleSwitchMs` (see `update`); do not snap to Idle here or the sprite flickers between steps.
        this.autoSwitchToIdle = false;

        this.movementFrameCount = this.getMovementFrameCount();
        const attackAnimFrames = this.getStateAnimationConfig(MonsterState.Attack).animationFrames;
        this.attackSpeedFrameRate = calculateFrameRateFromDuration(attackAnimFrames, Math.max(1, config.attackSpeedMs));
        this.movementFrameRate = calculateFrameRateFromDuration(
            this.movementFrameCount,
            Math.max(1, config.movementSpeedMs),
        );
        
        // Create shadow manager only if BodyShadow is specified (default behavior). Corpses drop shadow in `enterSpawnedCorpseState`.
        const shadowOption = config.shadow ?? MonsterShadow.BodyShadow;
        if (shadowOption === MonsterShadow.BodyShadow && !config.dead) {
            const initialShadowSpriteSheetIndex = MONSTER_SPRITESHEET[MonsterState.Idle] + config.direction;
            this.shadowManager = new ShadowManager({
                scene,
                shadowSpriteName: config.spriteName,
                shadowSpriteSheetIndex: initialShadowSpriteSheetIndex,
                worldX: config.x,
                worldY: config.y,
                frameRate: idleFrameRate,
            });
        }
        
        // Center the monster in the initial cell
        this.updatePixelPosition();

        this.onTemporaryEffectsChanged();

        if (!config.dead) {
            this.applyInitialEntityState(config.state);
        }
    }
    
    
    /** Move-state frame count from catalog `states.move` when present, otherwise `getStateAnimationConfig` defaults. */
    private getMovementFrameCount(): number {
        const config = this.getStateAnimationConfig(MonsterState.Move);
        return config.animationFrames;
    }
    
    /**
     * Gets the animation configuration for a specific state.
     * Returns configured values or defaults if not specified.
     * 
     * @param state - The monster state
     * @returns Animation configuration with defaults applied
     */
    private getStateAnimationConfig(state: MonsterState): Required<StateAnimationConfig> {
        let stateConfig: StateAnimationConfig | undefined;
        
        // Get state-specific config if available
        if (this.states) {
            switch (state) {
                case MonsterState.Idle:
                    stateConfig = this.states.idle?.animation;
                    break;
                case MonsterState.Move:
                    stateConfig = this.states.move?.animation;
                    break;
                case MonsterState.Attack:
                    stateConfig = this.states.attack?.animation;
                    break;
                case MonsterState.TakeDamage:
                case MonsterState.TakeDamageOnMove:
                case MonsterState.TakeDamageWithKnockback:
                    stateConfig = this.states.takeDamage?.animation;
                    break;
                case MonsterState.Dead:
                    stateConfig = this.states.death?.animation;
                    break;
            }
        }
        
        // Apply defaults (TakeDamage/TakeDamageOnMove use fixed config)
        const defaults: Required<StateAnimationConfig> =
            state === MonsterState.TakeDamage || state === MonsterState.TakeDamageOnMove || state === MonsterState.TakeDamageWithKnockback
                ? {
                    startSpriteSheet: 24,
                    startAnimationFrame: 0,
                    animationFrames: 8,
                    spriteName: this.monsterSpriteName,
                }
                : {
                    startSpriteSheet: MONSTER_SPRITESHEET[state],
                    startAnimationFrame: 0,
                    animationFrames: 8,
                    spriteName: this.monsterSpriteName,
                };

        return {
            startSpriteSheet: stateConfig?.startSpriteSheet ?? defaults.startSpriteSheet,
            startAnimationFrame: stateConfig?.startAnimationFrame ?? defaults.startAnimationFrame,
            animationFrames: stateConfig?.animationFrames ?? defaults.animationFrames,
            spriteName: stateConfig?.spriteName ?? defaults.spriteName,
        };
    }
    
    /**
     * Gets the sound file name for a specific state.
     * 
     * @param state - The monster state
     * @returns Sound file name or undefined if not configured
     */
    private getStateSound(state: MonsterState): string | undefined {
        if (!this.states) {
            return undefined;
        }
        
        switch (state) {
            case MonsterState.Move:
                return this.states.move?.sound;
            case MonsterState.Attack:
                return this.states.attack?.sound;
            case MonsterState.TakeDamage:
            case MonsterState.TakeDamageOnMove:
            case MonsterState.TakeDamageWithKnockback:
                return this.states.takeDamage?.sound;
            case MonsterState.Dead:
                return this.states.death?.sound;
            default:
                return undefined;
        }
    }
    
    /**
     * Marks the monster for killing. The death animation will start
     * when the monster is not mid-cell (has finished current movement).
     */
    public kill(): void {
        this.shouldKill = true;
    }

    /**
     * Applies the authoritative `monster_died` transition from the server.
     */
    public applyDeath(): void {
        if (this.dead) {
            return;
        }
        this.clearTemporaryEffects();
        this.hp = 0;
        this.startDeathAnimation();
    }
    
    /**
     * Plays an attack toward the given grid facing (0–7) for the given duration in milliseconds.
     * Uses the packet cell so the sprite is centered before the swing when movement interpolation was off.
     */
    public startAttackAnimation(direction: number, attackSpeedMs: number, worldX: number, worldY: number): void {
        if (this.dead || this.shouldKill || attackSpeedMs <= 0) {
            return;
        }

        this.cancelMovement();
        this.pendingSnapshotMoveIdleMs = undefined;
        this.pendingRemoteIdleSwitchMs = undefined;
        this.snapMonsterToAttackCellIfNeeded(worldX, worldY);
        if (direction >= 0 && direction <= 7) {
            this.direction = direction;
        }

        this.attackAnimationDurationMs = attackSpeedMs;
        this.isAttacking = true;
        this.switchMonsterState(MonsterState.Attack, true);
    }

    /**
     * Plays the configured melee attack sound at damage delivery time, with spatial audio relative to the listener.
     */
    public playAttackImpactSound(): void {
        if (this.dead || this.shouldKill) {
            return;
        }

        const attackSound = this.getStateSound(MonsterState.Attack);
        if (attackSound) {
            const spatialConfig = this.calculateSpatialConfig();
            this.soundTracker.playOnce(attackSound, undefined, spatialConfig, MonsterState.Attack);
        }
    }

    /**
     * `monster_entered_range.dead`: show final corpse pose without playing the full death animation.
     */
    public enterSpawnedCorpseState(): void {
        this.markCurrentTileFree();
        this.cancelMovement();
        this.soundTracker.stopAllSounds();
        if (this.shadowManager) {
            this.shadowManager.destroy();
            this.shadowManager = undefined;
        }
        this.dead = true;
        this.isAttacking = false;
        this.attackAnimationDurationMs = undefined;
        this.moving = false;
        this.moveReady = true;
        this.waitForRemovalSignal = true;
        this.pendingRemovalFade = false;
        const animConfig = this.getStateAnimationConfig(MonsterState.Dead);
        const lastFrame = Math.max(0, animConfig.animationFrames - 1);
        this.switchMonsterState(MonsterState.Dead, true, lastFrame);
        this.currentAlpha = 255;
    }

    private startDeathAnimation(): void {
        // Free the occupied cell immediately when kill cycle starts
        this.markCurrentTileFree();
        
        // Cancel any movement
        this.cancelMovement();
        
        // Stop all sounds
        this.soundTracker.stopAllSounds();
        
        // Play death sound once with spatial audio and animation duration based on death animation
        const deathSound = this.getStateSound(MonsterState.Dead);
        if (deathSound) {
            const spatialConfig = this.calculateSpatialConfig();
            this.soundTracker.playOnce(deathSound, undefined, spatialConfig);
        }
        
        // Destroy shadow manager - shadows no longer necessary once death animation starts
        if (this.shadowManager) {
            this.shadowManager.destroy();
            this.shadowManager = undefined;
        }
        
        // Mark as dead
        this.dead = true;
        this.isAttacking = false;
        this.attackAnimationDurationMs = undefined;
        this.waitForRemovalSignal = true;
        this.pendingRemovalFade = false;
        
        // Set GameObject to Idle (not moving)
        // but Monster to Dead state for animation
        this.moving = false;
        this.moveReady = true;
        
        // Switch to death animation
        this.switchMonsterState(MonsterState.Dead);
        
        this.currentAlpha = 255;
    }
    
    /**
     * Returns true if the monster is in dead state (death animation or corpse).
     */
    public isDead(): boolean {
        return this.dead;
    }

    /**
     * `monsters_left_range` removed the corpse from the authoritative world state. Plays the client fade, then emits monster removal.
     */
    public beginRemovalFade(): void {
        if (!this.dead) {
            return;
        }
        this.waitForRemovalSignal = false;
        this.pendingRemovalFade = true;
    }

    private applyCorpseFadeStep(): void {
        this.currentAlpha = Math.max(0, this.currentAlpha - MONSTER_CORPSE_FADE_ALPHA_STEP);
        for (const asset of this.assets) {
            asset.setAlpha(this.currentAlpha / 255);
        }
        if (this.currentAlpha < 1) {
            EventBus.emit(MONSTER_DEAD, { monsterId: this.monsterId });
        }
    }

    /**
     * Returns the display name of the monster (e.g. "Ettin", "Dragon").
     */
    public getDisplayName(): string {
        return this.displayName;
    }

    /**
     * Overrides GameObject.announceDeath. When hp drops below 1, switches to Dead state.
     */
    protected override announceDeath(): void {
        this.startDeathAnimation();
    }

    /**
     * Applies hit data from `monster_take_damage`. With {@link AttackType.NoInterrupt}, HP still updates but take-damage animation is skipped.
     * @param stunlockDurationMs When {@link AttackType.Stun} or knockback stun timing, packet duration in ms when &gt; 0.
     * @param knockbackDurationMs When {@link AttackType.Knockback} moved the monster, interpolation duration in ms.
     * @param hpAfter Remaining HP from the packet.
     */
    public takeDamage(
        damage: number,
        attackType: number,
        stunlockDurationMs?: number,
        knockbackDurationMs?: number,
        destX?: number,
        destY?: number,
        knockbackFromX?: number,
        knockbackFromY?: number,
        hpAfter?: number,
    ): void {
        const resolved = this.resolveAttackTypeFromPacket(attackType);
        if (this.dead || this.shouldKill) {
            return;
        }

        if (hpAfter !== undefined) {
            this.hp = hpAfter;
        }

        const offsetY = this.height ?? 2 * TILE_SIZE;
        this.createDamageFloatingText(damage, this.getAnimatedPixelY() - offsetY);

        if (this.hp < 1) {
            return;
        }

        if (resolved === AttackType.NoInterrupt) {
            return;
        }

        const hasKnockback =
            resolved === AttackType.Knockback &&
            knockbackDurationMs !== undefined &&
            knockbackDurationMs > 0 &&
            destX !== undefined &&
            destY !== undefined;

        if (hasKnockback) {
            this.applyKnockbackDamage(
                stunlockDurationMs ?? 0,
                knockbackDurationMs,
                destX,
                destY,
                knockbackFromX,
                knockbackFromY,
            );
            return;
        }

        this.applyTakeDamageVisualEffects(resolved, stunlockDurationMs);
    }

    /** Maps wire `attack_type` to {@link AttackType}; unknown values log a warning and use Stun. */
    private resolveAttackTypeFromPacket(value: number): AttackType {
        switch (value) {
            case AttackType.NoInterrupt:
                return AttackType.NoInterrupt;
            case AttackType.Interrupt:
                return AttackType.Interrupt;
            case AttackType.Stun:
                return AttackType.Stun;
            case AttackType.Knockback:
                return AttackType.Knockback;
            default:
                console.warn(`Monster.takeDamage: unknown AttackType ${value}, using Stun`);
                return AttackType.Stun;
        }
    }

    /**
     * Knockback hit: take-damage animation and post-knockback stunlock use {@link stunDurationMs}; interpolation uses {@link knockbackDurationMs}.
     */
    private applyKnockbackDamage(
        stunDurationMs: number,
        knockbackDurationMs: number,
        destX: number,
        destY: number,
        knockbackFromX?: number,
        knockbackFromY?: number,
    ): void {
        if (this.currentState === MonsterState.TakeDamageWithKnockback) {
            return;
        }

        this.isAttacking = false;
        this.soundTracker.stopSound(MonsterState.Attack);

        this.takeDamageInterruptOnlyMs = undefined;
        this.takeDamageStunlockAnimationMs = stunDurationMs > 0 ? stunDurationMs : undefined;
        this.pendingPostStunlockMs = stunDurationMs > 0 ? stunDurationMs : undefined;

        const facingFromX =
            knockbackFromX !== undefined && knockbackFromY !== undefined ? knockbackFromX : this.worldX;
        const facingFromY =
            knockbackFromX !== undefined && knockbackFromY !== undefined ? knockbackFromY : this.worldY;
        const knockbackFacing = getNextDirection(facingFromX, facingFromY, destX, destY);
        if (knockbackFacing !== Direction.None) {
            this.direction = knockbackFacing;
        }

        this.applyKnockbackMovement(
            destX,
            destY,
            knockbackDurationMs > 0 ? knockbackDurationMs : KNOCKBACK_DURATION_MS,
            knockbackFromX,
            knockbackFromY,
        );
        this.switchMonsterState(MonsterState.TakeDamageWithKnockback, true);
    }

    private applyTakeDamageVisualEffects(attackType: AttackType, stunlockMs?: number): void {
        switch (attackType) {
            case AttackType.NoInterrupt:
                return;
            case AttackType.Interrupt:
            case AttackType.Knockback:
                this.takeDamageInterruptOnlyMs = MONSTER_INTERRUPT_HIT_DURATION_MS;
                this.takeDamageStunlockAnimationMs = undefined;
                this.pendingPostStunlockMs = undefined;
                break;
            case AttackType.Stun:
                if (stunlockMs !== undefined && stunlockMs > 0) {
                    this.takeDamageInterruptOnlyMs = undefined;
                    this.takeDamageStunlockAnimationMs = stunlockMs;
                    this.pendingPostStunlockMs = stunlockMs;
                } else {
                    this.takeDamageInterruptOnlyMs = MONSTER_INTERRUPT_HIT_DURATION_MS;
                    this.takeDamageStunlockAnimationMs = undefined;
                    this.pendingPostStunlockMs = undefined;
                }
                break;
            default:
                console.warn(`Monster.applyTakeDamageVisualEffects: unexpected AttackType ${attackType}`);
                this.takeDamageInterruptOnlyMs = undefined;
                this.takeDamageStunlockAnimationMs = undefined;
                this.pendingPostStunlockMs = undefined;
        }

        this.isAttacking = false;
        this.soundTracker.stopSound(MonsterState.Attack);

        if (this.moving) {
            this.switchMonsterState(MonsterState.TakeDamageOnMove, true);
        } else {
            this.switchMonsterState(MonsterState.TakeDamage, true);
        }
    }

    /**
     * Gets the monster's unique ID.
     * @returns The monster's ID
     */
    public getMonsterId(): string {
        return this.monsterId;
    }

    /**
     * Gets the monster's attack damage.
     */
    public getAttackDamage(): number {
        return this.attackDamage;
    }

    /**
     * Gets the monster's attack type.
     */
    public getAttackType(): AttackType {
        return this.attackType;
    }

    public getAttackSpeedMs(): number {
        return this.attackSpeedMs;
    }

    /**
     * Updates movement and/or melee swing durations from server snapshots or temporary-effect packets (e.g. Chill).
     * Omitted axes keep the previous authoritative values.
     */
    public applySpeedsMs(movementSpeedMs?: number, attackSpeedMs?: number): void {
        if (attackSpeedMs !== undefined) {
            this.attackSpeedMs = Math.max(1, attackSpeedMs);
            const attackAnimFrames = this.getStateAnimationConfig(MonsterState.Attack).animationFrames;
            this.attackSpeedFrameRate = calculateFrameRateFromDuration(attackAnimFrames, Math.max(1, this.attackSpeedMs));
        }

        if (movementSpeedMs !== undefined) {
            if (movementSpeedMs <= 0) {
                this.movementSpeedMs = 0;
            } else {
                this.movementSpeedMs = movementSpeedMs;
            }
            if (!this.moving) {
                this.movementFrameRate = calculateFrameRateFromDuration(
                    this.movementFrameCount,
                    Math.max(1, movementSpeedMs > 0 ? movementSpeedMs : 1),
                );
            }
        }
    }

    public getAllegiance(): MonsterAllegiance {
        return this.allegiance;
    }

    public hasInvisibilityBuff(): boolean {
        return this.hasTemporaryEffect(TemporaryEffectType.Invisibility);
    }

    protected override onTemporaryEffectsChanged(): void {
        this.applyInvisibilityBuffIfPresent();
        const chilled = this.spawnChilledVisual || this.hasTemporaryEffect(TemporaryEffectType.Chill);
        for (const asset of this.assets) {
            asset.setChilledTint(chilled);
        }
        const berserk = this.spawnBerserkVisual || this.hasTemporaryEffect(TemporaryEffectType.Berserk);
        for (const asset of this.assets) {
            asset.setSaturateOverlay(berserk, 0xff4444, 0.5);
        }
    }

    private applyInvisibilityBuffIfPresent(): void {
        const inv = this.hasInvisibilityBuff();
        if (!inv) {
            for (let i = 0; i < this.assets.length; i++) {
                this.assets[i].setAlpha(1);
                this.assets[i].setVisible(true);
            }
            if (this.shadowManager) {
                this.shadowManager.setAlpha(1);
            }
            return;
        }
        const friendly = this.allegiance === MonsterAllegiance.Friendly;
        if (friendly) {
            for (let i = 0; i < this.assets.length; i++) {
                this.assets[i].setAlpha(0.5);
                this.assets[i].setVisible(true);
            }
            if (this.shadowManager) {
                this.shadowManager.setAlpha(1);
            }
        } else {
            for (let i = 0; i < this.assets.length; i++) {
                this.assets[i].setAlpha(0);
            }
            if (this.shadowManager) {
                this.shadowManager.setAlpha(0);
            }
        }
    }
    
    /**
     * Overrides move to play movement sound at the start of each step.
     * Uses playOnce (not looping) to avoid artifacts when stopping at cell boundaries.
     */
    protected override move(direction: Direction): void {
        super.move(direction);
        const moveSound = this.getStateSound(MonsterState.Move);
        if (moveSound) {
            const spatialConfig = this.calculateSpatialConfig();
            const movementFrameCount = this.getMovementFrameCount();
            const effectiveMovementFrameRate = this.movementFrameRate * this.temporalCoefficient;
            const movementAnimationDuration = calculateAnimationDuration(movementFrameCount, effectiveMovementFrameRate);
            this.soundTracker.playOnce(moveSound, movementAnimationDuration, spatialConfig);
        }
    }

    /**
     * Applies one packet-driven grid step. Uses `cur`/`dest` like `Player.startMovementStep` so the
     * visual start tile matches the latest world snapshot and avoids jumps when the client grid was ahead/behind or on first reveal.
     */
    public startMovement(curX: number, curY: number, destX: number, destY: number, movementSpeedMs: number, facingDirection: number): void {
        if (this.dead || this.shouldKill) {
            return;
        }
        if (movementSpeedMs <= 0) {
            return;
        }

        if (this.worldX !== curX || this.worldY !== curY) {
            this.snapMonsterToWorldCell(curX, curY);
        }

        this.pendingSnapshotMoveIdleMs = undefined;
        this.pendingRemoteIdleSwitchMs = undefined;
        this.movementSpeedMs = movementSpeedMs;
        const movementDurationSeconds = this.movementSpeedMs / 1000;
        this.movementFrameRate = this.movementFrameCount / movementDurationSeconds;

        const startPixelX = worldCellCenterPixelX(curX);
        const startPixelY = worldCellCenterPixelY(curY);
        const currentPixelX = this.getAnimatedPixelX();
        const currentPixelY = this.getAnimatedPixelY();
        const pixelDelta = Phaser.Math.Distance.Between(currentPixelX, currentPixelY, startPixelX, startPixelY);
        if (pixelDelta > TILE_SIZE) {
            this.snapMonsterToWorldCell(curX, curY);
        } else if (this.moving || !this.moveReady) {
            this.snapMonsterToWorldCell(curX, curY);
        }

        const direction = toDirection(facingDirection);
        if (direction === Direction.None) {
            return;
        }

        this.destinationX = destX;
        this.destinationY = destY;
        this.isDirectMovementMode = false;
        // Use this.move (not super.move) so the override runs spatial movement sound for packet-driven steps.
        this.move(direction);
    }

    /** If the sprite is not at the center of the packet cell (e.g. mid-move lerp), snap before attack VFX. */
    private snapMonsterToAttackCellIfNeeded(worldX: number, worldY: number): void {
        const centerX = worldCellCenterPixelX(worldX);
        const centerY = worldCellCenterPixelY(worldY);
        if (this.getAnimatedPixelX() === centerX && this.getAnimatedPixelY() === centerY) {
            return;
        }
        this.snapMonsterToWorldCell(worldX, worldY);
    }

    private applyInitialEntityState(state: MonsterEntityState): void {
        this.pendingSnapshotMoveIdleMs = undefined;
        this.pendingRemoteIdleSwitchMs = undefined;
        switch (state) {
            case MonsterEntityState.MONSTER_ENTITY_STATE_ATTACK:
                this.isAttacking = true;
                this.attackAnimationDurationMs = undefined;
                this.switchMonsterState(MonsterState.Attack, true);
                break;
            case MonsterEntityState.MONSTER_ENTITY_STATE_MOVE:
                this.switchMonsterState(MonsterState.Move, true);
                this.pendingSnapshotMoveIdleMs = 200;
                break;
            case MonsterEntityState.MONSTER_ENTITY_STATE_IDLE:
                this.switchMonsterState(MonsterState.Idle, true);
                break;
        }
    }

    private snapMonsterToWorldCell(x: number, y: number): void {
        this.destinationX = -1;
        this.destinationY = -1;
        this.moving = false;
        this.moveReady = true;
        this.offsetX = 0;
        this.offsetY = 0;
        this.markCurrentTileFree();
        this.worldX = x;
        this.worldY = y;
        this.markCurrentTileOccupied();
        this.pendingRemoteIdleSwitchMs = undefined;
        this.switchMonsterState(MonsterState.Idle, true);
        this.updatePixelPosition();
    }

    /**
     * Delays switching to idle when a grid step ends so the next `startMovement` can arrive without a one-frame idle flash.
     */
    protected override onCellReached(): void {
        super.onCellReached();
        if (this.dead || this.shouldKill) {
            return;
        }
        if (this.destinationX < 0 || this.destinationY < 0) {
            this.pendingRemoteIdleSwitchMs = undefined;
            return;
        }
        if (this.worldX !== this.destinationX || this.worldY !== this.destinationY) {
            this.pendingRemoteIdleSwitchMs = undefined;
            return;
        }
        this.pendingRemoteIdleSwitchMs = this.remoteIdleContinuationGraceMs;
    }

    /**
     * Updates the shadow sprite animation based on current state and direction.
     * Syncs shadow frame with monster frame when switching states to prevent flicker.
     */
    private updateShadow(): void {
        if (!this.shadowManager) {
            return;
        }
        
        // Get animation configuration for current state
        const animConfig = this.getStateAnimationConfig(this.currentState);
        
        // Calculate shadow spritesheet index using config
        const shadowSpriteSheetIndex = animConfig.startSpriteSheet + this.direction;
        
        // Update shadow animation with appropriate frame rate
        const animationFrameRate = this.getAnimationFrameRate(this.currentState);
        
        // For attack, death, and take damage animations, play once (repeat: 0). For other states, use default (loop)
        const repeat = (this.currentState === MonsterState.Attack || this.currentState === MonsterState.Dead ||
            this.currentState === MonsterState.TakeDamage || this.currentState === MonsterState.TakeDamageOnMove ||
            this.currentState === MonsterState.TakeDamageWithKnockback) ? 0 : undefined;
        
        // Get monster's current frame to keep shadow in sync - prevents flicker when switching
        // between Idle and Move (monster may preserve frame but shadow was resetting to 0)
        const relativeFrame = this.assets.length > 0 ? this.assets[0].getCurrentRelativeFrame() : undefined;
        const playFromFrame = relativeFrame !== undefined
            ? animConfig.startAnimationFrame + relativeFrame
            : undefined;
        
        // Use config-driven shadow animation
        if (animConfig.startAnimationFrame > 0 || animConfig.animationFrames !== 8) {
            // Custom frame configuration - specify start and end frames
            const startFrame = animConfig.startAnimationFrame;
            const endFrame = animConfig.startAnimationFrame + animConfig.animationFrames - 1;
            this.shadowManager.updateAnimation(shadowSpriteSheetIndex, animationFrameRate, repeat, startFrame, endFrame, playFromFrame);
        } else {
            // Standard 8 frames starting at 0 - use simplified call
            this.shadowManager.updateAnimation(shadowSpriteSheetIndex, animationFrameRate, repeat, undefined, undefined, playFromFrame);
        }
    }
    
    /**
     * Calculates spatial audio configuration relative to player position.
     *
     * @returns Spatial configuration based on stored player coordinates
     */
    private calculateSpatialConfig(): SpatialConfig {
        return calculateSpatialAudio({
            sourceX: this.worldX,
            sourceY: this.worldY,
            listenerX: this.playerX,
            listenerY: this.playerY,
        });
    }
    
    /**
     * Updates sound effects based on the monster's state.
     * 
     * @param newState - The new MonsterState to update sounds for
     */
    private updateSound(newState: MonsterState): void {
        if (newState === MonsterState.TakeDamage || newState === MonsterState.TakeDamageOnMove ||
            newState === MonsterState.TakeDamageWithKnockback) {
            this.soundTracker.stopSound(MonsterState.Attack);
            const takeDamageSound = this.getStateSound(MonsterState.TakeDamage);
            if (takeDamageSound) {
                const spatialConfig = this.calculateSpatialConfig();
                this.soundTracker.playOnce(takeDamageSound, undefined, spatialConfig);
            }
        }
        // Movement sound is played in move() override at the start of each step
    }
    
    /**
     * Updates the stored player position and conditionally updates spatial audio.
     * Should be called when the player position changes.
     * 
     * @param playerX - Player's world X coordinate
     * @param playerY - Player's world Y coordinate
     */
    public updatePlayerPosition(playerX: number, playerY: number): void {
        // Store player coordinates
        this.playerX = playerX;
        this.playerY = playerY;
        
        // Movement sound is now playOnce per step; no spatial config updates needed
    }

    /**
     * Updates the idle continuation grace period in ms after a movement step ends (matches remote player setting).
     */
    public setRemoteIdleContinuationGraceMs(ms: number): void {
        this.remoteIdleContinuationGraceMs = Math.max(0, Math.min(500, Math.round(ms)));
    }
    
    /**
     * Gets the animation frame rate for the given state.
     * Frame rates are multiplied by temporalCoefficient to control animation speed.
     * For Move state, calculates frame rate to match movement duration for smooth sync.
     * 
     * @param state - The MonsterState to get the frame rate for
     * @returns The frame rate for the given state, multiplied by temporalCoefficient
     */
    private getAnimationFrameRate(state: MonsterState): number {
        let baseFrameRate: number;
        const animConfig = this.getStateAnimationConfig(state);
        
        switch (state) {
            case MonsterState.Move: {
                const movementDurationSeconds = Math.max(0.001, this.activeStepDurationMs / 1000);
                baseFrameRate = animConfig.animationFrames / movementDurationSeconds;
                break;
            }
            case MonsterState.Attack:
                if (this.attackAnimationDurationMs !== undefined) {
                    const sec = this.attackAnimationDurationMs / 1000;
                    baseFrameRate = animConfig.animationFrames / sec;
                    break;
                }
                // Adjust attack frame rate based on frame count ratio
                // Standard attack has 8 frames, so scale proportionally
                // E.g., 4 frames should play at half the speed to take the same time
                baseFrameRate = this.attackSpeedFrameRate * (animConfig.animationFrames / 8);
                break;
            case MonsterState.TakeDamage:
            case MonsterState.TakeDamageOnMove: {
                const takeDamageMs =
                    this.takeDamageInterruptOnlyMs ??
                    this.takeDamageStunlockAnimationMs ??
                    MONSTER_STUNLOCK_DURATION_MS;
                baseFrameRate = animConfig.animationFrames / (takeDamageMs / 1000);
                break;
            }
            case MonsterState.TakeDamageWithKnockback: {
                const takeDamageConfig = this.getStateAnimationConfig(MonsterState.TakeDamageWithKnockback);
                const kbMs = this.takeDamageStunlockAnimationMs ?? MONSTER_STUNLOCK_DURATION_MS;
                baseFrameRate = takeDamageConfig.animationFrames / (kbMs / 1000);
                break;
            }
            case MonsterState.Dead:
                // Adjust death frame rate based on frame count ratio
                // Standard death has 8 frames, so scale proportionally
                baseFrameRate = DEFAULT_ANIMATION_FRAME_RATE * (animConfig.animationFrames / 8);
                break;
            case MonsterState.Idle:
            default:
                // Adjust idle frame rate based on frame count ratio
                // Standard idle has 8 frames, so scale proportionally
                baseFrameRate = DEFAULT_ANIMATION_FRAME_RATE * (animConfig.animationFrames / 8);
                break;
        }
        return baseFrameRate * this.temporalCoefficient;
    }
    
    /**
     * Switches the monster's animation state.
     * Updates the asset to use the new sprite sheet index corresponding to the state.
     * Preserves the current direction and continues playing the animation from the same relative frame
     * (except for Attack and Dead states which always start from frame 0).
     * 
     * @param newState - The new MonsterState to switch to
     * @param forceUpdate - If true, updates animation even if state hasn't changed (for direction changes)
     */
    private switchMonsterState(newState: MonsterState, forceUpdate: boolean = false, deathInitialRelativeFrame?: number): void {
        // Don't switch if already in this state unless forceUpdate is true
        if (this.currentState === newState && !forceUpdate) {
            return;
        }
        
        // Handle sound switching based on new state
        this.updateSound(newState);
        
        // Get the current relative frame position from the asset
        // Attack, Death, and TakeDamage animations should always start from frame 0 (don't preserve relative frame)
        // Also don't preserve frame when transitioning between states with different frame counts
        let currentRelativeFrame: number | undefined;
        if (deathInitialRelativeFrame !== undefined && newState === MonsterState.Dead) {
            currentRelativeFrame = deathInitialRelativeFrame;
        } else if (newState === MonsterState.Attack || newState === MonsterState.Dead ||
            newState === MonsterState.TakeDamage || newState === MonsterState.TakeDamageOnMove ||
            newState === MonsterState.TakeDamageWithKnockback) {
            // Non-looping animations always start from frame 0
            currentRelativeFrame = undefined;
        } else {
            // Check if frame count changed between states
            const currentStateConfig = this.getStateAnimationConfig(this.currentState);
            const newStateConfig = this.getStateAnimationConfig(newState);
            
            if (currentStateConfig.animationFrames !== newStateConfig.animationFrames ||
                currentStateConfig.startAnimationFrame !== newStateConfig.startAnimationFrame) {
                // Different frame configurations - don't preserve frame
                currentRelativeFrame = undefined;
            } else {
                // Same frame configuration - preserve frame position for smooth transitions
                currentRelativeFrame = this.assets.length > 0 ? this.assets[0].getCurrentRelativeFrame() : undefined;
            }
        }
        
        this.currentState = newState;
        if (newState !== MonsterState.Move || this.moving) {
            this.pendingSnapshotMoveIdleMs = undefined;
            this.pendingRemoteIdleSwitchMs = undefined;
        }
        
        // Get animation configuration for this state
        const animConfig = this.getStateAnimationConfig(newState);
        
        // Use sprite name from config (allows for sprite overrides per state)
        const spriteName = animConfig.spriteName;
        
        // Calculate spriteSheetIndex for monster sprite using config
        const monsterSpriteSheetIndex = animConfig.startSpriteSheet + this.direction;
        
        // Switch animation for the monster asset
        if (this.assets.length > 0) {
            const asset = this.assets[0];
            
            // If sprite name changed, update the sprite texture
            if (spriteName !== this.monsterSpriteName) {
                // Change the sprite texture to use the override sprite
                asset.setSpriteName(spriteName);
            } else if (spriteName === this.monsterSpriteName && asset.getSpriteName() !== this.monsterSpriteName) {
                // Switching back to base sprite from an override
                asset.setSpriteName(this.monsterSpriteName);
            }
            
            // For monster sprite, spriteSheetIndex already encodes the direction (0-7 for idle, 8-15 for move)
            // So we always use direction 0 when playing, as the spriteSheetIndex itself represents the direction
            const animationKey = `sprite-${spriteName}-${monsterSpriteSheetIndex}`;
            const animationDirection = 0;
            
            // Play the animation with the correct frame rate and preserve relative frame position
            const animationFrameRate = this.getAnimationFrameRate(newState);
            
            // For attack, death, and take damage animations, play once (repeat: 0). For other states, use default (loop)
            const repeat = (newState === MonsterState.Attack || newState === MonsterState.Dead ||
                newState === MonsterState.TakeDamage || newState === MonsterState.TakeDamageOnMove ||
                newState === MonsterState.TakeDamageWithKnockback) ? 0 : undefined;
            
            // Determine animation type based on startAnimationFrame
            // If startAnimationFrame > 0, we need SubFrame animation (for custom frame ranges)
            const animationType = animConfig.startAnimationFrame > 0 ? AnimationType.SubFrame : AnimationType.FullFrame;
            const isLooping = repeat !== 0;
            
            // Use config-driven animation
            if (animConfig.startAnimationFrame > 0 || animConfig.animationFrames !== 8) {
                // Custom frame configuration (non-standard frame count or offset)
                asset.playAnimationWithDirection(
                    animationKey, 
                    animationDirection, 
                    animationFrameRate, 
                    currentRelativeFrame, 
                    repeat,
                    animConfig.animationFrames, // Custom frame count
                    animationType,
                    animConfig.startAnimationFrame, // Custom start frame
                    isLooping
                );
            } else {
                // Standard 8 frames starting at 0 - use simplified call
                asset.playAnimationWithDirection(animationKey, animationDirection, animationFrameRate, currentRelativeFrame, repeat);
            }
        }
        
        // Update shadow animation to match new state
        this.updateShadow();
    }
    
    /**
     * Implements abstract method from GameObject to switch state.
     * Maps GameObjectState to MonsterState and calls switchMonsterState.
     * 
     * @param state - The GameObjectState to switch to
     * @param forceUpdate - If true, updates animation even if state hasn't changed (for direction changes)
     */
    protected switchState(state: GameObjectState, forceUpdate: boolean = false): void {
        switch (state) {
            case GameObjectState.Idle:
                this.switchMonsterState(MonsterState.Idle, forceUpdate);
                break;
            case GameObjectState.Move:
                this.switchMonsterState(MonsterState.Move, forceUpdate);
                break;
        }
    }
    
    /**
     * Hook method called when the monster's position changes during movement.
     * Updates spatial audio for the movement sound using stored player coordinates.
     * 
     * @param _newX - New world X coordinate (unused)
     * @param _newY - New world Y coordinate (unused)
     */
    protected override onPositionChanged(_newX: number, _newY: number): void {
        // Update spatial audio when monster reaches a new cell using stored player coordinates
        this.updatePlayerPosition(this.playerX, this.playerY);
    }

    /**
     * Returns true when in TakeDamageOnMove state.
     */
    protected override isInTakeDamageOnMoveState(): boolean {
        return this.currentState === MonsterState.TakeDamageOnMove;
    }
    
    /**
     * Updates the monster's state.
     *
     * @param delta - Time elapsed since last frame in milliseconds
     */
    public override update(delta: number): void {
        // If dead, handle death animation and fade out
        if (this.dead) {
            if (this.pendingRemovalFade) {
                if (this.isPrimaryAssetAnimationPlaying()) {
                    return;
                }
                this.applyCorpseFadeStep();
                return;
            }
            if (this.waitForRemovalSignal) {
                if (this.isPrimaryAssetAnimationPlaying()) {
                    return;
                }
                return;
            }
            return; // Don't process any other logic when dead
        }
        
        // Check if marked for killing and not mid-cell
        if (this.shouldKill && !this.moving) {
            // Start death animation
            this.startDeathAnimation();
            return;
        }
        
        // Check if attack animation is complete (every frame for accuracy)
        if (this.isAttacking && !this.isPrimaryAssetAnimationPlaying()) {
            // Attack animation finished, return to idle state
            this.isAttacking = false;
            this.attackAnimationDurationMs = undefined;
            this.switchMonsterState(MonsterState.Idle);
        }

        // Check if take damage animation is complete
        if ((this.currentState === MonsterState.TakeDamage || this.currentState === MonsterState.TakeDamageOnMove) &&
            !this.isPrimaryAssetAnimationPlaying()) {
            const interruptOnly = this.takeDamageInterruptOnlyMs !== undefined;
            if (interruptOnly) {
                this.takeDamageInterruptOnlyMs = undefined;
            }
            this.takeDamageStunlockAnimationMs = undefined;
            if (this.moving) {
                if (!interruptOnly) {
                    this.setPendingStunlockAfterMovement();
                }
                this.switchMonsterState(MonsterState.Move, true);
            } else {
                if (!interruptOnly) {
                    this.startStunlock();
                }
                this.switchMonsterState(MonsterState.Idle);
            }
        }

        // Update knockback visual interpolation when in TakeDamageWithKnockback
        if (this.currentState === MonsterState.TakeDamageWithKnockback && this.isKnockbackActive()) {
            this.updateKnockbackVisual(delta);
        }

        // Check if take damage with knockback is complete (animation and movement both done)
        if (this.currentState === MonsterState.TakeDamageWithKnockback &&
            !this.isKnockbackActive() && !this.isPrimaryAssetAnimationPlaying()) {
            this.takeDamageStunlockAnimationMs = undefined;
            this.startStunlock();
            this.switchMonsterState(MonsterState.Idle);
        }

        // Call parent update for movement
        super.update(delta);

        if (!this.moving &&
            this.currentState === MonsterState.Move &&
            this.pendingRemoteIdleSwitchMs !== undefined) {
            this.pendingRemoteIdleSwitchMs = Math.max(0, this.pendingRemoteIdleSwitchMs - delta);
            if (this.pendingRemoteIdleSwitchMs === 0) {
                this.pendingRemoteIdleSwitchMs = undefined;
                this.switchMonsterState(MonsterState.Idle, true);
            }
        }

        this.updateStunlock(delta);
        if (this.pendingSnapshotMoveIdleMs !== undefined &&
            !this.moving &&
            this.currentState === MonsterState.Move) {
            this.pendingSnapshotMoveIdleMs = Math.max(0, this.pendingSnapshotMoveIdleMs - delta);
            if (this.pendingSnapshotMoveIdleMs === 0) {
                this.pendingSnapshotMoveIdleMs = undefined;
                this.switchMonsterState(MonsterState.Idle);
            }
        }
    }
    
    private startStunlockWithDuration(ms: number): void {
        this.stunlockDurationRestore = this.stunlockDurationMs;
        this.stunlockDurationMs = ms;
        this.stunlockElapsedMs = 0;
    }

    protected override startStunlock(): void {
        if (this.pendingPostStunlockMs !== undefined) {
            const ms = this.pendingPostStunlockMs;
            this.pendingPostStunlockMs = undefined;
            this.startStunlockWithDuration(ms);
            return;
        }
        super.startStunlock();
    }

    protected override onStunlockComplete(): void {
        if (this.stunlockDurationRestore !== undefined) {
            this.stunlockDurationMs = this.stunlockDurationRestore;
            this.stunlockDurationRestore = undefined;
        }
        super.onStunlockComplete();
    }

    /**
     * Destroys the monster and all associated resources including the shadow sprite.
     */
    public destroy(): void {
        super.destroy();
    }
}
