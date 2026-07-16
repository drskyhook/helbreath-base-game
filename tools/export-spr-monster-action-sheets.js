#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { parseSpr } = require('./lib/parse-spr');

const DIRECTIONS = [
    'north',
    'northeast',
    'east',
    'southeast',
    'south',
    'southwest',
    'west',
    'northwest',
];

const ACTIONS = [
    { name: 'idle', startSheet: 0 },
    { name: 'move', startSheet: 8 },
    { name: 'attack', startSheet: 16 },
    { name: 'take-damage', startSheet: 24 },
    { name: 'death', startSheet: 32 },
];

const DIRECTION_COUNT = DIRECTIONS.length;
const FRAME_COUNT = 8;

function fail(message) {
    throw new Error(message);
}

function validatePositiveInteger(value, label) {
    if (!Number.isInteger(value) || value <= 0) {
        fail(`${label} must be a positive integer`);
    }
}

function validateAnchor(anchorX, anchorY, cellWidth, cellHeight) {
    if (
        !Number.isInteger(anchorX) ||
        !Number.isInteger(anchorY) ||
        anchorX < 0 ||
        anchorX > cellWidth ||
        anchorY < 0 ||
        anchorY > cellHeight
    ) {
        fail(
            `Anchor ${anchorX},${anchorY} must be inside ` +
            `${cellWidth}x${cellHeight} cells`,
        );
    }
}

function parseArguments(args) {
    const positional = [];

    let cellWidth = 96;
    let cellHeight = 96;
    let anchorX = 48;
    let anchorY = 80;

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];

        switch (argument) {
            case '--cell-width':
                cellWidth = Number(args[++index]);
                break;

            case '--cell-height':
                cellHeight = Number(args[++index]);
                break;

            case '--anchor-x':
                anchorX = Number(args[++index]);
                break;

            case '--anchor-y':
                anchorY = Number(args[++index]);
                break;

            default:
                positional.push(argument);
                break;
        }
    }

    if (positional.length !== 2) {
        fail(
            'Usage: node export-spr-monster-action-sheets.js ' +
            '<input.spr> <output-directory> ' +
            '[--cell-width 96] [--cell-height 96] ' +
            '[--anchor-x 48] [--anchor-y 80]',
        );
    }

    validatePositiveInteger(cellWidth, '--cell-width');
    validatePositiveInteger(cellHeight, '--cell-height');
    validateAnchor(
        anchorX,
        anchorY,
        cellWidth,
        cellHeight,
    );

    return {
        inputPath: positional[0],
        outputDirectory: positional[1],
        cellWidth,
        cellHeight,
        anchorX,
        anchorY,
    };
}

function validateSourceFile(inputPath) {
    if (!fs.existsSync(inputPath)) {
        fail(`Input SPR file does not exist: ${inputPath}`);
    }

    if (!fs.statSync(inputPath).isFile()) {
        fail(`Input path is not a file: ${inputPath}`);
    }

    if (path.extname(inputPath).toLowerCase() !== '.spr') {
        fail(`Expected a .spr file: ${inputPath}`);
    }
}

function validateMonsterStructure(sprites) {
    const expectedSheetCount =
        ACTIONS.length * DIRECTION_COUNT;

    if (sprites.length !== expectedSheetCount) {
        fail(
            `Standard monster export expects ${expectedSheetCount} ` +
            `sprite sheets, received ${sprites.length}`,
        );
    }

    for (const sprite of sprites) {
        if (sprite.frames.length !== FRAME_COUNT) {
            fail(
                `Sprite sheet ${sprite.index} must contain ` +
                `${FRAME_COUNT} frames, received ${sprite.frames.length}`,
            );
        }
    }
}

async function extractFrameBuffer(sprite, frame) {
    if (frame.width <= 0 || frame.height <= 0) {
        fail(
            `Invalid frame dimensions in sheet ${sprite.index}, ` +
            `frame ${frame.index}: ${frame.width}x${frame.height}`,
        );
    }

    return sharp(sprite.imageData)
        .extract({
            left: frame.left,
            top: frame.top,
            width: frame.width,
            height: frame.height,
        })
        .ensureAlpha()
        .png()
        .toBuffer();
}

