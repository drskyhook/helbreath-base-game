import { HeadlessDraggableDialog } from './HeadlessDraggableDialog';

interface ConnectingDialogProps {
    position: { x: number; y: number };
    zIndex?: number;
    onBringToFront?: () => void;
}

export function ConnectingDialog({
    position,
    zIndex,
    onBringToFront,
}: ConnectingDialogProps) {
    return (
        <HeadlessDraggableDialog
            position={position}
            id="connecting-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => e.preventDefault()}
            disableDrag
        >
            <div style={{
                color: 'var(--rpg-parchment)',
                fontFamily: 'Georgia, serif',
                fontSize: '16px',
                lineHeight: '1.6',
                textAlign: 'center',
                padding: '16px',
            }}>
                <p style={{ margin: 0 }}>
                    Connecting to server...
                </p>
            </div>
        </HeadlessDraggableDialog>
    );
}
