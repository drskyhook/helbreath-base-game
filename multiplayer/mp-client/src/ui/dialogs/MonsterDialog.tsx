import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import { RpgHorizontalSeparator } from '../components/RpgHorizontalSeparator';
import { RpgVerticalSeparator } from '../components/RpgVerticalSeparator';
import { RpgSlider } from '../components/RpgSlider';
import { monsterDialogStore, setSelectedMonster, setSelectedAllegiance, setSelectedDirection, setHealth, setDamage, setMovementSpeed, setAttackSpeedMs, setAttackRecoveryMs, setStunDurationMs, setChaseRangeCells, setAttackRangeCells, setAttackType, setSummonCount, summonMonster, setMonsterDialogOpen } from '../store/MonsterDialog.store';
import { Direction, toDirection } from '../../utils/CoordinateUtils';
import { AttackType, MonsterAllegiance, MONSTER_ALLEGIANCE_LABELS } from '../../Types';
import {
    MONSTER_MIN_CHASE_RANGE_CELLS,
    MONSTER_MAX_CHASE_RANGE_CELLS,
    MONSTER_MIN_ATTACK_RANGE_CELLS,
    MONSTER_MAX_ATTACK_RANGE_CELLS,
    MONSTER_DIALOG_MIN_MOVEMENT_MS,
    MONSTER_DIALOG_IMMOBILE_MS,
    MONSTER_DIALOG_MOVEMENT_SLIDER_INVERT_SUM,
    MONSTER_DIALOG_MIN_STUN_DURATION_MS,
    MONSTER_DIALOG_MAX_STUN_DURATION_MS,
    MONSTER_DIALOG_MIN_ATTACK_SPEED_MS,
    MONSTER_DIALOG_MAX_ATTACK_SPEED_MS,
    MONSTER_DIALOG_ATTACK_SPEED_SLIDER_INVERT_SUM,
    MONSTER_DIALOG_MIN_ATTACK_RECOVERY_MS,
    MONSTER_DIALOG_MAX_ATTACK_RECOVERY_MS,
    MONSTER_DIALOG_ATTACK_RECOVERY_SLIDER_INVERT_SUM,
} from '../../Config';
import type { IRefPhaserGame } from '../../PhaserGame';
import { getNetworkManager } from '../../utils/RegistryUtils';

interface MonsterDialogProps {
    position: { x: number; y: number };
    phaserRef: React.RefObject<IRefPhaserGame | null>;
    zIndex?: number;
    onBringToFront?: () => void;
}

const DIRECTION_OPTIONS = [
    { label: 'North', value: Direction.North },
    { label: 'North East', value: Direction.NorthEast },
    { label: 'East', value: Direction.East },
    { label: 'South East', value: Direction.SouthEast },
    { label: 'South', value: Direction.South },
    { label: 'South West', value: Direction.SouthWest },
    { label: 'West', value: Direction.West },
    { label: 'North West', value: Direction.NorthWest },
];

const ALLEGIANCE_OPTIONS = [
    { label: MONSTER_ALLEGIANCE_LABELS[MonsterAllegiance.Hostile], value: MonsterAllegiance.Hostile },
    { label: MONSTER_ALLEGIANCE_LABELS[MonsterAllegiance.Neutral], value: MonsterAllegiance.Neutral },
    { label: MONSTER_ALLEGIANCE_LABELS[MonsterAllegiance.Friendly], value: MonsterAllegiance.Friendly },
];

