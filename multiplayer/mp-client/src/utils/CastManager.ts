import type { Scene } from 'phaser';
import { EventBus } from '../game/EventBus';
import { drawEffect } from './EffectUtils';
import { convertWorldPosToPixelPos } from './CoordinateUtils';
import type { Effect } from '../game/effects/Effect';
import type { SoundManager } from './SoundManager';
import type { CameraManager } from './CameraManager';
import type { SpellEntry } from '../Types';
import { TILE_SIZE } from '../game/assets/HBMap';
import { IN_UI_CAST_EFFECT, IN_UI_KILL_ALL_EFFECTS, OUT_UI_CAST_READY, OUT_UI_CAST_REMOVED } from '../constants/EventNames';
import { Blizzard } from '../game/spells/Blizzard';
import { EarthShockWave } from '../game/spells/EarthShockWave';
import { BloodyShockWave } from '../game/spells/BloodyShockWave';
import { LightningBolt } from '../game/spells/LightningBolt';
import { LightningStrike } from '../game/spells/LightningStrike';
import { EnergyStrike } from '../game/spells/EnergyStrike';
import { EnergyBolt } from '../game/spells/EnergyBolt';
import { TripleEnergyBolt } from '../game/spells/TripleEnergyBolt';
import { FireBall } from '../game/spells/FireBall';
import { FireStrike } from '../game/spells/FireStrike';
import { MassFireStrike } from '../game/spells/MassFireStrike';
import { MeteorStrikeProjectile } from '../game/spells/MeteorStrikeProjectile';
import { EarthwormStrike } from '../game/spells/EarthwormStrike';
import { ArmorBreak } from '../game/spells/ArmorBreak';
import { IceStrike } from '../game/spells/IceStrike';
import { MassIceStrike } from '../game/spells/MassIceStrike';
import { ChillWind } from '../game/spells/ChillWind';
import { MassChillWind } from '../game/spells/MassChillWind';
import { EFFECT_ICE_STRIKE_LARGE_SHARD } from '../constants/Effects';
import type { BlizzardConfig } from '../game/spells/Blizzard';
import type { BlizzardShardConfig } from '../game/spells/BlizzardShard';
import type { IceStrikeShardConfig } from '../game/spells/IceStrikeShard';
import type { Player } from '../game/objects/Player';
import type { Monster } from '../game/objects/Monster';
import { getNetworkManager } from './RegistryUtils';
import { runSafeSync } from './SafeEntry';
import type {
    CastAoeSpellEventData,
    CastDirectionalAoeSpellEventData,
    MonsterCastAoeSpellEventData,
    MonsterCastDirectionalAoeSpellEventData,
} from '../Types';
import {
    SPELL_ARMOR_BREAK_ID,
    SPELL_CHILL_WIND_ID,
    SPELL_EARTHWORM_STRIKE_ID,
    SPELL_ENERGY_BOLT_ID,
    SPELL_ENERGY_STRIKE_ID,
    SPELL_FIRE_BALL_ID,
    SPELL_FIRE_STRIKE_ID,
    SPELL_ICE_STRIKE_ID,
    SPELL_LIGHTNING_STRIKE_ID,
    SPELL_MASS_CHILL_WIND_ID,
    SPELL_MASS_FIRE_STRIKE_ID,
    SPELL_MASS_ICE_STRIKE_ID,
    SPELL_MASS_LIGHTNING_STRIKE_ID,
    SPELL_METEOR_STRIKE_ID,
    SPELL_TRIPLE_ENERGY_BOLT_ID,
    SPELL_BLIZZARD_ID,
    SPELL_MASS_BLIZZARD_ID,
    SPELL_EARTH_SHOCK_WAVE_ID,
    SPELL_BLOODY_SHOCK_WAVE_ID,
    SPELL_LIGHTNING_BOLT_ID,
} from '../constants/Spells';

export interface CastManagerConfig {
    scene: Scene;
    soundManager: SoundManager;
    cameraManager: CameraManager | undefined;
    getPlayerWorldPos: () => { x: number; y: number } | undefined;
}

