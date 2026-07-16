import { SpriteAssetFormat } from '../game/assets/SpriteAssetFormat';
import { MonsterShadow } from '../game/objects/Monster';

/**
 * Client defaults per monster sprite: sounds, per-state animation overrides, corpse fade.
 * Server sends display names; row comments tagged `asset:` flag uncertain art/audio.
 */

/**
 * Animation configuration for a specific state.
 */
export interface StateAnimationConfig {
    /** 
     * Start sprite sheet index (defaults to standard monster mapping if not specified).
     * For example, 0 for idle. Directions are added on top of this value.
     */
    startSpriteSheet?: number;
    
    /** 
     * Starting frame index within the animation (defaults to 0).
     * Used for SubFrame animations like wyverns (e.g., 4 for wyvern attack frames 4-7).
     */
    startAnimationFrame?: number;
    
    /** 
     * Number of frames in the animation (defaults to 8).
     * Wyverns use 4 for some states, giant frogs use 5 for movement.
     */
    animationFrames?: number;
    
    /** 
     * Sprite name to override the base sprite for this animation (optional).
     * When specified, this sprite will be used instead of the base monster sprite for this state.
     * Opacity from the base monster configuration will be applied to the override sprite.
     */
    spriteName?: string;
}

/**
 * State configuration including sound and animation data.
 */
export interface MonsterStateConfig {
    /** Sound file to play for this state (with extension, e.g., 'M91.mp3') */
    sound?: string;
    
    /** Animation configuration for this state */
    animation?: StateAnimationConfig;
}

export interface MonsterStatesConfig {
    idle?: MonsterStateConfig;
    move?: MonsterStateConfig;
    attack?: MonsterStateConfig;
    /** Sound plays once at original duration when entering this state. */
    takeDamage?: MonsterStateConfig;
    death?: MonsterStateConfig;
}

/**
 * Client-side monster static data (sprite, sounds, animation). Display names are provided by the server.
 */
export interface MonsterData {
    /** Sprite name without extension (e.g., 'ettin') */
    spriteName: string;

    /**
    * Runtime asset format used to render this monster.
    * Existing monsters default to the legacy SPR format.
    */
    assetFormat?: SpriteAssetFormat;

    /** State-specific configuration (sound and animation data) */
    states?: MonsterStatesConfig;
    
    /** Time in seconds before corpse starts fading */
    corpseDecayTime: number;
    
    /** Temporal coefficient controlling animation speed (defaults to 1.0) */
    temporalCoefficient?: number;
    
    /** Shadow display option (defaults to BodyShadow) */
    shadow?: MonsterShadow;
    
    /** Opacity/transparency of the monster sprite (defaults to 1.0, range 0.0-1.0) */
    opacity?: number;

    /** Estimated height of the monster in pixels. Used to position damage indicator above the monster. */
    height?: number;

    /** When true, monster spawns ArrowProjectile toward player instead of dealing damage immediately. */
    bowAttack?: boolean;
}

