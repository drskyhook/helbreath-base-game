import { EventBus } from '../../game/EventBus';
import { DebounceTimer } from '../../utils/DebounceTimer';
import { createDialogStore } from './utils';
import {
    OUT_UI_SET_MOVEMENT_SPEED,
    OUT_UI_SET_ATTACK_SPEED_MS,
    OUT_UI_SET_ATTACK_RANGE,
    OUT_UI_SET_STUN_DURATION_MS,
    OUT_UI_SET_DAMAGE,
    OUT_UI_SET_ATTACK_TYPE,
    OUT_UI_SET_ALLOW_DASH_ATTACK,
    OUT_UI_SET_CAST_SPEED,
    OUT_UI_SET_ATTACK_MODE,
    OUT_UI_SET_RUN_MODE,
    OUT_UI_SET_GENDER,
    OUT_UI_SET_SKIN_COLOR,
    OUT_UI_SET_UNDERWEAR_COLOR,
    OUT_UI_SET_HAIR_STYLE,
    IN_UI_CHANGE_MOVEMENT_SPEED,
    IN_UI_CHANGE_ATTACK_SPEED,
    IN_UI_CHANGE_ATTACK_RANGE,
    IN_UI_CHANGE_STUN_DURATION,
    IN_UI_CHANGE_DAMAGE,
    IN_UI_CHANGE_ATTACK_TYPE,
    IN_UI_CHANGE_ALLOW_DASH_ATTACK,
    IN_UI_CHANGE_CAST_SPEED,
    IN_UI_CHANGE_ATTACK_MODE,
    IN_UI_CHANGE_RUN_MODE,
    IN_UI_CHANGE_GENDER,
    IN_UI_CHANGE_SKIN_COLOR,
    IN_UI_CHANGE_UNDERWEAR_COLOR,
    IN_UI_CHANGE_HAIR_STYLE,
} from '../../constants/EventNames';
import { DEFAULT_PLAYER_ATTACK_SPEED_MS, DEFAULT_PLAYER_ATTACK_RANGE } from '../../Config';
import { AttackType, Gender, SkinColor } from '../../Types';

/** Default movement speed in ms (server-side default). Used until server sends InitialGameWorldState. */
const DEFAULT_MOVEMENT_SPEED_MS = 220;

/** Full melee swing duration (ms); matches Player dialog slider and server `attack_speed_ms`. */
export const PLAYER_ATTACK_SPEED_MS_MIN = 200;
export const PLAYER_ATTACK_SPEED_MS_MAX = 2000;

/** Full spell cast bar duration (ms); matches Player dialog slider and server `cast_speed_ms`. */
export const PLAYER_CAST_SPEED_MS_MIN = 200;
export const PLAYER_CAST_SPEED_MS_MAX = 2000;

interface PlayerDialogState {
    isOpen: boolean;
    gender: Gender;
    skinColor: SkinColor;
    underwearColorIndex: number;
    /** Hair style: 0-7 = Style 1-8. Index 2 renders no hair. */
    hairStyleIndex: number;
    /** Movement speed in ms (100-500). Lower = faster. */
    movementSpeed: number;
    /** Full melee swing duration in ms (200–2000); synced with server when enabled. */
    attackSpeedMs: number;
    /** Monster stunlock duration (ms) when using Stun; synced with server when "Sync with server" is on. */
    stunDurationMs: number;
    attackRange: number;
    damage: number;
    attackType: AttackType;
    /** Full spell cast bar duration in ms (200–2000); synced with server when enabled. */
    castSpeedMs: number;
    attackMode: boolean;
    runMode: boolean;
    allowDashAttack: boolean;
}

const initialState: PlayerDialogState = {
    isOpen: false,
    gender: Gender.MALE,
    skinColor: SkinColor.Light,
    underwearColorIndex: 0,
    hairStyleIndex: 0,
    movementSpeed: DEFAULT_MOVEMENT_SPEED_MS,
    attackSpeedMs: DEFAULT_PLAYER_ATTACK_SPEED_MS,
    stunDurationMs: 500,
    attackRange: DEFAULT_PLAYER_ATTACK_RANGE,
    damage: 30,
    attackType: AttackType.Stun,
    castSpeedMs: 1200,
    attackMode: true,
    runMode: true,
    allowDashAttack: true,
};

