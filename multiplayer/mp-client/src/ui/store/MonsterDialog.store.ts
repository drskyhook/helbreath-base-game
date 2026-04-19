import { EventBus } from '../../game/EventBus';
import { createDialogStore } from './utils';
import { IN_UI_SUMMON_MONSTER, OUT_UI_SET_MONSTERS } from '../../constants/EventNames';
import { Direction } from '../../utils/CoordinateUtils';
import { AttackType, MonsterAllegiance, SummonMonsterEvent } from '../../Types';
import {
    MONSTER_DIALOG_DEFAULT_MOVEMENT_MS,
    MONSTER_DIALOG_DEFAULT_STUN_DURATION_MS,
    MONSTER_DIALOG_DEFAULT_ATTACK_SPEED_MS,
    MONSTER_DIALOG_DEFAULT_ATTACK_RECOVERY_MS,
    MONSTER_DEFAULT_CHASE_RANGE_CELLS,
    MONSTER_DEFAULT_ATTACK_RANGE_CELLS,
} from '../../Config';

export interface MonsterCatalogEntry {
    name: string;
    sprite: string;
}

interface MonsterDialogState {
    isOpen: boolean;
    monsters: MonsterCatalogEntry[];
    selectedMonster: string;
    selectedAllegiance: MonsterAllegiance;
    selectedDirection: Direction;
    health: number;
    damage: number;
    movementSpeed: number;
    /** Full melee swing duration in ms (200 fast … 2000 slow); summon packet `attack_speed_ms`. */
    attackSpeedMs: number;
    /** Post-hit recovery gate in ms (0–2000); optional proto `attack_recovery_ms`. */
    attackRecoveryMs: number;
    /** Max Chebyshev chase distance (cells); summon packet `chase_range_cells` (1–20). */
    chaseRangeCells: number;
    /** Chebyshev melee reach (cells); summon packet `attack_range_cells` (1–20). */
    attackRangeCells: number;
    attackType: AttackType;
    stunDurationMs: number;
    /** How many monsters to request (1–1000); maps to proto `summon_count`. */
    summonCount: number;
}

const initialState: MonsterDialogState = {
    isOpen: false,
    monsters: [],
    selectedMonster: '',
    selectedAllegiance: MonsterAllegiance.Hostile,
    selectedDirection: Direction.South, // Default to South
    health: 100,
    damage: 30,
    movementSpeed: MONSTER_DIALOG_DEFAULT_MOVEMENT_MS,
    attackSpeedMs: MONSTER_DIALOG_DEFAULT_ATTACK_SPEED_MS,
    attackRecoveryMs: MONSTER_DIALOG_DEFAULT_ATTACK_RECOVERY_MS,
    chaseRangeCells: MONSTER_DEFAULT_CHASE_RANGE_CELLS,
    attackRangeCells: MONSTER_DEFAULT_ATTACK_RANGE_CELLS,
    attackType: AttackType.Stun,
    stunDurationMs: MONSTER_DIALOG_DEFAULT_STUN_DURATION_MS,
    summonCount: 1,
};

const { store: monsterDialogStore, toggle: toggleMonsterDialog, setOpen: setMonsterDialogOpen } =
    createDialogStore(initialState);

export { monsterDialogStore, toggleMonsterDialog, setMonsterDialogOpen };

export const setSelectedMonster = (spriteName: string) => {
    monsterDialogStore.setState((state) => ({ ...state, selectedMonster: spriteName }));
};

export const setSelectedAllegiance = (allegiance: MonsterAllegiance) => {
    monsterDialogStore.setState((state) => ({ ...state, selectedAllegiance: allegiance }));
};

export const setMonsters = (monsters: MonsterCatalogEntry[]) => {
    monsterDialogStore.setState((state) => {
        const sorted = [...monsters].sort((a, b) => a.name.localeCompare(b.name));
        const nextSelected = sorted.some((m) => m.sprite === state.selectedMonster)
            ? state.selectedMonster
            : (sorted[0]?.sprite ?? '');
        return {
            ...state,
            monsters: sorted,
            selectedMonster: nextSelected,
        };
    });
};

export const setSelectedDirection = (direction: Direction) => {
    monsterDialogStore.setState((state) => ({ ...state, selectedDirection: direction }));
};

export const setHealth = (health: number) => {
    monsterDialogStore.setState((state) => ({ ...state, health }));
};

export const setDamage = (damage: number) => {
    monsterDialogStore.setState((state) => ({ ...state, damage }));
};

export const setMovementSpeed = (speed: number) => {
    monsterDialogStore.setState((state) => ({ ...state, movementSpeed: speed }));
};

export const setAttackSpeedMs = (ms: number) => {
    monsterDialogStore.setState((state) => ({ ...state, attackSpeedMs: ms }));
};

export const setAttackRecoveryMs = (ms: number) => {
    monsterDialogStore.setState((state) => ({ ...state, attackRecoveryMs: ms }));
};

export const setChaseRangeCells = (cells: number) => {
    monsterDialogStore.setState((state) => ({ ...state, chaseRangeCells: cells }));
};

export const setAttackRangeCells = (cells: number) => {
    monsterDialogStore.setState((state) => ({ ...state, attackRangeCells: cells }));
};

export const setAttackType = (attackType: AttackType) => {
    monsterDialogStore.setState((state) => ({ ...state, attackType }));
};

export const setStunDurationMs = (ms: number) => {
    monsterDialogStore.setState((state) => ({ ...state, stunDurationMs: ms }));
};

export const setSummonCount = (count: number) => {
    monsterDialogStore.setState((state) => ({ ...state, summonCount: count }));
};

export const summonMonster = () => {
    const state = monsterDialogStore.state;
    if (!state.selectedMonster) {
        return;
    }
    const payload: SummonMonsterEvent = {
        spriteName: state.selectedMonster,
        movementSpeed: state.movementSpeed,
        direction: state.selectedDirection,
        attackType: state.attackType,
        allegiance: state.selectedAllegiance,
        stunDurationMs: state.stunDurationMs,
        maxHp: state.health,
        attackDamage: state.damage,
        attackSpeedMs: state.attackSpeedMs,
        attackRecoveryMs: state.attackRecoveryMs,
        chaseRangeCells: state.chaseRangeCells,
        attackRangeCells: state.attackRangeCells,
        summonCount: state.summonCount,
    };
    EventBus.emit(IN_UI_SUMMON_MONSTER, payload);
};

EventBus.on(OUT_UI_SET_MONSTERS, (monsters: MonsterCatalogEntry[]) => {
    setMonsters(monsters);
});
