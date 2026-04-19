import type { GameObjects, Scene } from 'phaser';
import { ItemEffect, type Effect } from '../constants/Items';

const ITEM_GLOW_PADDING = 16;
const SPAWN_PROTECTION_GLOW_DISTANCE = 30;

/**
 * Resolves Phaser frame name for overlay/ghost sync (matches prior GameAsset behavior).
 */
export function getFrameNameFromSpriteFrame(
    frame: Phaser.Animations.AnimationFrame | Phaser.Textures.Frame | undefined,
    fixedFrameIndex?: number,
): string {
    if (!frame) {
        return fixedFrameIndex !== undefined ? String(fixedFrameIndex) : '0';
    }
    const f = frame as { textureFrame?: number; frame?: { name?: string }; index?: number; name?: string };
    const name = f.textureFrame ?? f.frame?.name ?? f.index ?? f.name;
    return name !== undefined ? String(name) : (fixedFrameIndex !== undefined ? String(fixedFrameIndex) : '0');
}

/**
 * Item-driven and status visuals on a GameAsset body sprite: glare, glow, saturate, spawn-protection glow,
 * chilled/disconnected tint resolution, and shared oscillation tween.
 */
export class GameAssetVisualEffect {
    private glareOverlay: GameObjects.Sprite | undefined;
    private saturateOverlay: GameObjects.Sprite | undefined;
    private saturateOverlayColor: number = 0xff4444;
    private saturateOverlayAlpha: number = 0.5;
    private effectOscillationProgress = { value: 0 };
    private effectOscillationTween: Phaser.Tweens.Tween | undefined;
    private glowEffect: Phaser.FX.Glow | undefined;
    private spawnProtectionGlowEffect: Phaser.FX.Glow | undefined;
    private currentEffects: Effect[] = [];
    private currentEffectColor: number = 0x0000ff;
    private isChilledTinted = false;
    private isDisconnectedTinted = false;

    public constructor(
        private readonly scene: Scene,
        private readonly sprite: GameObjects.Sprite,
        private readonly getFixedFrameIndex: () => number | undefined,
    ) {}

    public setItemEffects(effects?: Effect[]): void {
        this.currentEffects = effects ?? [];
        this.stopEffectOscillationTween();
        const glareEffect = this.currentEffects.find((e) => e.effect === ItemEffect.GLARE);
        this.currentEffectColor = glareEffect?.effectColor ?? 0x0000ff;
        this.destroyGlareOverlay();
        if (glareEffect) {
            this.createGlareOverlay();
        }
        this.destroyGlowEffect();
        const glowEffectConfig = this.currentEffects.find((e) => e.effect === ItemEffect.GLOW);
        if (glowEffectConfig) {
            this.createGlowEffect(glowEffectConfig.effectColor ?? 0xffffff);
        }
        this.applyResolvedTint();
        this.startEffectOscillationTween();
    }

    public setSaturateOverlay(enabled: boolean, color: number = 0xff4444, alpha: number = 0.5): void {
        if (enabled) {
            const colorChanged = this.saturateOverlayColor !== color;
            const alphaChanged = this.saturateOverlayAlpha !== alpha;
            this.saturateOverlayColor = color;
            this.saturateOverlayAlpha = alpha;
            if (!this.saturateOverlay || colorChanged || alphaChanged) {
                if (this.saturateOverlay) {
                    this.destroySaturateOverlay();
                }
                this.createSaturateOverlay();
            }
        } else if (this.saturateOverlay) {
            this.destroySaturateOverlay();
        }
        if (this.saturateOverlay) {
            this.saturateOverlay.setVisible(enabled && this.sprite.visible);
        }
    }

    public setChilledTint(chilled: boolean): void {
        this.isChilledTinted = chilled;
        this.applyResolvedTint();
    }

    public setDisconnectedTint(disconnected: boolean): void {
        this.isDisconnectedTinted = disconnected;
        this.applyResolvedTint();
    }

    public setSpawnProtectionGlow(enabled: boolean): void {
        if (enabled) {
            if (this.spawnProtectionGlowEffect) {
                return;
            }
            this.spawnProtectionGlowEffect = this.sprite.postFX.addGlow(
                0x55ee88,
                0.5,
                0,
                false,
                0.1,
                SPAWN_PROTECTION_GLOW_DISTANCE,
            );
            if (!this.spawnProtectionGlowEffect) {
                return;
            }
            this.startEffectOscillationTween();
        } else {
            this.destroySpawnProtectionGlowEffect();
        }
    }

    public setAlpha(alpha: number): void {
        if (this.saturateOverlay) {
            this.saturateOverlay.setAlpha(this.saturateOverlayAlpha * alpha);
        }
    }

