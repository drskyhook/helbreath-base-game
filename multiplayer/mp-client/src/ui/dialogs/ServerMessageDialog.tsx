import { DraggableDialog } from "./DraggableDialog";
import { RpgButton } from "../components/RpgButton";
import { EventBus } from "../../game/EventBus";
import { IN_UI_SUPPRESS_POINTER_INPUT } from "../../constants/EventNames";

interface ServerMessageDialogProps {
    message: string;
    position: { x: number; y: number };
    onClose: () => void;
    zIndex?: number;
    onBringToFront?: () => void;
}

export function ServerMessageDialog({
    message,
    position,
    onClose,
    zIndex,
    onBringToFront,
}: ServerMessageDialogProps) {
    const suppressPointerLeak = () => {
        EventBus.emit(IN_UI_SUPPRESS_POINTER_INPUT, 150);
    };

    return (
        <DraggableDialog
            title="Server Message"
            position={position}
            id="server-message-dialog"
            zIndex={zIndex}
            onBringToFront={onBringToFront}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minHeight: 0,
                    overflow: "hidden",
                    maxWidth: 800,
                }}
            >
                <div
                    style={{
                        color: "var(--rpg-parchment)",
                        fontFamily: "Georgia, serif",
                        fontSize: "16px",
                        lineHeight: "1.6",
                        marginBottom: "16px",
                        overflowY: "auto",
                        flex: 1,
                        minHeight: 0,
                        wordWrap: "break-word",
                    }}
                >
                    <p style={{ margin: "0" }}>{message}</p>
                </div>

                <div style={{ display: "flex", justifyContent: "center", flexShrink: 0, paddingTop: "12px" }}>
                    <RpgButton
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation?.();
                            suppressPointerLeak();
                        }}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation?.();
                            suppressPointerLeak();
                            onClose();
                        }}
                        style={{ width: "120px" }}
                    >
                        OK
                    </RpgButton>
                </div>
            </div>
        </DraggableDialog>
    );
}
