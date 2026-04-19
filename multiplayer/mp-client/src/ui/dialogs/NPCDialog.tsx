import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import {
    npcDialogStore,
    setSelectedCatalogId,
    setSelectedDirection,
    summonNPC,
    setNPCDialogOpen,
    requestKillAllNpcs,
} from '../store/NPCDialog.store';
import { Direction, toDirection } from '../../utils/CoordinateUtils';

interface NPCDialogProps {
    position: { x: number; y: number };
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

export function NPCDialog({
    position,
    zIndex,
    onBringToFront,
}: NPCDialogProps) {
    const selectedCatalogId = useStore(npcDialogStore, (state) => state.selectedCatalogId);
    const selectedDirection = useStore(npcDialogStore, (state) => state.selectedDirection);
    const directoryOptions = useStore(npcDialogStore, (state) => state.directoryOptions);

    const handleSummon = () => {
        summonNPC();
    };

    const handleKillAll = () => {
        requestKillAllNpcs();
    };

    const sortedOptions = directoryOptions.slice().sort((a, b) => a.name.localeCompare(b.name));

    return (
        <DraggableDialog
            title="Summon NPC"
            position={position}
            id="npc-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                setNPCDialogOpen(false);
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 220, flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div style={{ marginBottom: '3px' }}>
                        <div className="rpg-section-title" style={{ marginBottom: '3px' }}>
                            NPC
                        </div>
                        <select
                            id="npc-select"
                            className="rpg-select"
                            value={selectedCatalogId}
                            onChange={(e) => setSelectedCatalogId(e.target.value)}
                            style={{ width: '100%' }}
                            disabled={sortedOptions.length === 0}
                        >
                            {sortedOptions.map((option) => (
                                <option key={option.id} value={String(option.id)}>
                                    {option.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={{ marginBottom: '3px' }}>
                        <div className="rpg-section-title" style={{ marginBottom: '3px' }}>
                            Direction
                        </div>
                        <select
                            id="npc-direction-select"
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
                </div>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: '12px',
                        marginTop: '12px',
                        flexShrink: 0,
                    }}
                >
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