    public setVisible(visible: boolean): void {
        if (this.saturateOverlay) {
            this.saturateOverlay.setVisible(visible);
        }
        if (this.glareOverlay) {
            this.glareOverlay.setVisible(visible);
        }
    }

    public updateOverlayDepths(actualDepth: number): void {
        if (this.saturateOverlay) {
            this.saturateOverlay.setDepth(actualDepth + 1);
        }
        if (this.glareOverlay) {
            this.glareOverlay.setDepth(actualDepth + 2);
        }
    }

    public syncOverlayPositionsToSprite(): void {
        if (this.saturateOverlay) {
            this.saturateOverlay.setPosition(this.sprite.x, this.sprite.y);
        }
        if (this.glareOverlay) {
            this.glareOverlay.setPosition(this.sprite.x, this.sprite.y);
        }
    }

    public syncOverlayFramesAfterAnimationPlay(): void {
        if (this.saturateOverlay) {
            this.syncSaturateOverlayFrame();
        }
        if (this.glareOverlay) {
            this.syncGlareOverlayFrame();
        }
    }

    public destroy(): void {
        this.stopEffectOscillationTween();
        this.destroySaturateOverlay();
        this.destroyGlareOverlay();
        this.destroySpawnProtectionGlowEffect();
        this.destroyGlowEffect();
    }

    private applyResolvedTint(): void {
        if (this.isDisconnectedTinted) {
            this.sprite.setTint(0x4d4d49);
            return;
        }

        if (this.isChilledTinted) {
            this.sprite.setTint(0x88aaff);
            return;
        }

        const tintAppearanceEffect = this.currentEffects.find((e) => e.effect === ItemEffect.TINT_APPEARANCE);
        if (tintAppearanceEffect) {
            const color = tintAppearanceEffect.effectColor ?? 0xffffff;
            this.sprite.setTint(color);
        } else {
            this.sprite.clearTint();
        }
    }

