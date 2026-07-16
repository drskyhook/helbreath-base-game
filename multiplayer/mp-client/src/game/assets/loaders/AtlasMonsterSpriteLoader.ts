import type { Scene } from 'phaser';
import type { AssetData } from '../../../constants/Assets';
import type { PivotData } from '../../../Types';
import { setPivotDataBySpriteName } from '../../../utils/RegistryUtils';
import type {
    SpriteAtlasAnimation,
    SpriteAtlasDefinition,
    SpriteAtlasFrame,
} from '../SpriteAtlasDefinition';
import type { MonsterSpriteLoader } from './MonsterSpriteLoader';

const LEGACY_ACTION_OFFSETS: Record<string, number> = {
    idle: 0,
    move: 8,
    attack: 16,
    'take-damage': 24,
    death: 32,
};

const LEGACY_DIRECTION_NAMES = [
    'north',
    'northeast',
    'east',
    'southeast',
    'south',
    'southwest',
    'west',
    'northwest',
];

type CompatibilityAnimation = {
    animation: SpriteAtlasAnimation;
    compatibilityIndex: number;
};

export class AtlasMonsterSpriteLoader implements MonsterSpriteLoader {
    public isLoaded(scene: Scene, asset: AssetData): boolean {
        return scene.textures.exists(`${asset.key}-0`);
    }

    public async load(scene: Scene, asset: AssetData): Promise<void> {
        const definition = await this.fetchDefinition(asset);
        const compatibilityAnimations = this.resolveCompatibilityAnimations(
            asset,
            definition,
        );
        const image = await this.fetchImage(asset, definition);
        const spriteSheetPivots: PivotData['spriteSheetPivots'] = [];

        try {
            const texture = this.registerAtlasTexture(
                scene,
                asset.key,
                image,
                definition.frames,
            );

            for (const entry of compatibilityAnimations) {
                const textureKey = `${asset.key}-${entry.compatibilityIndex}`;
                const frameEntries = entry.animation.frames.map((frameName) => {
                    const frame = definition.frames[frameName];
                    if (!frame) {
                        throw new Error(
                            `Monster atlas animation references missing frame '${frameName}' ` +
                            `in ${asset.fileName}`,
                        );
                    }
                    return { frame, frameName };
                });

                this.registerCompatibilityTextureAlias(scene, textureKey, texture);
                const compatibilityFrames = this.registerCompatibilityFrames(
                    texture,
                    textureKey,
                    frameEntries,
                );
                this.registerAnimation(
                    scene,
                    textureKey,
                    asset.key,
                    compatibilityFrames,
                    entry.animation.loop ?? true,
                );
                spriteSheetPivots[entry.compatibilityIndex] = frameEntries.map(({ frame }) => ({
                    pivotX: frame.pivotX,
                    pivotY: frame.pivotY,
                    width: frame.width,
                    height: frame.height,
                }));
            }
        } finally {
            image.close();
        }

        setPivotDataBySpriteName(scene, asset.key.toLowerCase(), {
            spriteSheetPivots,
        });
    }

