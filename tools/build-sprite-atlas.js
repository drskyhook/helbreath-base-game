#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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
    { name: 'idle', loop: true },
    { name: 'move', loop: true },
    { name: 'attack', loop: false },
    { name: 'take-damage', loop: false },
    { name: 'death', loop: false },
];

const DIRECTION_COUNT = DIRECTIONS.length;
const FRAME_COUNT = 8;

function fail(message) {
    throw new Error(message);
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function readManifest(manifestPath) {
    if (!fs.existsSync(manifestPath)) {
        fail(`Manifest does not exist: ${manifestPath}`);
    }

    const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf8'),
    );

    if (manifest.version !== 1) {
        fail(
            `Unsupported authoring manifest version: ${manifest.version}`,
        );
    }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name ?? '')) {
        fail(
            'Manifest name must use lowercase letters, numbers, and hyphens',
        );
    }

    if (
        !isPositiveInteger(manifest.cell?.width) ||
        !isPositiveInteger(manifest.cell?.height)
    ) {
        fail(
            'Manifest cell must contain positive integer width and height values',
        );
    }

    validateAnchor(
        manifest.anchor,
        manifest.cell,
    );

    return manifest;
}

function validateAnchor(anchor, cell) {
    if (
        !Number.isInteger(anchor?.x) ||
        !Number.isInteger(anchor?.y)
    ) {
        fail(
            'Manifest anchor must contain integer x and y pixel coordinates',
        );
    }

    if (
        anchor.x < 0 ||
        anchor.x > cell.width ||
        anchor.y < 0 ||
        anchor.y > cell.height
    ) {
        fail(
            'Manifest anchor must be located within one source cell',
        );
    }
}

function resolveInside(root, ...segments) {
    const resolvedRoot = path.resolve(root);
    const resolvedPath = path.resolve(
        resolvedRoot,
        ...segments,
    );

    if (
        resolvedPath !== resolvedRoot &&
        !resolvedPath.startsWith(
            `${resolvedRoot}${path.sep}`,
        )
    ) {
        fail(
            `Path escapes source directory: ${resolvedPath}`,
        );
    }

    return resolvedPath;
}

async function validateActionSheet(
    filePath,
    actionName,
    cell,
) {
    if (!fs.existsSync(filePath)) {
        fail(
            `Missing required action sheet '${actionName}': ${filePath}`,
        );
    }

    if (!fs.statSync(filePath).isFile()) {
        fail(
            `Action sheet is not a file: ${filePath}`,
        );
    }

    const metadata = await sharp(filePath).metadata();

    const expectedWidth =
        cell.width * FRAME_COUNT;

    const expectedHeight =
        cell.height * DIRECTION_COUNT;

    if (
        metadata.width !== expectedWidth ||
        metadata.height !== expectedHeight
    ) {
        fail(
            `Action sheet '${actionName}' must be ` +
            `${expectedWidth}x${expectedHeight}. ` +
            `Received ${metadata.width}x${metadata.height}.`,
        );
    }
}

async function extractCellFrame(
    sheetPath,
    cell,
    directionIndex,
    frameIndex,
    anchor,
) {
    const cellLeft =
        frameIndex * cell.width;

    const cellTop =
        directionIndex * cell.height;

    const cellImage = sharp(sheetPath)
        .extract({
            left: cellLeft,
            top: cellTop,
            width: cell.width,
            height: cell.height,
        })
        .ensureAlpha();

    const {
        data,
        info,
    } = await cellImage
        .clone()
        .raw()
        .toBuffer({
            resolveWithObject: true,
        });

    let trimLeft = info.width;
    let trimTop = info.height;
    let trimRight = -1;
    let trimBottom = -1;

    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const alphaIndex =
                (y * info.width + x) * 4 + 3;

            if (data[alphaIndex] === 0) {
                continue;
            }

            trimLeft = Math.min(trimLeft, x);
            trimTop = Math.min(trimTop, y);
            trimRight = Math.max(trimRight, x);
            trimBottom = Math.max(trimBottom, y);
        }
    }

    if (
        trimRight < trimLeft ||
        trimBottom < trimTop
    ) {
        fail(
            `Fully transparent frame in ${sheetPath}: ` +
            `direction ${directionIndex}, frame ${frameIndex}`,
        );
    }

    const trimmedWidth =
        trimRight - trimLeft + 1;

    const trimmedHeight =
        trimBottom - trimTop + 1;

    const pngBuffer = await cellImage
        .clone()
        .extract({
            left: trimLeft,
            top: trimTop,
            width: trimmedWidth,
            height: trimmedHeight,
        })
        .png()
        .toBuffer();

    return {
        width: trimmedWidth,
        height: trimmedHeight,

        // Offset of the trimmed image relative to the shared
        // ground anchor inside the original fixed-size cell.
        pivotX: trimLeft - anchor.x,
        pivotY: trimTop - anchor.y,

        pngBuffer,
    };
}

async function collectFrames(
    manifest,
    sourceRoot,
) {
    const frames = [];
    const animations = {};

    for (const action of ACTIONS) {
        const sheetPath = resolveInside(
            sourceRoot,
            `${action.name}.png`,
        );

        await validateActionSheet(
            sheetPath,
            action.name,
            manifest.cell,
        );

        for (
            let directionIndex = 0;
            directionIndex < DIRECTION_COUNT;
            directionIndex++
        ) {
            const direction =
                DIRECTIONS[directionIndex];

            const animationName =
                `${action.name}-${direction}`;

            const animationFrames = [];

            for (
                let frameIndex = 0;
                frameIndex < FRAME_COUNT;
                frameIndex++
            ) {
                const frameName =
                    `${animationName}-frame-${frameIndex}`;

                const extracted =
                    await extractCellFrame(
                        sheetPath,
                        manifest.cell,
                        directionIndex,
                        frameIndex,
                        manifest.anchor,
                    );

                frames.push({
                    frameName,
                    ...extracted,
                });

                animationFrames.push(
                    frameName,
                );
            }

            animations[animationName] = {
                frames: animationFrames,
                loop: action.loop,
            };
        }
    }

    return {
        frames,
        animations,
    };
}