export function MonsterDialog({
    position,
    phaserRef,
    zIndex,
    onBringToFront,
}: MonsterDialogProps) {
    const selectedMonster = useStore(monsterDialogStore, (state) => state.selectedMonster);
    const selectedAllegiance = useStore(monsterDialogStore, (state) => state.selectedAllegiance);
    const selectedDirection = useStore(monsterDialogStore, (state) => state.selectedDirection);
    const health = useStore(monsterDialogStore, (state) => state.health);
    const damage = useStore(monsterDialogStore, (state) => state.damage);
    const movementSpeed = useStore(monsterDialogStore, (state) => state.movementSpeed);
    const attackSpeedMs = useStore(monsterDialogStore, (state) => state.attackSpeedMs);
    const attackRecoveryMs = useStore(monsterDialogStore, (state) => state.attackRecoveryMs);
    const stunDurationMs = useStore(monsterDialogStore, (state) => state.stunDurationMs);
    const chaseRangeCells = useStore(monsterDialogStore, (state) => state.chaseRangeCells);
    const attackRangeCells = useStore(monsterDialogStore, (state) => state.attackRangeCells);
    const attackType = useStore(monsterDialogStore, (state) => state.attackType);
    const summonCount = useStore(monsterDialogStore, (state) => state.summonCount);
    const monsters = useStore(monsterDialogStore, (state) => state.monsters);

    const handleSummon = () => {
        summonMonster();
    };
    
    const handleKillAll = () => {
        const game = phaserRef.current?.game;
        if (!game) {
            return;
        }
        const networkManager = getNetworkManager(game);
        if (!networkManager) {
            return;
        }
        networkManager.sendKillAllMonstersRequested();
    };
    
    const handleMovementSpeedChange = (sliderPositionMs: number) => {
        setMovementSpeed(MONSTER_DIALOG_MOVEMENT_SLIDER_INVERT_SUM - sliderPositionMs);
    };
    
    const handleAttackSpeedChange = (sliderPositionMs: number) => {
        setAttackSpeedMs(MONSTER_DIALOG_ATTACK_SPEED_SLIDER_INVERT_SUM - sliderPositionMs);
    };

    const handleAttackRecoveryChange = (sliderPositionMs: number) => {
        setAttackRecoveryMs(MONSTER_DIALOG_ATTACK_RECOVERY_SLIDER_INVERT_SUM - sliderPositionMs);
    };

    const handleStunDurationChange = (ms: number) => {
        setStunDurationMs(ms);
    };
    
    const handleChaseRangeChange = (cells: number) => {
        setChaseRangeCells(cells);
    };
    
    const handleAttackRangeChange = (cells: number) => {
        setAttackRangeCells(cells);
    };

    return (
        <DraggableDialog 
            title="Summon Monster" 
            position={position} 
            id="monster-dialog" 
            zIndex={zIndex} 
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                setMonsterDialogOpen(false);
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 220, flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: 8 }}>
                        <div style={{ marginBottom: '3px' }}>
                            <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Monster</div>
                            <select
                                id="monster-select"
                                className="rpg-select"
                                value={selectedMonster}
                                onChange={(e) => setSelectedMonster(e.target.value)}
                                style={{ width: '100%' }}
                            >
                                {monsters.map((m) => (
                                    <option key={m.sprite} value={m.sprite}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div style={{ marginBottom: '3px' }}>
                            <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Allegiance</div>
                            <select
                                id="monster-allegiance-select"
                                className="rpg-select"
                                value={selectedAllegiance}
                                onChange={(e) => setSelectedAllegiance(Number(e.target.value) as MonsterAllegiance)}
                                style={{ width: '100%' }}
                            >
                                {ALLEGIANCE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div style={{ marginBottom: '3px' }}>
                            <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Direction</div>
                            <select
                                id="direction-select"
                                className="rpg-select"
                                value={selectedDirection}
                                onChange={(e) => setSelectedDirection(toDirection(Number(e.target.value)))}
                                style={{ width: '100%' }}
                            >
                                {DIRECTION_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div style={{ marginBottom: '3px' }}>
                            <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Attack type</div>
                            <select
                                id="monster-attack-type-select"
                                className="rpg-select"
                                value={attackType}
                                onChange={(e) => setAttackType(Number(e.target.value) as AttackType)}
                                style={{ width: '100%' }}
                            >
                                <option value={AttackType.NoInterrupt}>No Interrupt</option>
                                <option value={AttackType.Interrupt}>Interrupt</option>
                                <option value={AttackType.Stun}>Stun</option>
                                <option value={AttackType.Knockback}>Knockback</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: '3px' }}>
                            <div className="rpg-section-title" style={{ marginBottom: '3px' }}>
                                Summon count
                                <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                    ({summonCount})
                                </span>
                            </div>
                            <div className="rpg-zoom-container">
                                <RpgSlider
                                    value={[summonCount]}
                                    onValueChange={(value) => setSummonCount(value[0])}
                                    min={1}
                                    max={1000}
                                    step={1}
                                />
                            </div>
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Health
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({health})
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[health]}
                                onValueChange={(value) => setHealth(value[0])}
                                min={1}
                                max={1000}
                                step={1}
                            />
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Damage
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({damage})
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[damage]}
                                onValueChange={(value) => setDamage(value[0])}
                                min={1}
                                max={1000}
                                step={1}
                            />
                        </div>
                    </div>
                    <RpgVerticalSeparator />
                    <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingLeft: 8 }}>
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Movement speed
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                (
                                {movementSpeed === MONSTER_DIALOG_IMMOBILE_MS
                                    ? 'Immobile'
                                    : `${movementSpeed}ms`}
                                )
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[MONSTER_DIALOG_MOVEMENT_SLIDER_INVERT_SUM - movementSpeed]}
                                onValueChange={(value) => handleMovementSpeedChange(value[0])}
                                min={MONSTER_DIALOG_MIN_MOVEMENT_MS}
                                max={MONSTER_DIALOG_IMMOBILE_MS}
                                step={1}
                            />
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Attack speed
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({attackSpeedMs}ms)
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[MONSTER_DIALOG_ATTACK_SPEED_SLIDER_INVERT_SUM - attackSpeedMs]}
                                onValueChange={(value) => handleAttackSpeedChange(value[0])}
                                min={MONSTER_DIALOG_MIN_ATTACK_SPEED_MS}
                                max={MONSTER_DIALOG_MAX_ATTACK_SPEED_MS}
                                step={1}
                            />
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Attack recovery time
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({attackRecoveryMs}ms)
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[MONSTER_DIALOG_ATTACK_RECOVERY_SLIDER_INVERT_SUM - attackRecoveryMs]}
                                onValueChange={(value) => handleAttackRecoveryChange(value[0])}
                                min={MONSTER_DIALOG_MIN_ATTACK_RECOVERY_MS}
                                max={MONSTER_DIALOG_MAX_ATTACK_RECOVERY_MS}
                                step={1}
                            />
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Stun duration
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({stunDurationMs}ms)
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[stunDurationMs]}
                                onValueChange={(value) => handleStunDurationChange(value[0])}
                                min={MONSTER_DIALOG_MIN_STUN_DURATION_MS}
                                max={MONSTER_DIALOG_MAX_STUN_DURATION_MS}
                                step={1}
                            />
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Chase range
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({chaseRangeCells} cells)
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[chaseRangeCells]}
                                onValueChange={(value) => handleChaseRangeChange(value[0])}
                                min={MONSTER_MIN_CHASE_RANGE_CELLS}
                                max={MONSTER_MAX_CHASE_RANGE_CELLS}
                                step={1}
                            />
                        </div>
                        <RpgHorizontalSeparator />
                        <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                            Attack range
                            <span style={{ marginLeft: '8px', color: '#ffa500', fontSize: '12px' }}>
                                ({attackRangeCells} cells)
                            </span>
                        </div>
                        <div className="rpg-zoom-container">
                            <RpgSlider
                                value={[attackRangeCells]}
                                onValueChange={(value) => handleAttackRangeChange(value[0])}
                                min={MONSTER_MIN_ATTACK_RANGE_CELLS}
                                max={MONSTER_MAX_ATTACK_RANGE_CELLS}
                                step={1}
                            />
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '12px', flexShrink: 0 }}>
                    <RpgButton
                        onClick={handleSummon}
                        style={{
                            padding: '8px 24px',
                            fontSize: '14px',
                            minWidth: '100px',
                        }}
                    >
                        Summon
                    </RpgButton>
                    <RpgButton
                        onClick={handleKillAll}
                        style={{
                            padding: '8px 24px',
                            fontSize: '14px',
                            minWidth: '100px',
                        }}
                    >
                        Kill all
                    </RpgButton>
                </div>
            </div>
        </DraggableDialog>
    );
}