export const MONSTERS: MonsterData[] = [
    {
        spriteName: 'ettin',
        states: {
            move: { sound: 'M91.mp3' },
            attack: { sound: 'M92.mp3' },
            takeDamage: { sound: 'M93.mp3' },
            death: { sound: 'M94.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'slm',
        states: {
            move: { sound: 'M1.mp3' },
            attack: { sound: 'M2.mp3' },
            takeDamage: { sound: 'M3.mp3' },
            death: { sound: 'M4.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'ant',
        states: {
            move: { sound: 'M29.mp3' },
            attack: { sound: 'M30.mp3' },
            takeDamage: { sound: 'M31.mp3' },
            death: { sound: 'M32.mp3' }
        },
        temporalCoefficient: 0.5,
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'amp',
        states: {
            move: { sound: 'M25.mp3' },
            attack: { sound: 'M26.mp3' },
            takeDamage: { sound: 'M27.mp3' },
            death: { sound: 'M28.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'abs',
        states: { // asset: verify sounds
            move: { sound: 'M63.mp3' },
            attack: { sound: 'M64.mp3' },
            takeDamage: { sound: 'M65.mp3' },
            death: { sound: 'M66.mp3' }
        },
        corpseDecayTime: 3,
        height: 80,
    },
    {
        spriteName: 'barlog',
        states: {
            move: { sound: 'M130.mp3' },
            attack: { sound: 'M131.mp3' },
            takeDamage: { sound: 'M128.mp3' },
            death: { sound: 'M129.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'bunny',
        states: {
            move: { sound: 'M71.mp3' },
            attack: { sound: 'M75.mp3' },
            takeDamage: { sound: 'M79.mp3' },
            death: { sound: 'M83.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'beholder',
        states: {
            move: { sound: 'E46.mp3' },
            attack: {
                sound: 'C6.mp3',
                animation: {
                    animationFrames: 12
                }
            },
            takeDamage: { sound: 'M3.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'bg',
        states: {
            move: { sound: 'M33.mp3' },
            attack: { sound: 'M34.mp3' },
            takeDamage: { sound: 'M35.mp3' },
            death: { sound: 'M36.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'canplant',
        states: {
            move: { sound: 'M95.mp3' },
            attack: { sound: 'M96.mp3' },
            takeDamage: { sound: 'M97.mp3' },
            death: { sound: 'M98.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'cat',
        states: {
            move: { sound: 'M72.mp3' },
            attack: { sound: 'M76.mp3' },
            takeDamage: { sound: 'M80.mp3' },
            death: { sound: 'M84.mp3' }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'bograt',
        assetFormat: SpriteAssetFormat.Atlas,
        states: {
            move: { sound: 'M72.mp3' },
            attack: { sound: 'M76.mp3' },
            takeDamage: { sound: 'M80.mp3' },
            death: { sound: 'M84.mp3' }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'catapult', // asset: no state sounds yet
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'centaurus',
        states: {
            move: { sound: 'M117.mp3' },
            attack: { sound: 'M119.mp3' },
            takeDamage: { sound: 'M116.mp3' },
            death: { sound: 'C7.mp3' } // asset: verify
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'cla',
        states: {
            move: { sound: 'M37.mp3' },
            attack: { sound: 'M38.mp3' },
            takeDamage: { sound: 'M39.mp3' },
            death: { sound: 'M40.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5,
    },
    {
        spriteName: 'clawturtle',
        states: {
            move: { sound: 'M114.mp3' },
            attack: { sound: 'M115.mp3' },
            takeDamage: { sound: 'M112.mp3' },
            death: { sound: 'M113.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'cyc',
        states: {
            move: { sound: 'M41.mp3' },
            attack: { sound: 'M42.mp3' },
            takeDamage: { sound: 'M43.mp3' },
            death: { sound: 'M44.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5,
    },
    {
        spriteName: 'darkelf',
        states: {
            move: { sound: 'C8.mp3' },
            attack: { sound: 'C3.mp3' },
            takeDamage: { sound: 'C13.mp3' },
            death: { sound: 'M150.mp3' }
        },
        corpseDecayTime: 3,
        bowAttack: true,
    },
    {
        spriteName: 'elfmaster',
        states: {
            move: { sound: 'C8.mp3' },
            attack: { sound: 'C3.mp3' },
            takeDamage: { sound: 'C13.mp3' },
            death: { sound: 'M150.mp3' }
        },
        corpseDecayTime: 3,
        bowAttack: true,
    },
    {
        spriteName: 'darkknight',
        states: {
            move: { sound: 'M148.mp3' }, // asset: verify
            attack: { sound: 'M145.mp3' },
            takeDamage: { sound: 'M147.mp3' },
            death: { sound: 'M146.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'demon',
        states: {
            move: { sound: 'M59.mp3' },
            attack: { sound: 'M61.mp3' },
            takeDamage: { sound: 'M60.mp3' },
            death: { sound: 'M62.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'detector',
        corpseDecayTime: 3
    },
    {
        spriteName: 'fireelemental', // asset: verify pivots
        states: {
            move: { sound: 'E9.mp3' },
            attack: { sound: 'E1.mp3' },
            death: { sound: 'M58.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'frost',
        states: {
            move: { sound: 'M23.mp3' },
            attack: { sound: 'C4.mp3' },
            takeDamage: { sound: 'C13.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'gagoyle', // Note: actual sprite file has typo in filename
        states: {
            move: { sound: 'M37.mp3' },
            attack: { sound: 'C2.mp3' },
            takeDamage: { sound: 'M43.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'ghk',
        states: {
            move: { sound: 'C8.mp3' },
            attack: { sound: 'C2.mp3' },
            takeDamage: { sound: 'C12.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'ghkabs',
        states: {
            move: { sound: 'M63.mp3' },
            attack: { sound: 'C2.mp3' },
            takeDamage: { sound: 'C12.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'giantcrayfish',
        states: {
            move: { sound: 'M99.mp3' },
            attack: { sound: 'M100.mp3' },
            takeDamage: { sound: 'M101.mp3' },
            death: { sound: 'M98.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'giantfrog',
        states: {
            move: {
                sound: 'M73.mp3',
                animation: {
                    startAnimationFrame: 3, // Frames 3-7
                    animationFrames: 5
                }
            },
            attack: { sound: 'M77.mp3' },
            takeDamage: { sound: 'M81.mp3' },
            death: { sound: 'M85.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'giantlizard',
        states: {
            move: { sound: 'M126.mp3' },
            attack: { sound: 'M127.mp3' },
            takeDamage: { sound: 'M124.mp3' },
            death: { sound: 'M125.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'giantplant',
        states: {
            move: { sound: 'M122.mp3' },
            attack: { sound: 'M123.mp3' },
            takeDamage: { sound: 'M120.mp3' },
            death: { sound: 'M121.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'gol',
        states: {
            move: { sound: 'M33.mp3' },
            attack: { sound: 'M34.mp3' },
            takeDamage: { sound: 'M35.mp3' },
            death: { sound: 'M36.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'gt-arrow',
        states: {
            attack: { sound: 'C2.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'gt-cannon',
        states: {
            attack: { sound: 'C2.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'guard',
        states: {
            move: { sound: 'C8.mp3' },
            attack: { sound: 'C2.mp3' },
            takeDamage: { sound: 'C12.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'helb',
        states: {
            move: { sound: 'M5.mp3' },
            attack: { sound: 'M6.mp3' },
            takeDamage: { sound: 'M7.mp3' },
            death: { sound: 'M8.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'hellclaw',
        states: {
            move: { sound: 'M41.mp3' },
            attack: { sound: 'M42.mp3' },
            takeDamage: { sound: 'M43.mp3' },
            death: { sound: 'M44.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'icegolem',
        states: {
            move: { sound: 'M33.mp3' },
            attack: { sound: 'M34.mp3' },   
            takeDamage: { sound: 'M35.mp3' },
            death: { sound: 'M36.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'lwb',
        states: {
            move: { sound: 'M29.mp3' },
            attack: { sound: 'M30.mp3' },
            takeDamage: { sound: 'M31.mp3' },
            death: { sound: 'M32.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'magmabull', // asset: verify pivots / sounds
        states: {
            move: { sound: 'M46.mp3' },
            attack: { sound: 'M30.mp3' },
            death: { sound: 'M103.mp3' }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'mastermageorc',
        states: {
            move: { sound: 'M74.mp3' },
            attack: { sound: 'M78.mp3' },
            takeDamage: { sound: 'M86.mp3' },
            death: { sound: 'M86.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'minotaurs',
        states: {
            move: { sound: 'M46.mp3' },
            attack: { sound: 'M123.mp3' }, // asset: M104 preferred when available
            takeDamage: { sound: 'M102.mp3' },
            death: { sound: 'M103.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'mtgiant',
        states: {
            move: { sound: 'M87.mp3' },
            attack: { sound: 'M88.mp3' },
            takeDamage: { sound: 'M89.mp3' },
            death: { sound: 'M90.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'nizie',
        states: {
            move: { sound: 'M134.mp3' },
            attack: { sound: 'M135.mp3' },
            takeDamage: { sound: 'M132.mp3' },
            death: { sound: 'M133.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'orc',
        states: {
            move: { sound: 'M9.mp3' },
            attack: { sound: 'M10.mp3' },
            takeDamage: { sound: 'M11.mp3' },
            death: { sound: 'M12.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'direboar',
        states: {
            move: { sound: 'M87.mp3' },
            attack: { sound: 'M78.mp3' },
            takeDamage: { sound: 'M78.mp3' },
            death: { sound: 'C7.mp3' }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'dummy',
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'firewyvern',
        states: {
            idle: {
                animation: {
                    startSpriteSheet: 0, // Same as regular monsters
                    startAnimationFrame: 0, // Frames 0-3
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M106.mp3',
                animation: {
                    startSpriteSheet: 8 // Standard move sprite sheet
                    // Uses default: 8 frames starting at 0
                }
            },
            attack: {
                sound: 'M107.mp3',
                animation: {
                    startSpriteSheet: 0, // Same as idle
                    startAnimationFrame: 3, // Frames 4-7, for some reason only works when starting from 3, otherwise causes Phaser crash
                    animationFrames: 4
                }
            },
            takeDamage: { 
                animation: { // Reuse idle frames for take damage
                    startSpriteSheet: 0,
                    startAnimationFrame: 0,
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M105.mp3',
                animation: {
                    startSpriteSheet: 16 // Custom sprite sheet for wyvern death
                    // Uses default: 8 frames starting at 0
                }
            }
        },
        height: 120,
        corpseDecayTime: 3,
        opacity: 0.7,
    },
    {
        spriteName: 'wyvern',
        states: {
            idle: {
                animation: {
                    startSpriteSheet: 0, // Same as regular monsters
                    startAnimationFrame: 0, // Frames 0-3
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M106.mp3',
                animation: {
                    startSpriteSheet: 8 // Standard move sprite sheet
                    // Uses default: 8 frames starting at 0
                }
            },
            attack: {
                sound: 'M107.mp3',
                animation: {
                    startSpriteSheet: 0, // Same as idle
                    startAnimationFrame: 3, // Frames 4-7, for some reason only works when starting from 3, otherwise causes Phaser crash
                    animationFrames: 4
                }
            },
            takeDamage: { 
                animation: { // Reuse idle frames for take damage
                    startSpriteSheet: 0,
                    startAnimationFrame: 0,
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M105.mp3',
                animation: {
                    startSpriteSheet: 16 // Custom sprite sheet for wyvern death
                    // Uses default: 8 frames starting at 0
                }
            }
        },
        height: 120,
        corpseDecayTime: 3,
        opacity: 0.7,
    },
    {
        spriteName: 'uglywyvern',
        states: {
            idle: {
                animation: {
                    startSpriteSheet: 0, // Same as regular monsters
                    startAnimationFrame: 0, // Frames 0-3
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M106.mp3',
                animation: {
                    startSpriteSheet: 8 // Standard move sprite sheet
                    // Uses default: 8 frames starting at 0
                }
            },
            attack: {
                sound: 'M107.mp3',
                animation: {
                    startSpriteSheet: 0, // Same as idle
                    startAnimationFrame: 3, // Frames 4-7, for some reason only works when starting from 3, otherwise causes Phaser crash
                    animationFrames: 4
                }
            },
            takeDamage: { 
                animation: { // Reuse idle frames for take damage
                    startSpriteSheet: 0,
                    startAnimationFrame: 0,
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M105.mp3',
                animation: {
                    startSpriteSheet: 16 // Custom sprite sheet for wyvern death
                    // Uses default: 8 frames starting at 0
                }
            }
        },
        height: 120,
        corpseDecayTime: 3,
        opacity: 0.7,
    },
    {
        spriteName: 'liche',
        states: {
            idle: {
                animation: {
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M55.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            attack: {
                sound: 'M56.mp3',
                animation: {
                    animationFrames: 6
                }
            },
            takeDamage: {
                sound: 'M57.mp3',
                animation: {
                    animationFrames: 5
                }
            },
            death: {
                sound: 'M58.mp3',
                animation: {
                    animationFrames: 6
                }
            }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'orge',
        states: {
            idle: {
                animation: {
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M51.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            attack: {
                sound: 'M52.mp3',
                animation: {
                    animationFrames: 6
                }
            },
            takeDamage: {
                sound: 'M53.mp3',
                animation: {
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M54.mp3',
                animation: {
                    animationFrames: 6
                }
            }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'rudolph',
        states: {
            move: { sound: 'C11.mp3' },
            attack: { sound: 'M38.mp3' },
            takeDamage: { sound: 'M59.mp3' },
            death: { sound: 'M65.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'scarecrow',
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'scp',
        states: {
            move: { sound: 'M21.mp3' },
            attack: { sound: 'M22.mp3' },
            takeDamage: { sound: 'M23.mp3' },
            death: { sound: 'M24.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'ske',
        states: {
            move: { sound: 'M13.mp3' },
            attack: { sound: 'M14.mp3' },
            takeDamage: { sound: 'M15.mp3' },
            death: { sound: 'M16.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5,
    },
    {
        spriteName: 'sorceress',
        states: {
            move: { sound: 'M149.mp3' },
            attack: { sound: 'C2.mp3' },
            takeDamage: { sound: 'M116.mp3' },
            death: { sound: 'M129.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'stalker',
        states: {
            move: { sound: 'M9.mp3' },
            attack: { sound: 'M10.mp3' },
            takeDamage: { sound: 'M11.mp3' },
            death: { sound: 'M12.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'tentocle',
        states: {
            move: { sound: 'M110.mp3' },
            attack: { sound: 'M111.mp3' },
            takeDamage: { sound: 'M108.mp3' },
            death: { sound: 'M109.mp3' }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'tigerworm',
        states: {
            move: { sound: 'M1.mp3' },
            attack: { sound: 'C1.mp3' },
            death: { sound: 'M58.mp3' }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'tk',
        states: {
            move: { sound: 'C8.mp3' },
            attack: { sound: 'C2.mp3' },
            takeDamage: { sound: 'C12.mp3' },
            death: { sound: 'C14.mp3' }
        },
        corpseDecayTime: 3,
    },
    {
        spriteName: 'tpknight',
        states: {
            move: { sound: 'M142.mp3' },
            attack: { sound: 'M140.mp3' },
            takeDamage: { sound: 'M143.mp3' },
            death: { sound: 'M141.mp3' }
        },
        corpseDecayTime: 3,
    },
    {
        spriteName: 'troll',
        states: {
            idle: {
                animation: {
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M46.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            attack: {
                sound: 'M47.mp3',
                animation: {
                    animationFrames: 6
                }
            },
            takeDamage: { 
                sound: 'M48.mp3',
                animation: {
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M49.mp3',
                animation: {
                    animationFrames: 6
                }
            }
        },
        corpseDecayTime: 3
    },
    {
        spriteName: 'unicorn',
        states: {
            idle: {
                animation: {
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M63.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            attack: {
                sound: 'M64.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            takeDamage: {
                sound: 'M65.mp3',
                animation: {
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M66.mp3',
                animation: {
                    animationFrames: 8
                }
            }
        },
        corpseDecayTime: 3,
        shadow: MonsterShadow.NoShadow
    },
    {
        spriteName: 'werewolf',
        states: {
            idle: {
                animation: {
                    animationFrames: 4
                }
            },
            move: {
                sound: 'M67.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            attack: {
                sound: 'M68.mp3',
                animation: {
                    animationFrames: 8
                }
            },
            takeDamage: {
                sound: 'M69.mp3',
                animation: {
                    animationFrames: 4
                }
            },
            death: {
                sound: 'M70.mp3',
                animation: {
                    animationFrames: 8
                }
            }
        },
        corpseDecayTime: 3,
    },
    {
        spriteName: 'zom',
        states: {
            move: { sound: 'M17.mp3' },
            attack: { sound: 'M18.mp3' },
            takeDamage: { sound: 'M19.mp3' },
            death: { sound: 'M20.mp3' }
        },
        corpseDecayTime: 3,
        temporalCoefficient: 0.5
    },
    {
        spriteName: 'yspro',
        states: {
            death: { 
                animation: {
                    spriteName: 'yseffect2',
                    startSpriteSheet: 0,
                    animationFrames: 16
                }
            }
        },
        corpseDecayTime: 3,
        height: 120,
        shadow: MonsterShadow.NoShadow
    },
];

/** Lookup in `MONSTERS` by basename (e.g. `ettin`). */
export function getMonsterData(spriteName: string): MonsterData | undefined {
    return MONSTERS.find(monster => monster.spriteName === spriteName);
}

export function getMonsterAssetFormat(monster: MonsterData): SpriteAssetFormat {
    return monster.assetFormat ?? SpriteAssetFormat.Spr;
}