function calculatePlacements(
    frames,
    maxAtlasWidth,
    padding,
) {
    const placements = [];

    let cursorX = padding;
    let cursorY = padding;
    let rowHeight = 0;
    let usedWidth = 0;

    for (const frame of frames) {
        if (
            frame.width + padding * 2 >
            maxAtlasWidth
        ) {
            fail(
                `Frame '${frame.frameName}' exceeds maximum atlas width`,
            );
        }

        if (
            cursorX > padding &&
            cursorX + frame.width + padding >
            maxAtlasWidth
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

        cursorX +=
            frame.width + padding;

        rowHeight = Math.max(
            rowHeight,
            frame.height,
        );

        usedWidth = Math.max(
            usedWidth,
            cursorX,
        );
    }

    return {
        placements,
        atlasWidth: Math.max(
            1,
            usedWidth,
        ),
        atlasHeight: Math.max(
            1,
            cursorY + rowHeight + padding,
        ),
    };
}

async function writeAtlas(
    placements,
    width,
    height,
    outputPath,
) {
    const composites = placements.map(
        (placement) => ({
            input: placement.pngBuffer,
            left: placement.atlasX,
            top: placement.atlasY,
        }),
    );

    await sharp({
        create: {
            width,
            height,
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

function buildRuntimeDefinition(
    imageName,
    placements,
    animations,
) {
    const frames = {};

    for (const placement of placements) {
        frames[placement.frameName] = {
            x: placement.atlasX,
            y: placement.atlasY,
            width: placement.width,
            height: placement.height,
            pivotX: placement.pivotX,
            pivotY: placement.pivotY,
        };
    }

    return {
        version: 1,
        image: imageName,
        frames,
        animations,
    };
}

function parseArguments(args) {
    const positional = [];

    let maxAtlasWidth = 2048;
    let padding = 1;

    for (
        let index = 0;
        index < args.length;
        index++
    ) {
        const argument = args[index];

        if (argument === '--max-width') {
            maxAtlasWidth = Number(
                args[++index],
            );
        } else if (argument === '--padding') {
            padding = Number(
                args[++index],
            );
        } else {
            positional.push(argument);
        }
    }

    if (positional.length !== 2) {
        fail(
            'Usage: node build-sprite-atlas.js ' +
            '<manifest.json> <output-directory> ' +
            '[--max-width 2048] [--padding 1]',
        );
    }

    if (
        !Number.isInteger(maxAtlasWidth) ||
        maxAtlasWidth < 1
    ) {
        fail(
            '--max-width must be a positive integer',
        );
    }

    if (
        !Number.isInteger(padding) ||
        padding < 0
    ) {
        fail(
            '--padding must be a non-negative integer',
        );
    }

    return {
        manifestPath: positional[0],
        outputDirectory: positional[1],
        maxAtlasWidth,
        padding,
    };
}

async function main() {
    const options = parseArguments(
        process.argv.slice(2),
    );

    const manifestPath = path.resolve(
        options.manifestPath,
    );

    const outputDirectory = path.resolve(
        options.outputDirectory,
    );

    const sourceRoot = path.dirname(
        manifestPath,
    );

    const manifest = readManifest(
        manifestPath,
    );

    const {
        frames,
        animations,
    } = await collectFrames(
        manifest,
        sourceRoot,
    );

    const packed = calculatePlacements(
        frames,
        options.maxAtlasWidth,
        options.padding,
    );

    fs.mkdirSync(
        outputDirectory,
        { recursive: true },
    );

    const imageName =
        `${manifest.name}.png`;

    const jsonName =
        `${manifest.name}.json`;

    const imagePath = path.join(
        outputDirectory,
        imageName,
    );

    const jsonPath = path.join(
        outputDirectory,
        jsonName,
    );

    await writeAtlas(
        packed.placements,
        packed.atlasWidth,
        packed.atlasHeight,
        imagePath,
    );

    const definition =
        buildRuntimeDefinition(
            imageName,
            packed.placements,
            animations,
        );

    fs.writeFileSync(
        jsonPath,
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
    );

    console.log(
        `Built ${manifest.name}:`,
    );

    console.log(
        `  Source sheets: ${ACTIONS.length}`,
    );

    console.log(
        `  Directions: ${DIRECTION_COUNT}`,
    );

    console.log(
        `  Frames per animation: ${FRAME_COUNT}`,
    );

    console.log(
        `  Total frames: ${frames.length}`,
    );

    console.log(
        `  Animations: ${Object.keys(animations).length}`,
    );

    console.log(
        `  Cell: ` +
        `${manifest.cell.width}x${manifest.cell.height}`,
    );

    console.log(
        `  Anchor: ` +
        `${manifest.anchor.x},${manifest.anchor.y}`,
    );

    console.log(
        `  Atlas: ` +
        `${packed.atlasWidth}x${packed.atlasHeight}`,
    );

    console.log(
        `  PNG: ${imagePath}`,
    );

    console.log(
        `  JSON: ${jsonPath}`,
    );
}

main().catch((error) => {
    console.error(
        error instanceof Error
            ? error.stack
            : error,
    );

    process.exitCode = 1;
});