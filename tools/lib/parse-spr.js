const readInt16 = (buffer, offset) => buffer.readInt16LE(offset);
const readInt32 = (buffer, offset) => buffer.readInt32LE(offset);

/**
 * Parses a Helbreath .spr file into its embedded sprite sheets,
 * frame rectangles, pivots, and PNG image data.
 */
function parseSpr(buffer) {
    let offset = 0;

    const spriteCount = readInt16(buffer, offset);
    offset += 2;

    const metadata = [];

    for (let spriteIndex = 0; spriteIndex < spriteCount; spriteIndex++) {
        const frameCount = readInt16(buffer, offset);
        offset += 2;

        const imageLength = readInt32(buffer, offset);
        offset += 4;

        const imageWidth = readInt32(buffer, offset);
        offset += 4;

        const imageHeight = readInt32(buffer, offset);
        offset += 4;

        // Legacy start-location placeholder byte.
        offset += 1;

        const frames = [];

        for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            const left = readInt16(buffer, offset);
            offset += 2;

            const top = readInt16(buffer, offset);
            offset += 2;

            const width = readInt16(buffer, offset);
            offset += 2;

            const height = readInt16(buffer, offset);
            offset += 2;

            const pivotX = readInt16(buffer, offset);
            offset += 2;

            const pivotY = readInt16(buffer, offset);
            offset += 2;

            frames.push({
                index: frameIndex,
                left,
                top,
                width,
                height,
                pivotX,
                pivotY,
            });
        }

        metadata.push({
            index: spriteIndex,
            frames,
            imageLength,
            imageWidth,
            imageHeight,
        });
    }

    const sprites = [];

    for (const spriteMetadata of metadata) {
        // Legacy start-location integer. Sequential reading is sufficient.
        offset += 4;

        const imageData = buffer.subarray(
            offset,
            offset + spriteMetadata.imageLength,
        );

        offset += spriteMetadata.imageLength;

        sprites.push({
            ...spriteMetadata,
            imageData,
        });
    }

    return sprites;
}

module.exports = {
    parseSpr,
};