const { store: playerDialogStore, toggle: togglePlayerDialog, setOpen: setPlayerDialogOpen } =
    createDialogStore(initialState);

/** Delay before emitting `IN_UI_*` to Phaser after slider/store changes (single value for all stats). */
const DEBOUNCE_MS = 500;

const movementPhaserDebounce = new DebounceTimer(DEBOUNCE_MS);
const attackSpeedPhaserDebounce = new DebounceTimer(DEBOUNCE_MS);
const castSpeedPhaserDebounce = new DebounceTimer(DEBOUNCE_MS);
const attackRangePhaserDebounce = new DebounceTimer(DEBOUNCE_MS);
const damagePhaserDebounce = new DebounceTimer(DEBOUNCE_MS);
const stunDurationPhaserDebounce = new DebounceTimer(DEBOUNCE_MS);

let movementPhaserWindowPreviousSpeed: number | undefined;

export function cancelPlayerDialogPhaserNotificationDebouncers(): void {
    movementPhaserDebounce.cancel();
    attackSpeedPhaserDebounce.cancel();
    castSpeedPhaserDebounce.cancel();
    attackRangePhaserDebounce.cancel();
    damagePhaserDebounce.cancel();
    stunDurationPhaserDebounce.cancel();
}

export { playerDialogStore, togglePlayerDialog, setPlayerDialogOpen };

export const setMovementSpeed = (speed: number, notifyPhaser = true) => {
    const previousSpeedBeforeSet = playerDialogStore.state.movementSpeed;
    playerDialogStore.setState((state) => ({ ...state, movementSpeed: speed }));
    if (notifyPhaser) {
        // One emit per debounce window: GameWorld scales the player's current ms using (previous base → new base).
        // Only record previousSpeed on the first change in that window; later ticks would overwrite it with an intermediate slider value.
        if (!movementPhaserDebounce.isPending) {
            movementPhaserWindowPreviousSpeed = previousSpeedBeforeSet;
        }
        movementPhaserDebounce.schedule(() => {
            EventBus.emit(IN_UI_CHANGE_MOVEMENT_SPEED, {
                speed: playerDialogStore.state.movementSpeed,
                previousSpeed: movementPhaserWindowPreviousSpeed ?? previousSpeedBeforeSet,
            });
        });
    }
};

export const setAttackSpeedMs = (ms: number, notifyPhaser = true) => {
    const clamped = Math.max(PLAYER_ATTACK_SPEED_MS_MIN, Math.min(PLAYER_ATTACK_SPEED_MS_MAX, Math.round(ms)));
    playerDialogStore.setState((state) => ({ ...state, attackSpeedMs: clamped }));
    if (notifyPhaser) {
        attackSpeedPhaserDebounce.schedule(() => {
            EventBus.emit(IN_UI_CHANGE_ATTACK_SPEED, playerDialogStore.state.attackSpeedMs);
        });
    }
};

export const setAttackRange = (range: number, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, attackRange: range }));
    if (notifyPhaser) {
        attackRangePhaserDebounce.schedule(() => {
            EventBus.emit(IN_UI_CHANGE_ATTACK_RANGE, playerDialogStore.state.attackRange);
        });
    }
};

export const setStunDurationMs = (ms: number, notifyPhaser = true) => {
    const clamped = Math.max(100, Math.min(2000, Math.round(ms)));
    playerDialogStore.setState((state) => ({ ...state, stunDurationMs: clamped }));
    if (notifyPhaser) {
        stunDurationPhaserDebounce.schedule(() => {
            EventBus.emit(IN_UI_CHANGE_STUN_DURATION, playerDialogStore.state.stunDurationMs);
        });
    }
};

export const setDamage = (damage: number, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, damage }));
    if (notifyPhaser) {
        damagePhaserDebounce.schedule(() => {
            EventBus.emit(IN_UI_CHANGE_DAMAGE, playerDialogStore.state.damage);
        });
    }
};

export const setAttackType = (attackType: AttackType, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, attackType }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_ATTACK_TYPE, attackType);
    }
};