/** Tracks pending cast placement effects and active spell visuals. */
export class CastManager {
    private readonly scene: Scene;
    private readonly soundManager: SoundManager;
    private readonly cameraManager: CameraManager | undefined;
    private readonly getPlayerWorldPos: () => { x: number; y: number } | undefined;

    private pendingEffectKey: string | undefined;
    private pendingEffectInfiniteLoop = false;
    private castReady = false;
    private effects: Effect[] = [];

    private readonly boundCastEffect: (data: { effectKey: string; infiniteLoop: boolean }) => void;
    private readonly boundKillAllEffects: () => void;

    constructor(config: CastManagerConfig) {
        this.scene = config.scene;
        this.soundManager = config.soundManager;
        this.cameraManager = config.cameraManager;
        this.getPlayerWorldPos = config.getPlayerWorldPos;

        this.boundCastEffect = (data) => runSafeSync('CastManager:castEffect', () => this.handleCastEffect(data));
        this.boundKillAllEffects = () =>
            runSafeSync('CastManager:killAllEffects', () => this.handleKillAllEffects());
    }

    public setupEventListeners(): void {
        EventBus.on(IN_UI_CAST_EFFECT, this.boundCastEffect);
        EventBus.on(IN_UI_KILL_ALL_EFFECTS, this.boundKillAllEffects);
    }

    public destroyEventListeners(): void {
        EventBus.off(IN_UI_CAST_EFFECT);
        EventBus.off(IN_UI_KILL_ALL_EFFECTS);
    }

    public getPendingEffectKey(): string | undefined {
        return this.pendingEffectKey;
    }

    public getPendingEffectInfiniteLoop(): boolean {
        return this.pendingEffectInfiniteLoop;
    }

    public clearPendingEffect(): void {
        this.pendingEffectKey = undefined;
        this.pendingEffectInfiniteLoop = false;
        EventBus.emit(OUT_UI_CAST_REMOVED);
    }

    public getCastReady(): boolean {
        return this.castReady;
    }

    public setCastReady(value: boolean): void {
        this.castReady = value;
    }

    public tryPlaceEffect(worldX: number, worldY: number): boolean {
        if (!this.pendingEffectKey) {
            return false;
        }

        const playerPos = this.getPlayerWorldPos();
        const effect = drawEffect(this.scene, worldX, worldY, this.pendingEffectKey, {
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
            infiniteLoop: this.pendingEffectInfiniteLoop,
            onDestroy: () => {
                const index = this.effects.indexOf(effect!);
                if (index !== -1) {
                    this.effects.splice(index, 1);
                }
            },
        });

        if (effect) {
            this.effects.push(effect);
            this.castReady = true;
            EventBus.emit(OUT_UI_CAST_REMOVED);
        }

        this.pendingEffectKey = undefined;
        this.pendingEffectInfiniteLoop = false;
        return !!effect;
    }

    public getOnEffectCreated(): (effect: Effect) => () => void {
        return (effect: Effect) => {
            this.effects.push(effect);
            return () => {
                const index = this.effects.indexOf(effect);
                if (index !== -1) {
                    this.effects.splice(index, 1);
                }
            };
        };
    }