    private async fetchDefinition(asset: AssetData): Promise<SpriteAtlasDefinition> {
        const response = await fetch(`assets/sprites/${asset.fileName}`);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch monster atlas ${asset.fileName}: ` +
                `${response.status} ${response.statusText}`,
            );
        }

        const definition = await response.json() as SpriteAtlasDefinition;
        if (
            definition.version !== 1 ||
            !definition.image ||
            !definition.frames ||
            !definition.animations
        ) {
            throw new Error(`Invalid monster atlas definition: ${asset.fileName}`);
        }
        return definition;
    }

    private async fetchImage(
        asset: AssetData,
        definition: SpriteAtlasDefinition,
    ): Promise<ImageBitmap> {
        const lastSlash = asset.fileName.lastIndexOf('/');
        const directory = lastSlash >= 0
            ? asset.fileName.slice(0, lastSlash + 1)
            : '';
        const imagePath = `${directory}${definition.image}`;
        const response = await fetch(`assets/sprites/${imagePath}`);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch monster atlas image ${imagePath}: ` +
                `${response.status} ${response.statusText}`,
            );
        }
        return createImageBitmap(await response.blob());
    }

    private resolveCompatibilityAnimations(
        asset: AssetData,
        definition: SpriteAtlasDefinition,
    ): CompatibilityAnimation[] {
        const resolved: CompatibilityAnimation[] = [];

        for (const [action, offset] of Object.entries(LEGACY_ACTION_OFFSETS)) {
            for (let direction = 0; direction < 8; direction++) {
                const semanticName = `${action}-${LEGACY_DIRECTION_NAMES[direction]}`;
                const migratedName = `${action}-direction-${direction}`;
                const animation = definition.animations[semanticName]
                    ?? definition.animations[migratedName];
                if (!animation) {
                    throw new Error(
                        `Monster atlas ${asset.fileName} is missing required animation ` +
                        `'${semanticName}'`,
                    );
                }
                resolved.push({
                    animation,
                    compatibilityIndex: offset + direction,
                });
            }
        }

        return resolved;
    }

    private registerAtlasTexture(
        scene: Scene,
        textureKey: string,
        image: ImageBitmap,
        frames: Record<string, SpriteAtlasFrame>,
    ): Phaser.Textures.Texture {
        if (scene.textures.exists(textureKey)) {
            return scene.textures.get(textureKey);
        }

        const textureManager = scene.textures as Phaser.Textures.TextureManager & {
            create: (
                key: string,
                source: ImageBitmap,
                width?: number,
                height?: number,
            ) => Phaser.Textures.Texture | null;
        };
        const texture = textureManager.create(
            textureKey,
            image,
            image.width,
            image.height,
        );
        if (!texture) {
            throw new Error(`Failed to create monster atlas texture ${textureKey}`);
        }

        if (texture.source[0]) {
            texture.source[0].scaleMode = 0;
        }
        for (const [frameName, frame] of Object.entries(frames)) {
            texture.add(
                frameName,
                0,
                frame.x,
                frame.y,
                frame.width,
                frame.height,
            );
        }

        return texture;
    }

    private registerCompatibilityTextureAlias(
        scene: Scene,
        aliasKey: string,
        texture: Phaser.Textures.Texture,
    ): void {
        if (scene.textures.exists(aliasKey)) {
            return;
        }

        // Current rendering consumers require texture keys ending in numeric indices.
        // Point those temporary compatibility keys at the one atlas Texture so Phaser
        // uploads the PNG once instead of creating 40 duplicate WebGL textures.
        const textureManager = scene.textures as Phaser.Textures.TextureManager & {
            list: Record<string, Phaser.Textures.Texture>;
        };
        textureManager.list[aliasKey] = texture;
    }

    private registerCompatibilityFrames(
        texture: Phaser.Textures.Texture,
        compatibilityKey: string,
        frames: Array<{
            frame: SpriteAtlasFrame;
            frameName: string;
        }>,
    ): Array<{
        frame: SpriteAtlasFrame;
        frameName: string;
    }> {
        return frames.map(({ frame }, frameIndex) => {
            // GameAsset currently derives relative position with parseInt(frame.name).
            // Keep the numeric prefix local to Phaser compatibility registrations;
            // semantic frame names remain the authored atlas contract.
            const frameName = `${frameIndex}-${compatibilityKey}`;
            if (!texture.has(frameName)) {
                texture.add(
                    frameName,
                    0,
                    frame.x,
                    frame.y,
                    frame.width,
                    frame.height,
                );
            }
            return { frame, frameName };
        });
    }

    private registerAnimation(
        scene: Scene,
        animationKey: string,
        atlasTextureKey: string,
        frames: Array<{
            frame: SpriteAtlasFrame;
            frameName: string;
        }>,
        loop: boolean,
    ): void {
        if (scene.anims.exists(animationKey)) {
            return;
        }

        scene.anims.create({
            key: animationKey,
            frames: frames.map(({ frame, frameName }) => ({
                key: atlasTextureKey,
                frame: frameName,
                duration: frame.durationMs ?? 0,
                customData: {
                    pivotX: frame.pivotX,
                    pivotY: frame.pivotY,
                    width: frame.width,
                    height: frame.height,
                },
            })),
            frameRate: 10,
            repeat: loop ? -1 : 0,
        });
    }
}
