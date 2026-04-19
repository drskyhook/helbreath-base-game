import { useStore } from '@tanstack/react-store';
import { DraggableDialog } from './DraggableDialog';
import { RpgButton } from '../components/RpgButton';
import { castDialogStore, setSelectedSpellId, castSpell, setCastDialogOpen } from '../store/CastDialog.store';

interface CastDialogProps {
    position: { x: number; y: number };
    zIndex?: number;
    onBringToFront?: () => void;
}

export function CastDialog({
    position,
    zIndex,
    onBringToFront,
}: CastDialogProps) {
    const spells = useStore(castDialogStore, (state) => state.spells);
    const selectedSpellId = useStore(castDialogStore, (state) => state.selectedSpellId);

    const handleCast = () => {
        castSpell();
    };

    return (
        <DraggableDialog
            title="Cast Spell"
            position={position}
            id="cast-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                setCastDialogOpen(false);
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 100 }}>
                <div style={{ marginBottom: '8px' }}>
                    <div className="rpg-section-title" style={{ marginBottom: '3px' }}>Spell</div>
                    <select
                        id="spell-select"
                        className="rpg-select"
                        value={selectedSpellId ?? ''}
                        onChange={(e) => setSelectedSpellId(Number(e.target.value))}
                        style={{ width: '100%' }}
                        disabled={spells.length === 0}
                    >
                        {spells.length === 0 ? (
                            <option value="">No spells available</option>
                        ) : spells.map((spell) => (
                            <option key={spell.id} value={spell.id}>
                                {spell.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px', flexDirection: 'column', gap: '8px' }}>
                    <RpgButton
                        onClick={handleCast}
                        disabled={spells.length === 0 || selectedSpellId === undefined}
                        style={{
                            padding: '8px 24px',
                            fontSize: '14px',
                            minWidth: '100px',
                        }}
                    >
                        Cast
                    </RpgButton>
                </div>
            </div>
        </DraggableDialog>
    );
}
