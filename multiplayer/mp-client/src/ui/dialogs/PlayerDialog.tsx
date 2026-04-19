import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgHorizontalSeparator } from '../components/RpgHorizontalSeparator';
import { RpgVerticalSeparator } from '../components/RpgVerticalSeparator';
import { RpgSlider } from '../components/RpgSlider';
import { RpgCheckbox } from '../components/RpgCheckbox';
import {
    playerDialogStore,
    setMovementSpeed,
    setAttackSpeedMs,
    PLAYER_ATTACK_SPEED_MS_MIN,
    PLAYER_ATTACK_SPEED_MS_MAX,
    setAttackRange,
    setDamage,
    setAttackType,
    setCastSpeedMs,
    PLAYER_CAST_SPEED_MS_MIN,
    PLAYER_CAST_SPEED_MS_MAX,
    setAttackMode,
    setRunMode,
    setAllowDashAttack,
    setGender,
    setSkinColor,
    setUnderwearColorIndex,
    setHairStyleIndex,
    setStunDurationMs,
} from '../store/PlayerDialog.store';
import { AttackType, Gender, SkinColor } from '../../Types';

interface PlayerDialogProps {
    position: { x: number; y: number };
    onClose: () => void;
    zIndex?: number;
    onBringToFront?: () => void;
}