    public castFireBall(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        projectileSpeed: number
    ): void {
        const playerPos = this.getPlayerWorldPos();
        new FireBall(
            this.scene,
            originPixelX,
            originPixelY,
            targetWorldX,
            targetWorldY,
            {
                projectileSpeed,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castChillWind(targetWorldX: number, targetWorldY: number, spell: SpellEntry): void {
        if (spell.projectileSpeed === undefined) {
            console.warn('[CastManager] Chill Wind missing projectileSpeed.', { spell });
            return;
        }

        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        const dropDistance = spell.projectileDistancePx ?? 200;

        const playerPos = this.getPlayerWorldPos();
        new ChillWind(this.scene, targetPixelX, targetPixelY, {
            dropDistance,
            projectileSpeed: spell.projectileSpeed,
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
        });
    }

    public castMassChillWind(targetWorldX: number, targetWorldY: number, spell: SpellEntry): void {
        if (spell.projectileSpeed === undefined) {
            console.warn('[CastManager] Mass Chill Wind missing projectileSpeed.', { spell });
            return;
        }

        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        const dropDistance = spell.projectileDistancePx ?? 200;

        const playerPos = this.getPlayerWorldPos();
        new MassChillWind(this.scene, targetPixelX, targetPixelY, {
            dropDistance,
            projectileSpeed: spell.projectileSpeed,
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
        });
    }

    private createIceStrikeShardConfig(spell: SpellEntry): IceStrikeShardConfig | undefined {
        if (spell.projectileSpeed === undefined) {
            console.warn('[CastManager] Ice Strike family spell missing projectileSpeed.', { spell });
            return undefined;
        }

        const projectileDistance = spell.projectileDistancePx ?? 300;
        const playerPos = this.getPlayerWorldPos();
        return {
            dropDistanceMin: projectileDistance,
            dropDistanceMax: projectileDistance + 200,
            dropSpeedMin: spell.projectileSpeed - 300,
            dropSpeedMax: spell.projectileSpeed,
            fadeInDuration: 50,
            impactFadeOutDuration: 500,
            impactAnimationSpeed: 15,
            shardEffectKey: EFFECT_ICE_STRIKE_LARGE_SHARD,
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
            cameraManager: this.cameraManager,
        };
    }

    public castIceStrike(targetWorldX: number, targetWorldY: number, spell: SpellEntry): void {
        const shardConfig = this.createIceStrikeShardConfig(spell);
        if (!shardConfig) {
            return;
        }

        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        new IceStrike(this.scene, targetPixelX, targetPixelY, shardConfig);
    }

    public castMassIceStrike(targetWorldX: number, targetWorldY: number, spell: SpellEntry): void {
        const shardConfig = this.createIceStrikeShardConfig(spell);
        if (!shardConfig) {
            return;
        }

        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        new MassIceStrike(this.scene, targetPixelX, targetPixelY, shardConfig);
    }

    public castMeteorStrike(targetWorldX: number, targetWorldY: number, spell: SpellEntry): void {
        if (spell.projectileSpeed === undefined || spell.projectileDistancePx === undefined) {
            console.warn('[CastManager] Meteor Strike missing projectileSpeed or projectileDistancePx.', { spell });
            return;
        }

        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        const playerPos = this.getPlayerWorldPos();
        new MeteorStrikeProjectile(this.scene, targetPixelX, targetPixelY, {
            projectileSpeed: spell.projectileSpeed,
            projectileDistancePx: spell.projectileDistancePx,
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
            cameraManager: this.cameraManager,
        });
    }

    public castEarthwormStrike(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number
    ): void {
        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        const playerPos = this.getPlayerWorldPos();
        new EarthwormStrike(this.scene, originPixelX, originPixelY, targetPixelX, targetPixelY, {
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
            cameraManager: this.cameraManager,
        });
    }

    public castArmorBreak(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number
    ): void {
        const halfTile = TILE_SIZE / 2;
        const targetPixelX = convertWorldPosToPixelPos(targetWorldX) + halfTile;
        const targetPixelY = convertWorldPosToPixelPos(targetWorldY) + halfTile;
        const playerPos = this.getPlayerWorldPos();
        new ArmorBreak(this.scene, originPixelX, originPixelY, targetPixelX, targetPixelY, {
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
        });
    }

    public castEnergyBolt(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        projectileSpeed: number
    ): void {
        const playerPos = this.getPlayerWorldPos();
        new EnergyBolt(
            this.scene,
            originPixelX,
            originPixelY,
            targetWorldX,
            targetWorldY,
            {
                projectileSpeed,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castFireStrike(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        projectileSpeed: number
    ): void {
        const playerPos = this.getPlayerWorldPos();
        new FireStrike(
            this.scene,
            originPixelX,
            originPixelY,
            targetWorldX,
            targetWorldY,
            {
                projectileSpeed,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castMassFireStrike(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        projectileSpeed: number
    ): void {
        const playerPos = this.getPlayerWorldPos();
        new MassFireStrike(
            this.scene,
            originPixelX,
            originPixelY,
            targetWorldX,
            targetWorldY,
            {
                projectileSpeed,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castTripleEnergyBolt(
        originPixelX: number,
        originPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        projectileSpeed: number
    ): void {
        const playerPos = this.getPlayerWorldPos();
        new TripleEnergyBolt(
            this.scene,
            originPixelX,
            originPixelY,
            targetWorldX,
            targetWorldY,
            {
                projectileSpeed,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castDirectionalBlizzard(
        casterWorldX: number,
        casterWorldY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry
    ): void {
        const blizzardConfig = this.getDirectionalBlizzardConfig(spell);
        if (!blizzardConfig) {
            console.warn('[CastManager] Missing Blizzard config.', { spell });
            return;
        }

        const playerPos = this.getPlayerWorldPos();
        const shardConfig: BlizzardShardConfig = {
            dropDistanceMin: 300,
            dropDistanceMax: 500,
            dropSpeedMin: 200,
            dropSpeedMax: 500,
            fadeInDuration: 200,
            impactFadeOutDuration: 500,
            impactAnimationSpeed: 15,
            soundManager: this.soundManager,
            playerWorldX: playerPos?.x,
            playerWorldY: playerPos?.y,
            cameraManager: this.cameraManager,
        };

        new Blizzard(
            this.scene,
            convertWorldPosToPixelPos(casterWorldX) + 16,
            convertWorldPosToPixelPos(casterWorldY) + 16,
            targetWorldX,
            targetWorldY,
            blizzardConfig,
            shardConfig
        );
    }

    public castEarthShockWave(
        casterWorldX: number,
        casterWorldY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry
    ): void {
        if (spell.durationMs === undefined || spell.projectileSpeed === undefined) {
            console.warn('[CastManager] Missing linear AoE duration or projectile speed.', { spell });
            return;
        }

        const playerPos = this.getPlayerWorldPos();
        const halfTile = TILE_SIZE / 2;
        new EarthShockWave(
            this.scene,
            convertWorldPosToPixelPos(casterWorldX) + halfTile,
            convertWorldPosToPixelPos(casterWorldY) + halfTile,
            convertWorldPosToPixelPos(targetWorldX) + halfTile,
            convertWorldPosToPixelPos(targetWorldY) + halfTile,
            {
                duration: spell.durationMs,
                projectileSpeed: spell.projectileSpeed,
                emissionInterval: 20,
                immobileEmissionInterval: 100,
                cameraManager: this.cameraManager,
            },
            {
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
            }
        );
    }

    public castBloodyShockWave(
        casterWorldX: number,
        casterWorldY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry
    ): void {
        if (spell.durationMs === undefined) {
            console.warn('[CastManager] Missing linear AoE duration.', { spell });
            return;
        }

        const playerPos = this.getPlayerWorldPos();
        const halfTile = TILE_SIZE / 2;
        new BloodyShockWave(
            this.scene,
            convertWorldPosToPixelPos(casterWorldX) + halfTile,
            convertWorldPosToPixelPos(casterWorldY) + halfTile,
            convertWorldPosToPixelPos(targetWorldX) + halfTile,
            convertWorldPosToPixelPos(targetWorldY) + halfTile,
            {
                duration: spell.durationMs,
                emissionInterval: 20,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castLightningBolt(
        casterWorldX: number,
        casterWorldY: number,
        targetWorldX: number,
        targetWorldY: number
    ): void {
        const playerPos = this.getPlayerWorldPos();
        const halfTile = TILE_SIZE / 2;
        new LightningBolt(
            this.scene,
            convertWorldPosToPixelPos(casterWorldX) + halfTile,
            convertWorldPosToPixelPos(casterWorldY) + halfTile,
            convertWorldPosToPixelPos(targetWorldX) + halfTile,
            convertWorldPosToPixelPos(targetWorldY) + halfTile,
            {
                arcDuration: 120,
                arcPeriod: 20,
                impactAnimationSpeed: 50,
                soundManager: this.soundManager,
                playerWorldX: playerPos?.x,
                playerWorldY: playerPos?.y,
                cameraManager: this.cameraManager,
            }
        );
    }

    public castLightningStrike(
        casterPixelX: number,
        casterPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry
    ): void {
        if (spell.aoeRadius === undefined) {
            console.warn('[CastManager] Lightning Strike missing aoeRadius.', { spell });
            return;
        }

        const playerPos = this.getPlayerWorldPos();
        const halfTile = TILE_SIZE / 2;
        new LightningStrike(
            this.scene,
            casterPixelX,
            casterPixelY,
            convertWorldPosToPixelPos(targetWorldX) + halfTile,
            convertWorldPosToPixelPos(targetWorldY) + halfTile,
            {
                strikeInterval: 120,
                strikes: 5,
                radius: spell.aoeRadius,
                lightningBoltConfig: {
                    arcDuration: 120,
                    arcPeriod: 20,
                    impactAnimationSpeed: 50,
                    soundManager: this.soundManager,
                    playerWorldX: playerPos?.x,
                    playerWorldY: playerPos?.y,
                    cameraManager: this.cameraManager,
                },
            }
        );
    }

    public castMassLightningStrike(
        casterPixelX: number,
        casterPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry
    ): void {
        if (spell.aoeRadius === undefined) {
            console.warn('[CastManager] Mass Lightning Strike missing aoeRadius.', { spell });
            return;
        }

        const playerPos = this.getPlayerWorldPos();
        const halfTile = TILE_SIZE / 2;
        new LightningStrike(
            this.scene,
            casterPixelX,
            casterPixelY,
            convertWorldPosToPixelPos(targetWorldX) + halfTile,
            convertWorldPosToPixelPos(targetWorldY) + halfTile,
            {
                strikeInterval: 50,
                strikes: 12,
                radius: spell.aoeRadius,
                lightningBoltConfig: {
                    arcDuration: 120,
                    arcPeriod: 20,
                    impactAnimationSpeed: 50,
                    soundManager: this.soundManager,
                    playerWorldX: playerPos?.x,
                    playerWorldY: playerPos?.y,
                    cameraManager: this.cameraManager,
                },
            }
        );
    }

    public castEnergyStrike(
        casterPixelX: number,
        casterPixelY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry
    ): void {
        if (spell.aoeRadius === undefined || spell.projectileSpeed === undefined) {
            console.warn('[CastManager] Energy Strike missing aoeRadius or projectileSpeed.', { spell });
            return;
        }

        const playerPos = this.getPlayerWorldPos();
        const halfTile = TILE_SIZE / 2;
        new EnergyStrike(
            this.scene,
            casterPixelX,
            casterPixelY,
            convertWorldPosToPixelPos(targetWorldX) + halfTile,
            convertWorldPosToPixelPos(targetWorldY) + halfTile,
            {
                projectiles: 8,
                emissionInterval: 80,
                radius: spell.aoeRadius,
                projectileConfig: {
                    projectileSpeed: spell.projectileSpeed,
                    soundManager: this.soundManager,
                    playerWorldX: playerPos?.x,
                    playerWorldY: playerPos?.y,
                    cameraManager: this.cameraManager,
                },
            }
        );
    }

    /**
     * Server-driven player AoE spell visuals (packet fan-out from GameWorld).
     */
    public dispatchNetworkPlayerAoeSpell(caster: Player, data: CastAoeSpellEventData): void {
        const spell = getNetworkManager(this.scene.game)?.getSpellById(data.spellId);
        if (!spell) {
            console.warn('[CastManager] Missing spell config for AoE cast.', { spellId: data.spellId });
            return;
        }
        const ox = caster.getAnimatedPixelX();
        const oy = caster.getAnimatedPixelY();
        this.dispatchNetworkAoeSpellCore(ox, oy, data.spellId, data.x, data.y, spell);
    }

    /**
     * Server-driven monster AoE spell visuals.
     */
    public dispatchNetworkMonsterAoeSpell(monster: Monster, data: MonsterCastAoeSpellEventData): void {
        const spell = getNetworkManager(this.scene.game)?.getSpellById(data.spellId);
        if (!spell) {
            console.warn('[CastManager] Missing spell config for monster AoE cast.', { spellId: data.spellId });
            return;
        }
        const ox = monster.getAnimatedPixelX();
        const oy = monster.getAnimatedPixelY();
        this.dispatchNetworkAoeSpellCore(ox, oy, data.spellId, data.x, data.y, spell);
    }

    private dispatchNetworkAoeSpellCore(
        originPixelX: number,
        originPixelY: number,
        spellId: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry,
    ): void {
        switch (spellId) {
            case SPELL_FIRE_BALL_ID:
                this.castFireBall(originPixelX, originPixelY, targetWorldX, targetWorldY, spell.projectileSpeed ?? 1500);
                break;
            case SPELL_LIGHTNING_STRIKE_ID:
                this.castLightningStrike(originPixelX, originPixelY, targetWorldX, targetWorldY, spell);
                break;
            case SPELL_MASS_LIGHTNING_STRIKE_ID:
                this.castMassLightningStrike(originPixelX, originPixelY, targetWorldX, targetWorldY, spell);
                break;
            case SPELL_ENERGY_STRIKE_ID:
                this.castEnergyStrike(originPixelX, originPixelY, targetWorldX, targetWorldY, spell);
                break;
            case SPELL_ENERGY_BOLT_ID: {
                if (spell.projectileSpeed === undefined) {
                    console.warn('[CastManager] Energy Bolt missing projectileSpeed.', { spell });
                    break;
                }
                this.castEnergyBolt(originPixelX, originPixelY, targetWorldX, targetWorldY, spell.projectileSpeed);
                break;
            }
            case SPELL_TRIPLE_ENERGY_BOLT_ID: {
                if (spell.projectileSpeed === undefined) {
                    console.warn('[CastManager] Triple Energy Bolt missing projectileSpeed.', { spell });
                    break;
                }
                this.castTripleEnergyBolt(originPixelX, originPixelY, targetWorldX, targetWorldY, spell.projectileSpeed);
                break;
            }
            case SPELL_FIRE_STRIKE_ID: {
                if (spell.projectileSpeed === undefined) {
                    console.warn('[CastManager] Fire Strike missing projectileSpeed.', { spell });
                    break;
                }
                this.castFireStrike(originPixelX, originPixelY, targetWorldX, targetWorldY, spell.projectileSpeed);
                break;
            }
            case SPELL_MASS_FIRE_STRIKE_ID: {
                if (spell.projectileSpeed === undefined) {
                    console.warn('[CastManager] Mass Fire Strike missing projectileSpeed.', { spell });
                    break;
                }
                this.castMassFireStrike(originPixelX, originPixelY, targetWorldX, targetWorldY, spell.projectileSpeed);
                break;
            }
            case SPELL_CHILL_WIND_ID:
                this.castChillWind(targetWorldX, targetWorldY, spell);
                break;
            case SPELL_MASS_CHILL_WIND_ID:
                this.castMassChillWind(targetWorldX, targetWorldY, spell);
                break;
            case SPELL_ICE_STRIKE_ID:
                this.castIceStrike(targetWorldX, targetWorldY, spell);
                break;
            case SPELL_MASS_ICE_STRIKE_ID:
                this.castMassIceStrike(targetWorldX, targetWorldY, spell);
                break;
            case SPELL_METEOR_STRIKE_ID:
                this.castMeteorStrike(targetWorldX, targetWorldY, spell);
                break;
            case SPELL_EARTHWORM_STRIKE_ID:
                this.castEarthwormStrike(originPixelX, originPixelY, targetWorldX, targetWorldY);
                break;
            case SPELL_ARMOR_BREAK_ID:
                this.castArmorBreak(originPixelX, originPixelY, targetWorldX, targetWorldY);
                break;
        }
    }

    /**
     * Server-driven directional AoE from a player caster.
     */
    public dispatchNetworkPlayerDirectionalAoeSpell(data: CastDirectionalAoeSpellEventData): void {
        const spell = getNetworkManager(this.scene.game)?.getSpellById(data.spellId);
        if (!spell) {
            console.warn('[CastManager] Missing spell config for directional AoE cast.', { spellId: data.spellId });
            return;
        }
        this.dispatchNetworkDirectionalAoeCore(data.spellId, data.casterX, data.casterY, data.targetX, data.targetY, spell);
    }

    /**
     * Server-driven directional AoE from a monster caster.
     */
    public dispatchNetworkMonsterDirectionalAoeSpell(data: MonsterCastDirectionalAoeSpellEventData): void {
        const spell = getNetworkManager(this.scene.game)?.getSpellById(data.spellId);
        if (!spell) {
            console.warn('[CastManager] Missing spell config for monster directional AoE cast.', { spellId: data.spellId });
            return;
        }
        this.dispatchNetworkDirectionalAoeCore(data.spellId, data.casterX, data.casterY, data.targetX, data.targetY, spell);
    }

    private dispatchNetworkDirectionalAoeCore(
        spellId: number,
        casterWorldX: number,
        casterWorldY: number,
        targetWorldX: number,
        targetWorldY: number,
        spell: SpellEntry,
    ): void {
        switch (spellId) {
            case SPELL_BLIZZARD_ID:
            case SPELL_MASS_BLIZZARD_ID:
                this.castDirectionalBlizzard(casterWorldX, casterWorldY, targetWorldX, targetWorldY, spell);
                break;
            case SPELL_EARTH_SHOCK_WAVE_ID:
                this.castEarthShockWave(casterWorldX, casterWorldY, targetWorldX, targetWorldY, spell);
                break;
            case SPELL_BLOODY_SHOCK_WAVE_ID:
                this.castBloodyShockWave(casterWorldX, casterWorldY, targetWorldX, targetWorldY, spell);
                break;
            case SPELL_LIGHTNING_BOLT_ID:
                this.castLightningBolt(casterWorldX, casterWorldY, targetWorldX, targetWorldY);
                break;
            default:
                console.warn('[CastManager] Unhandled directional AoE spell id.', { spellId });
        }
    }

    public killAllEffects(): void {
        console.log(`[CastManager] Killing all effects (${this.effects.length} total)`);
        const effectsToDestroy = [...this.effects];
        this.effects = [];
        for (const effect of effectsToDestroy) {
            effect.destroy();
        }
    }

    public destroy(): void {
        this.destroyEventListeners();
        if (this.pendingEffectKey) {
            EventBus.emit(OUT_UI_CAST_REMOVED);
        }
        this.pendingEffectKey = undefined;
        this.pendingEffectInfiniteLoop = false;
        this.killAllEffects();
    }

    private handleCastEffect(data: { effectKey: string; infiniteLoop: boolean }): void {
        this.pendingEffectKey = data.effectKey;
        this.pendingEffectInfiniteLoop = data.infiniteLoop;
        EventBus.emit(OUT_UI_CAST_READY);
    }

    private handleKillAllEffects(): void {
        this.killAllEffects();
    }

    private getDirectionalBlizzardConfig(spell: SpellEntry): BlizzardConfig | undefined {
        if (spell.projectileSpeed === undefined ||
            spell.emissionSteps === undefined ||
            spell.startRadius === undefined ||
            spell.endRadius === undefined ||
            spell.startShards === undefined ||
            spell.endShards === undefined) {
            return undefined;
        }

        return {
            projectileSpeed: spell.projectileSpeed,
            emissionSteps: spell.emissionSteps,
            startRadius: spell.startRadius,
            endRadius: spell.endRadius,
            startShards: spell.startShards,
            endShards: spell.endShards,
        };
    }
}
