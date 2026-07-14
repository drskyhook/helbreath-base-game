import type { AssetData } from '../../../constants/Assets';
import { SpriteAssetFormat } from '../SpriteAssetFormat';
import { AtlasMonsterSpriteLoader } from './AtlasMonsterSpriteLoader';
import { LegacySprMonsterSpriteLoader } from './LegacySprMonsterSpriteLoader';
import type { MonsterSpriteLoader } from './MonsterSpriteLoader';

const legacySprLoader = new LegacySprMonsterSpriteLoader();
const atlasLoader = new AtlasMonsterSpriteLoader();

export function getMonsterSpriteLoader(
    asset: AssetData,
): MonsterSpriteLoader {
    const spriteFormat = asset.spriteFormat ?? SpriteAssetFormat.Spr;

    switch (spriteFormat) {
        case SpriteAssetFormat.Spr:
            return legacySprLoader;

        case SpriteAssetFormat.Atlas:
            return atlasLoader;

        default:
            throw new Error(
                `Unsupported sprite format '${spriteFormat}' for asset ${asset.key}`,
            );
    }
}