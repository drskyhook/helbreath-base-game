#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { parseSpr } = require('./lib/parse-spr');


const {
    buildMonsterAtlasDefinition,
} = require('./profiles/helbreath-monster-profile');


/**
 * Extract every individual frame into an in-memory PNG buffer.
 */
async function extractFrameImages(sprites) {
    const extractedFrames = [];

    for (const sprite of sprites) {
        const sourceImage = sharp(sprite.imageData);

        for (const frame of sprite.frames) {
            if (frame.width <= 0 || frame.height <= 0) {
                console.warn(
                    `Skipping empty frame ${sprite.index}/${frame.index}: ` +
                    `${frame.width}x${frame.height}`,
                );
                continue;
            }

            const pngBuffer = await sourceImage
                .clone()
                .extract({
                    left: frame.left,
                    top: frame.top,
                    width: frame.width,
                    height: frame.height,
                })
                .png()
                .toBuffer();

            extractedFrames.push({
                spriteSheetIndex: sprite.index,
                frameIndex: frame.index,
                width: frame.width,
                height: frame.height,
                pivotX: frame.pivotX,
                pivotY: frame.pivotY,
                pngBuffer,
            });
        }
    }

    return extractedFrames;
}

/**
 * Packs frames into rows while respecting a maximum atlas width.
 *
 * This is intentionally simple and deterministic. We can replace it with a
 * tighter bin-packing algorithm later without changing the JSON contract.
 */
function calculatePlacements(frames, maxAtlasWidth, padding) {
    const placements = [];

    let cursorX = padding;
    let cursorY = padding;
    let rowHeight = 0;
    let usedWidth = 0;

    for (const frame of frames) {
        const requiredWidth = frame.width + padding;

        if (
            cursorX > padding &&
            cursorX + requiredWidth > maxAtlasWidth
        ) {
            cursorX = padding;
            cursorY += rowHeight + padding;
            rowHeight = 0;
        }

        placements.push({
            ...frame,
            atlasX: cursorX,
            atlasY: cursorY,
        });

        cursorX += frame.width + padding;
        rowHeight = Math.max(rowHeight, frame.height);
        usedWidth = Math.max(usedWidth, cursorX);
    }

    const atlasWidth = Math.max(1, usedWidth);
    const atlasHeight = Math.max(1, cursorY + rowHeight + padding);

    return {
        placements,
        atlasWidth,
        atlasHeight,
    };
}

/**
 * Builds a transparent atlas PNG from the extracted frame images.
 */
async function buildAtlas(placements, atlasWidth, atlasHeight, outputPath) {
    const compositeEntries = placements.map((placement) => ({
        input: placement.pngBuffer,
        left: placement.atlasX,
        top: placement.atlasY,
    }));

    await sharp({
        create: {
            width: atlasWidth,
            height: atlasHeight,
            channels: 4,
            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0,
            },
        },
    })
        .composite(compositeEntries)
        .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
        })
        .toFile(outputPath);
}

function printUsage() {
    console.error(
        'Usage:\n' +
        '  node convert-spr-to-atlas.js <input.spr> <output-directory>\n\n' +
        'Example:\n' +
        '  node convert-spr-to-atlas.js ' +
        '../multiplayer/mp-client/public/assets/sprites/bograt.spr ' +
        '../multiplayer/mp-client/public/assets/sprites/bograt',
    );
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const inputPath = path.resolve(args[0]);
    const outputDirectory = path.resolve(args[1]);

    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input SPR file does not exist: ${inputPath}`);
    }

    if (!fs.statSync(inputPath).isFile()) {
        throw new Error(`Input path is not a file: ${inputPath}`);
    }

    const extension = path.extname(inputPath).toLowerCase();
    if (extension !== '.spr') {
        throw new Error(`Expected a .spr file, received: ${inputPath}`);
    }

    fs.mkdirSync(outputDirectory, { recursive: true });

    const baseName = path.basename(inputPath, extension);
    const imageFileName = `${baseName}.png`;
    const jsonFileName = `${baseName}.json`;

    const imageOutputPath = path.join(outputDirectory, imageFileName);
    const jsonOutputPath = path.join(outputDirectory, jsonFileName);

    console.log(`Reading ${inputPath}`);

    const sourceBuffer = fs.readFileSync(inputPath);
    const sprites = parseSpr(sourceBuffer);

    console.log(`Found ${sprites.length} sprite sheets`);

    const frames = await extractFrameImages(sprites);

    console.log(`Extracted ${frames.length} non-empty frames in memory`);

    const padding = 1;
    const maxAtlasWidth = 2048;

    const {
        placements,
        atlasWidth,
        atlasHeight,
    } = calculatePlacements(frames, maxAtlasWidth, padding);

    console.log(`Building ${atlasWidth}x${atlasHeight} atlas`);

    await buildAtlas(
        placements,
        atlasWidth,
        atlasHeight,
        imageOutputPath,
    );

    const definition = buildMonsterAtlasDefinition(
        imageFileName,
        sprites,
        placements,
    );

    fs.writeFileSync(
        jsonOutputPath,
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
    );

    console.log('');
    console.log('Atlas conversion complete:');
    console.log(`  PNG:  ${imageOutputPath}`);
    console.log(`  JSON: ${jsonOutputPath}`);
}

main().catch((error) => {
    console.error('');
    console.error('SPR atlas conversion failed.');
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
