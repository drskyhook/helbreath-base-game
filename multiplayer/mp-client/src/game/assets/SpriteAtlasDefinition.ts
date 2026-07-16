export interface SpriteAtlasFrame {
    x: number;
    y: number;
    width: number;
    height: number;
    pivotX: number;
    pivotY: number;
    durationMs?: number;
}

export interface SpriteAtlasAnimation {
    frames: string[];
    loop?: boolean;
}

export interface SpriteAtlasDefinition {
    version: number;
    image: string;
    frames: Record<string, SpriteAtlasFrame>;
    animations: Record<string, SpriteAtlasAnimation>;
}
