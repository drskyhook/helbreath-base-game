const STANDARD_MONSTER_ANIMATIONS = [
    { action: 'idle', startSheet: 0, loop: true },
    { action: 'move', startSheet: 8, loop: true },
    { action: 'attack', startSheet: 16, loop: false },
    { action: 'take-damage', startSheet: 24, loop: false },
    { action: 'death', startSheet: 32, loop: false },
];

const DIRECTION_COUNT = 8;

/**
 * Converts legacy Helbreath monster sheet indexes into semantic
 * runtime atlas animations.
 */
function buildMonsterAtlasDefinition(
    imageFileName,
    sprites,
    placements,
) {
    const expectedSheetCount =
        STANDARD_MONSTER_ANIMATIONS.length * DIRECTION_COUNT;

    if (sprites.length !== expectedSheetCount) {
        throw new Error(
            'The Helbreath monster profile expects ' +
            `${expectedSheetCount} sprite sheets, received ${sprites.length}`,
        );
    }

    const placementLookup = new Map();

    for (const placement of placements) {
        placementLookup.set(
            `${placement.spriteSheetIndex}:${placement.frameIndex}`,
            placement,
        );
    }

    const frames = {};
    const animations = {};

    for (const animationProfile of STANDARD_MONSTER_ANIMATIONS) {
        for (let direction = 0; direction < DIRECTION_COUNT; direction++) {
            const animationName =
                `${animationProfile.action}-direction-${direction}`;

            const sprite =
                sprites[animationProfile.startSheet + direction];

            const animationFrames = [];

            for (const frame of sprite.frames) {
                const frameName =
                    `${animationName}-frame-${frame.index}`;

                const placement = placementLookup.get(
                    `${sprite.index}:${frame.index}`,
                );

                if (!placement) {
                    frames[frameName] = {
                        x: 0,
                        y: 0,
                        width: 0,
                        height: 0,
                        pivotX: frame.pivotX,
                        pivotY: frame.pivotY,
                    };
                } else {
                    frames[frameName] = {
                        x: placement.atlasX,
                        y: placement.atlasY,
                        width: placement.width,
                        height: placement.height,
                        pivotX: placement.pivotX,
                        pivotY: placement.pivotY,
                    };
                }

                animationFrames.push(frameName);
            }

            animations[animationName] = {
                frames: animationFrames,
                loop: animationProfile.loop,
            };
        }
    }

    return {
        version: 1,
        image: imageFileName,
        frames,
        animations,
    };
}

module.exports = {
    buildMonsterAtlasDefinition,
};