    private createGlareOverlay(): void {
        const hasGlare = this.currentEffects.some((e) => e.effect === ItemEffect.GLARE);
        const textureKey = this.sprite.texture?.key;
        if (!hasGlare || !textureKey) {
            return;
        }

        const frame = this.sprite.anims?.currentFrame ?? this.sprite.frame;
        const frameName = getFrameNameFromSpriteFrame(frame, this.getFixedFrameIndex());
        const texture = this.scene.textures.get(textureKey);
        const safeFrame = texture.has(frameName) ? frameName : '0';

        this.glareOverlay = this.scene.add.sprite(this.sprite.x, this.sprite.y, textureKey, safeFrame);
        this.glareOverlay.setOrigin(0, 0);
        this.glareOverlay.setBlendMode(Phaser.BlendModes.ADD);
        this.glareOverlay.setTint(this.currentEffectColor);
        this.glareOverlay.setAlpha(0.4);
        this.glareOverlay.setDepth(this.sprite.depth + 1);
        this.glareOverlay.setVisible(this.sprite.visible);
        this.scene.children.bringToTop(this.glareOverlay);

        this.startEffectOscillationTween();

        this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.syncGlareOverlayFrame);
        this.sprite.on(Phaser.Animations.Events.ANIMATION_START, this.syncGlareOverlayFrame);
    }

    private syncGlareOverlayFrame = (): void => {
        if (!this.glareOverlay) {
            return;
        }
        const mainTextureKey = this.sprite.texture?.key;
        if (mainTextureKey && this.glareOverlay.texture?.key !== mainTextureKey) {
            this.destroyGlareOverlay();
            this.createGlareOverlay();
            return;
        }
        const frame = this.sprite.anims?.currentFrame ?? this.sprite.frame;
        const frameName = getFrameNameFromSpriteFrame(frame, this.getFixedFrameIndex());
        if (this.glareOverlay.frame?.name !== frameName) {
            this.glareOverlay.setFrame(frameName);
        }
    };

    private destroyGlareOverlay(): void {
        this.sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE, this.syncGlareOverlayFrame);
        this.sprite.off(Phaser.Animations.Events.ANIMATION_START, this.syncGlareOverlayFrame);
        this.glareOverlay?.destroy();
        this.glareOverlay = undefined;
    }

    private createSaturateOverlay(): void {
        const textureKey = this.sprite.texture?.key;
        if (!textureKey) {
            return;
        }
        const frame = this.sprite.anims?.currentFrame ?? this.sprite.frame;
        const frameName = getFrameNameFromSpriteFrame(frame, this.getFixedFrameIndex());
        const texture = this.scene.textures.get(textureKey);
        const safeFrame = texture.has(frameName) ? frameName : '0';

        this.saturateOverlay = this.scene.add.sprite(this.sprite.x, this.sprite.y, textureKey, safeFrame);
        this.saturateOverlay.setOrigin(0, 0);
        this.saturateOverlay.setBlendMode(Phaser.BlendModes.ADD);
        this.saturateOverlay.setTint(this.saturateOverlayColor);
        this.saturateOverlay.setAlpha(this.saturateOverlayAlpha * this.sprite.alpha);
        this.saturateOverlay.setDepth(this.sprite.depth + 1);
        this.saturateOverlay.setVisible(this.sprite.visible);
        this.scene.children.bringToTop(this.saturateOverlay);

        this.sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, this.syncSaturateOverlayFrame);
        this.sprite.on(Phaser.Animations.Events.ANIMATION_START, this.syncSaturateOverlayFrame);
    }

    private syncSaturateOverlayFrame = (): void => {
        if (!this.saturateOverlay) {
            return;
        }
        const mainTextureKey = this.sprite.texture?.key;
        if (mainTextureKey && this.saturateOverlay.texture?.key !== mainTextureKey) {
            this.destroySaturateOverlay();
            this.createSaturateOverlay();
            return;
        }
        const frame = this.sprite.anims?.currentFrame ?? this.sprite.frame;
        const frameName = getFrameNameFromSpriteFrame(frame, this.getFixedFrameIndex());
        if (this.saturateOverlay.frame?.name !== frameName) {
            this.saturateOverlay.setFrame(frameName);
        }
    };

    private destroySaturateOverlay(): void {
        this.sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE, this.syncSaturateOverlayFrame);
        this.sprite.off(Phaser.Animations.Events.ANIMATION_START, this.syncSaturateOverlayFrame);
        this.saturateOverlay?.destroy();
        this.saturateOverlay = undefined;
    }

    private createGlowEffect(color: number): void {
        const hasGlow = this.currentEffects.some((e) => e.effect === ItemEffect.GLOW);
        if (!hasGlow) {
            return;
        }
        this.sprite.preFX?.setPadding(ITEM_GLOW_PADDING);
        this.glowEffect = this.sprite.preFX?.addGlow(color, 0.5, 0, false);
        if (!this.glowEffect) {
            return;
        }
        this.startEffectOscillationTween();
    }

    private destroyGlowEffect(): void {
        if (this.glowEffect && this.sprite.preFX) {
            this.sprite.preFX.remove(this.glowEffect);
            this.glowEffect = undefined;
        }
        this.sprite.preFX?.setPadding(0);
    }

    private destroySpawnProtectionGlowEffect(): void {
        if (this.spawnProtectionGlowEffect) {
            this.sprite.postFX?.remove(this.spawnProtectionGlowEffect);
            this.spawnProtectionGlowEffect = undefined;
        }
        this.maybeStopEffectOscillationTween();
    }

    private maybeStopEffectOscillationTween(): void {
        const hasGlare = this.glareOverlay != null;
        const hasItemGlow = this.glowEffect != null;
        const hasSpawnProtectionGlow = this.spawnProtectionGlowEffect != null;
        if (!hasGlare && !hasItemGlow && !hasSpawnProtectionGlow) {
            this.stopEffectOscillationTween();
            this.effectOscillationProgress.value = 0;
        }
    }

    private startEffectOscillationTween(): void {
        const hasGlare = this.glareOverlay != null;
        const hasItemGlow = this.glowEffect != null;
        const hasSpawnProtectionGlow = this.spawnProtectionGlowEffect != null;
        if ((!hasGlare && !hasItemGlow && !hasSpawnProtectionGlow) || this.effectOscillationTween?.isPlaying()) {
            return;
        }
        this.effectOscillationProgress.value = 0;
        this.applyEffectOscillationProgress();
        this.effectOscillationTween?.stop();
        this.effectOscillationTween = this.scene.tweens.add({
            targets: this.effectOscillationProgress,
            value: 1,
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            onUpdate: () => this.applyEffectOscillationProgress(),
        });
    }

    private stopEffectOscillationTween(): void {
        this.effectOscillationTween?.stop();
        this.effectOscillationTween = undefined;
    }

    private applyEffectOscillationProgress(): void {
        const p = this.effectOscillationProgress.value;
        if (this.glareOverlay) {
            this.glareOverlay.setAlpha(0.4 + p * 0.6);
        }
        if (this.glowEffect) {
            this.glowEffect.outerStrength = 0.5 + p * 4.5;
        }
        if (this.spawnProtectionGlowEffect) {
            this.spawnProtectionGlowEffect.outerStrength = 0.5 + p * 4.5;
        }
    }
}