export const setCastSpeedMs = (ms: number, notifyPhaser = true) => {
    const clamped = Math.max(PLAYER_CAST_SPEED_MS_MIN, Math.min(PLAYER_CAST_SPEED_MS_MAX, Math.round(ms)));
    playerDialogStore.setState((state) => ({ ...state, castSpeedMs: clamped }));
    if (notifyPhaser) {
        castSpeedPhaserDebounce.schedule(() => {
            EventBus.emit(IN_UI_CHANGE_CAST_SPEED, playerDialogStore.state.castSpeedMs);
        });
    }
};

export const setAttackMode = (enabled: boolean, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, attackMode: enabled }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_ATTACK_MODE, enabled);
    }
};

export const setRunMode = (enabled: boolean, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, runMode: enabled }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_RUN_MODE, enabled);
    }
};

export const setAllowDashAttack = (enabled: boolean, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, allowDashAttack: enabled }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_ALLOW_DASH_ATTACK, enabled);
    }
};

export const setGender = (gender: Gender, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, gender }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_GENDER, gender);
    }
};

export const setSkinColor = (skinColor: SkinColor, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, skinColor }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_SKIN_COLOR, skinColor);
    }
};

export const setUnderwearColorIndex = (index: number, notifyPhaser = true) => {
    playerDialogStore.setState((state) => ({ ...state, underwearColorIndex: Math.max(0, Math.min(7, index)) }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_UNDERWEAR_COLOR, Math.max(0, Math.min(7, index)));
    }
};

export const setHairStyleIndex = (index: number, notifyPhaser = true) => {
    const clamped = index < 0 ? 0 : index > 7 ? 7 : index;
    playerDialogStore.setState((state) => ({ ...state, hairStyleIndex: clamped }));
    if (notifyPhaser) {
        EventBus.emit(IN_UI_CHANGE_HAIR_STYLE, clamped);
    }
};

// Initialize EventBus listeners to update state when emitted from Phaser
EventBus.on(OUT_UI_SET_MOVEMENT_SPEED, (speed: number) => {
    setMovementSpeed(speed, false);
});

EventBus.on(OUT_UI_SET_ATTACK_SPEED_MS, (ms: number) => {
    const clampedMs = Math.max(PLAYER_ATTACK_SPEED_MS_MIN, Math.min(PLAYER_ATTACK_SPEED_MS_MAX, Math.round(ms)));
    playerDialogStore.setState((state) => ({ ...state, attackSpeedMs: clampedMs }));
});

EventBus.on(OUT_UI_SET_ATTACK_RANGE, (range: number) => {
    setAttackRange(range, false);
});

EventBus.on(OUT_UI_SET_STUN_DURATION_MS, (ms: number) => {
    setStunDurationMs(ms, false);
});

EventBus.on(OUT_UI_SET_DAMAGE, (damage: number) => {
    setDamage(damage, false);
});

EventBus.on(OUT_UI_SET_ATTACK_TYPE, (attackType: AttackType) => {
    setAttackType(attackType, false);
});

EventBus.on(OUT_UI_SET_ALLOW_DASH_ATTACK, (enabled: boolean) => {
    setAllowDashAttack(enabled, false);
});

EventBus.on(OUT_UI_SET_CAST_SPEED, (ms: number) => {
    setCastSpeedMs(ms, false);
});

EventBus.on(OUT_UI_SET_ATTACK_MODE, (enabled: boolean) => {
    setAttackMode(enabled, false);
});

EventBus.on(OUT_UI_SET_RUN_MODE, (enabled: boolean) => {
    setRunMode(enabled, false);
});

EventBus.on(OUT_UI_SET_GENDER, (gender: Gender) => {
    setGender(gender, false);
});

EventBus.on(OUT_UI_SET_SKIN_COLOR, (skinColor: SkinColor) => {
    setSkinColor(skinColor, false);
});

EventBus.on(OUT_UI_SET_UNDERWEAR_COLOR, (index: number) => {
    setUnderwearColorIndex(index, false);
});

EventBus.on(OUT_UI_SET_HAIR_STYLE, (index: number) => {
    setHairStyleIndex(index, false);
});