function calculateFramePlacement(
    frame,
    directionIndex,
    frameIndex,
    options,
) {
    const cellLeft =
        frameIndex * options.cellWidth;

    const cellTop =
        directionIndex * options.cellHeight;

    /*
     * SPR pivots describe the trimmed frame's position relative to
     * the creature's world anchor.
     *
     * Place that same world anchor at the configured position inside
     * every output cell so all frames remain consistently grounded.
     */
    const left =
        cellLeft +
        options.anchorX +
        frame.pivotX;

    const top =
        cellTop +
        options.anchorY +
        frame.pivotY;

    if (
        left < cellLeft ||
        top < cellTop ||
        left + frame.width > cellLeft + options.cellWidth ||
        top + frame.height > cellTop + options.cellHeight
    ) {
        fail(
            `Frame ${directionIndex}/${frameIndex} does not fit in its ` +
            `${options.cellWidth}x${options.cellHeight} cell. ` +
            `Calculated placement: ${left - cellLeft},${top - cellTop}, ` +
            `size ${frame.width}x${frame.height}.`,
        );
    }

    return {
        left,
        top,
    };
}

async function buildActionSheet(
    sprites,
    action,
    outputPath,
    options,
) {
    const composites = [];

    for (
        let directionIndex = 0;
        directionIndex < DIRECTION_COUNT;
        directionIndex++
    ) {
        const sprite =
            sprites[action.startSheet + directionIndex];

        for (
            let frameIndex = 0;
            frameIndex < FRAME_COUNT;
            frameIndex++
        ) {
            const frame = sprite.frames[frameIndex];

            const placement = calculateFramePlacement(
                frame,
                directionIndex,
                frameIndex,
                options,
            );

            const frameBuffer =
                await extractFrameBuffer(sprite, frame);

            composites.push({
                input: frameBuffer,
                left: placement.left,
                top: placement.top,
            });
        }
    }

    const sheetWidth =
        options.cellWidth * FRAME_COUNT;

    const sheetHeight =
        options.cellHeight * DIRECTION_COUNT;

    await sharp({
        create: {
            width: sheetWidth,
            height: sheetHeight,
            channels: 4,
            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0,
            },
        },
    })
        .composite(composites)
        .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
        })
        .toFile(outputPath);
}

function writeManifest(outputDirectory, sourceName, options) {
    const manifest = {
        version: 1,
        name: sourceName,
        cell: {
            width: options.cellWidth,
            height: options.cellHeight,
        },
        anchor: {
            x: options.anchorX,
            y: options.anchorY,
        },
    };

    const manifestPath = path.join(
        outputDirectory,
        'manifest.json',
    );

    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
    );

    return manifestPath;
}

async function main() {
    const parsedOptions = parseArguments(
        process.argv.slice(2),
    );

    const inputPath = path.resolve(
        parsedOptions.inputPath,
    );

    const outputDirectory = path.resolve(
        parsedOptions.outputDirectory,
    );

    validateSourceFile(inputPath);

    const sourceBuffer =
        fs.readFileSync(inputPath);

    const sprites =
        parseSpr(sourceBuffer);

    validateMonsterStructure(sprites);

    fs.mkdirSync(
        outputDirectory,
        { recursive: true },
    );

    const sourceName = path.basename(
        inputPath,
        path.extname(inputPath),
    );

    const options = {
        ...parsedOptions,
    };

    console.log(`Reading ${inputPath}`);
    console.log(`Found ${sprites.length} monster sprite sheets`);

    for (const action of ACTIONS) {
        const outputPath = path.join(
            outputDirectory,
            `${action.name}.png`,
        );

        await buildActionSheet(
            sprites,
            action,
            outputPath,
            options,
        );

        console.log(
            `Created ${action.name}.png`,
        );
    }

    const manifestPath = writeManifest(
        outputDirectory,
        sourceName,
        options,
    );

    console.log('');
    console.log('Monster action-sheet export complete:');
    console.log(
        `  Cell: ${options.cellWidth}x${options.cellHeight}`,
    );
    console.log(
        `  Anchor: ${options.anchorX},${options.anchorY}`,
    );
    console.log(
        `  Output: ${outputDirectory}`,
    );
    console.log(
        `  Manifest: ${manifestPath}`,
    );
}

main().catch((error) => {
    console.error('');
    console.error('Monster action-sheet export failed.');
    console.error(
        error instanceof Error
            ? error.stack
            : error,
    );

    process.exitCode = 1;
});