export function PlayerDialog({
    position,
    onClose,
    zIndex,
    onBringToFront,
}: PlayerDialogProps) {
    const gender = useStore(playerDialogStore, (state) => state.gender);
    const skinColor = useStore(playerDialogStore, (state) => state.skinColor);
    const underwearColorIndex = useStore(playerDialogStore, (state) => state.underwearColorIndex);
    const hairStyleIndex = useStore(playerDialogStore, (state) => state.hairStyleIndex);
    const movementSpeed = useStore(playerDialogStore, (state) => state.movementSpeed);
    const attackSpeedMs = useStore(playerDialogStore, (state) => state.attackSpeedMs);
    const attackRange = useStore(playerDialogStore, (state) => state.attackRange);
    const damage = useStore(playerDialogStore, (state) => state.damage);
    const attackType = useStore(playerDialogStore, (state) => state.attackType);
    const castSpeedMs = useStore(playerDialogStore, (state) => state.castSpeedMs);
    const attackMode = useStore(playerDialogStore, (state) => state.attackMode);
    const runMode = useStore(playerDialogStore, (state) => state.runMode);
    const allowDashAttack = useStore(playerDialogStore, (state) => state.allowDashAttack);
    const stunDurationMs = useStore(playerDialogStore, (state) => state.stunDurationMs);

    return (
        <DraggableDialog
            title="Player"
            position={position}
            id="player-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, minWidth: '380px' }}>
                <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingRight: 8 }}>
                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Movement speed
                    </div>
                    <div className="rpg-zoom-container">
                        <RpgSlider
                            value={[600 - movementSpeed]}
                            onValueChange={(value) => setMovementSpeed(600 - value[0])}
                            min={100}
                            max={500}
                            step={10}
                        />
                    </div>

                    <RpgHorizontalSeparator />

                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Cast speed ({castSpeedMs} ms)
                    </div>
                    <div className="rpg-zoom-container">
                        <RpgSlider
                            value={[PLAYER_CAST_SPEED_MS_MIN + PLAYER_CAST_SPEED_MS_MAX - castSpeedMs]}
                            onValueChange={(value) =>
                                setCastSpeedMs(PLAYER_CAST_SPEED_MS_MIN + PLAYER_CAST_SPEED_MS_MAX - value[0])
                            }
                            min={PLAYER_CAST_SPEED_MS_MIN}
                            max={PLAYER_CAST_SPEED_MS_MAX}
                            step={1}
                        />
                    </div>

                    <RpgHorizontalSeparator />

                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Attack speed ({attackSpeedMs} ms)
                    </div>
                    <div className="rpg-zoom-container">
                        <RpgSlider
                            value={[PLAYER_ATTACK_SPEED_MS_MIN + PLAYER_ATTACK_SPEED_MS_MAX - attackSpeedMs]}
                            onValueChange={(value) =>
                                setAttackSpeedMs(PLAYER_ATTACK_SPEED_MS_MIN + PLAYER_ATTACK_SPEED_MS_MAX - value[0])
                            }
                            min={PLAYER_ATTACK_SPEED_MS_MIN}
                            max={PLAYER_ATTACK_SPEED_MS_MAX}
                            step={1}
                        />
                    </div>

                    <RpgHorizontalSeparator />

                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Attack range ({attackRange} cells)
                    </div>
                    <div className="rpg-zoom-container">
                        <RpgSlider
                            value={[attackRange]}
                            onValueChange={(value) => setAttackRange(value[0])}
                            min={1}
                            max={20}
                            step={1}
                        />
                    </div>

                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Damage ({damage})
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

                    <RpgHorizontalSeparator />

                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Stun duration ({stunDurationMs} ms)
                    </div>
                    <div className="rpg-zoom-container">
                        <RpgSlider
                            value={[stunDurationMs]}
                            onValueChange={(value) => setStunDurationMs(value[0])}
                            min={100}
                            max={2000}
                            step={1}
                        />
                    </div>

                    <RpgHorizontalSeparator />

                    <div className="rpg-section-title" style={{ marginTop: '6px', marginBottom: '0px' }}>
                        Attack type
                    </div>
                    <div className="rpg-zoom-container">
                        <select
                            id="attack-type-select"
                            className="rpg-select"
                            value={attackType}
                            onChange={(e) => setAttackType(Number(e.target.value) as AttackType)}
                        >
                            <option value={AttackType.NoInterrupt}>No Interrupt</option>
                            <option value={AttackType.Interrupt}>Interrupt</option>
                            <option value={AttackType.Stun}>Stun</option>
                            <option value={AttackType.Knockback}>Knockback</option>
                        </select>
                    </div>

                    <RpgHorizontalSeparator />

                    <div className="rpg-zoom-container" style={{ marginTop: '6px', marginBottom: '6px' }}>
                        <RpgCheckbox
                            id="attack-mode-checkbox"
                            label="Attack mode"
                            checked={attackMode}
                            onCheckedChange={(checked) => setAttackMode(checked === true)}
                        />
                    </div>

                    <div className="rpg-zoom-container" style={{ marginTop: '6px', marginBottom: '6px' }}>
                        <RpgCheckbox
                            id="run-mode-checkbox"
                            label="Run mode"
                            checked={runMode}
                            onCheckedChange={(checked) => setRunMode(checked === true)}
                        />
                    </div>

                    <div className="rpg-zoom-container" style={{ marginTop: '6px', marginBottom: '6px' }}>
                        <RpgCheckbox
                            id="allow-dash-attack-checkbox"
                            label="Allow dash attack"
                            checked={allowDashAttack}
                            onCheckedChange={(checked) => setAllowDashAttack(checked === true)}
                        />
                    </div>
                </div>
                <RpgVerticalSeparator />
                <div style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingLeft: 8 }}>
                    <div style={{ marginBottom: '3px' }}>
                        <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Gender</div>
                        <select
                            id="gender-select"
                            className="rpg-select"
                            value={gender}
                            onChange={(e) => setGender(e.target.value as Gender)}
                            style={{ width: '100%' }}
                        >
                            <option value={Gender.MALE}>Male</option>
                            <option value={Gender.FEMALE}>Female</option>
                        </select>
                    </div>
                    <div style={{ marginBottom: '3px' }}>
                        <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Skin color</div>
                        <select
                            id="skin-color-select"
                            className="rpg-select"
                            value={skinColor}
                            onChange={(e) => setSkinColor(e.target.value as SkinColor)}
                            style={{ width: '100%' }}
                        >
                            <option value={SkinColor.Light}>Light</option>
                            <option value={SkinColor.Tanned}>Tanned</option>
                            <option value={SkinColor.Dark}>Dark</option>
                        </select>
                    </div>
                    <div style={{ marginBottom: '3px' }}>
                        <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Hair style</div>
                        <select
                            id="hair-style-select"
                            className="rpg-select"
                            value={hairStyleIndex}
                            onChange={(e) => setHairStyleIndex(Number(e.target.value))}
                            style={{ width: '100%' }}
                        >
                            <option value={0}>Style 1</option>
                            <option value={1}>Style 2</option>
                            <option value={2}>Style 3</option>
                            <option value={3}>Style 4</option>
                            <option value={4}>Style 5</option>
                            <option value={5}>Style 6</option>
                            <option value={6}>Style 7</option>
                            <option value={7}>Style 8</option>
                        </select>
                    </div>
                    <div style={{ marginBottom: '3px' }}>
                        <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Underwear color</div>
                        <select
                            id="underwear-color-select"
                            className="rpg-select"
                            value={underwearColorIndex}
                            onChange={(e) => setUnderwearColorIndex(Number(e.target.value))}
                            style={{ width: '100%' }}
                        >
                            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                                <option key={i} value={i}>
                                    Color {i + 1}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>
        </DraggableDialog>
    );
}
