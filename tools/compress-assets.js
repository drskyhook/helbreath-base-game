#!/usr/bin/env node

/**
 * Asset compression script
 * Reads assets from a client Assets.ts and compresses them into that client's ZIP archive.
 * When run from a client directory (sp-client or multiplayer/mp-client), that client is used.
 * Otherwise, sp-client is used for backward compatibility. Use --client-dir to override.
 * 
 * Compression Level: Default is 1 (recommended for game assets)
 * - Game assets (MP3, binary sprites/maps) are already compressed or don't compress well
 * - Level 1: Fast compression, fast decompression, minimal size penalty (~3-5% vs level 9)
 * - Higher levels: Much slower compression/decompression, minimal size benefit
 * 
 * Usage: node compress-assets.js [--client-dir=DIR] [--ratio=N] [--output=filename.zip] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { zipSync } = require('fflate');

function resolveDefaultClientDir() {
    const cwdAssetsPath = path.join(process.cwd(), 'src', 'constants', 'Assets.ts');
    if (fs.existsSync(cwdAssetsPath)) {
        return process.cwd();
    }

    // Backward-compatible default for direct `node tools/compress-assets.js` usage.
    return path.join(__dirname, '..', 'sp-client');
}

// Parse command line arguments
const args = process.argv.slice(2);
let clientDir = resolveDefaultClientDir();
let compressionRatio = 1; // Default compression level (0-9)
let outputFile = 'public/assets.zip';
let dryRun = false;

args.forEach(arg => {
    if (arg.startsWith('--ratio=')) {
        compressionRatio = parseInt(arg.split('=')[1], 10);
        if (isNaN(compressionRatio) || compressionRatio < 0 || compressionRatio > 9) {
            console.error('Compression ratio must be between 0 and 9');
            process.exit(1);
        }
    } else if (arg.startsWith('--output=')) {
        outputFile = arg.split('=')[1];
    } else if (arg.startsWith('--client-dir=')) {
        clientDir = path.resolve(arg.split('=')[1]);
    } else if (arg === '--dry-run') {
        dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
        console.log(`
Usage: node compress-assets.js [options]

Options:
  --client-dir=DIR
                Client directory containing src/constants/Assets.ts.
                Defaults to current working directory when it looks like a client,
                otherwise sp-client/ for backward compatibility.
  --ratio=N     Compression ratio (0-9, default: 1)
                Note: Higher ratios (6-9) provide minimal size benefit (~3-5%)
                      but significantly slower compression AND decompression.
                      Level 1 is recommended for best balance.
  --output=FILE Output ZIP file path relative to the selected client (default: public/assets.zip)
  --dry-run     Parse and scan files without writing a ZIP
  --help, -h    Show this help message

Example:
  node compress-assets.js --ratio=1 --output=public/game-assets.zip
`);
        process.exit(0);
    }
});

console.log(`Using client directory: ${clientDir}`);

// Parse the TypeScript files to extract ASSETS array, config flags, MONSTERS array, EFFECTS array, NPCS array, and SoundFileNames
const assetsPath = path.join(clientDir, 'src', 'constants', 'Assets.ts');
const configPath = path.join(clientDir, 'src', 'Config.ts');
const monstersPath = path.join(clientDir, 'src', 'constants', 'Monsters.ts');
const effectsPath = path.join(clientDir, 'src', 'constants', 'Effects.ts');
const npcsPath = path.join(clientDir, 'src', 'constants', 'NPCs.ts');
const itemsPath = path.join(clientDir, 'src', 'constants', 'Items.ts');
const soundFileNamesPath = path.join(clientDir, 'src', 'constants', 'SoundFileNames.ts');

if (!fs.existsSync(assetsPath)) {
    console.error(`Error: Could not find Assets.ts at ${assetsPath}`);
    process.exit(1);
}

if (!fs.existsSync(configPath)) {
    console.error(`Error: Could not find Config.ts at ${configPath}`);
    process.exit(1);
}

if (!fs.existsSync(monstersPath)) {
    console.error(`Error: Could not find Monsters.ts at ${monstersPath}`);
    process.exit(1);
}

if (!fs.existsSync(effectsPath)) {
    console.error(`Error: Could not find Effects.ts at ${effectsPath}`);
    process.exit(1);
}

if (!fs.existsSync(npcsPath)) {
    console.error(`Error: Could not find NPCs.ts at ${npcsPath}`);
    process.exit(1);
}

if (!fs.existsSync(itemsPath)) {
    console.error(`Error: Could not find Items.ts at ${itemsPath}`);
    process.exit(1);
}

if (!fs.existsSync(soundFileNamesPath)) {
    console.error(`Error: Could not find SoundFileNames.ts at ${soundFileNamesPath}`);
    process.exit(1);
}

const assetsContent = fs.readFileSync(assetsPath, 'utf-8');
const configContent = fs.readFileSync(configPath, 'utf-8');
const monstersContent = fs.readFileSync(monstersPath, 'utf-8');
const effectsContent = fs.readFileSync(effectsPath, 'utf-8');
const npcsContent = fs.readFileSync(npcsPath, 'utf-8');
const itemsContent = fs.readFileSync(itemsPath, 'utf-8');
const soundFileNamesContent = fs.readFileSync(soundFileNamesPath, 'utf-8');

const loadMonsterAssetsOnDemandMatch = configContent.match(/export const LOAD_MONSTER_ASSETS_ON_DEMAND\s*=\s*(true|false)/);
const loadMonsterAssetsOnDemand = loadMonsterAssetsOnDemandMatch?.[1] === 'true';
const loadMapAssetsOnDemandMatch = configContent.match(/export const LOAD_MAP_ASSETS_ON_DEMAND\s*=\s*(true|false)/);
const loadMapAssetsOnDemand = loadMapAssetsOnDemandMatch?.[1] === 'true';
const loadPlayerItemAppearanceAssetsOnDemandMatch = configContent.match(
    /export const LOAD_PLAYER_ITEM_APPEARANCE_ASSETS_ON_DEMAND\s*=\s*(true|false)/,
);
const loadPlayerItemAppearanceAssetsOnDemand = loadPlayerItemAppearanceAssetsOnDemandMatch?.[1] === 'true';
const placeholderSpriteMatch = configContent.match(/export const MONSTER_PLACEHOLDER_SPRITE\s*=\s*['"]([^'"]+)['"]/);
const monsterPlaceholderSprite = placeholderSpriteMatch?.[1] ?? 'ghk';

// Parse SoundFileNames.ts to resolve effect sound constants (e.g. EFFECT_EXPLOSION -> E4.mp3)
const soundConstantMap = {};
const soundConstMatches = soundFileNamesContent.matchAll(/export const (\w+)\s*=\s*['"]([^'"]+)['"]/g);
for (const match of soundConstMatches) {
    soundConstantMap[match[1]] = match[2];
}

// Extract the ASSETS array content (everything between [ and ];)
const assetsMatch = assetsContent.match(/export const ASSETS:\s*AssetData\[\]\s*=\s*\[([\s\S]*?)\];/);

if (!assetsMatch) {
    console.error('Could not find ASSETS array in Assets.ts');
    process.exit(1);
}

const arrayContent = assetsMatch[1];

// Extract the MONSTERS array content
const monstersMatch = monstersContent.match(/export const MONSTERS:\s*MonsterData\[\]\s*=\s*\[([\s\S]*?)\];/);

if (!monstersMatch) {
    console.error('Could not find MONSTERS array in Monsters.ts');
    process.exit(1);
}

const monstersArrayContent = monstersMatch[1];

// Extract the EFFECTS array content
const effectsMatch = effectsContent.match(/export const EFFECTS[^=]*=\s*\[([\s\S]*?)\];/);
const effectsArrayContent = effectsMatch ? effectsMatch[1] : '';

// Extract the NPC asset array content. Single-player uses NPCS objects; multiplayer uses NPC_SPRITE_NAMES strings.
const npcsMatch = npcsContent.match(/export const NPCS:\s*NPCData\[\]\s*=\s*\[([\s\S]*?)\];/);
const npcSpriteNamesMatch = npcsContent.match(/export const NPC_SPRITE_NAMES:\s*readonly string\[\]\s*=\s*\[([\s\S]*?)\];/);
const npcsArrayContent = npcsMatch ? npcsMatch[1] : '';
const npcSpriteNamesArrayContent = npcSpriteNamesMatch ? npcSpriteNamesMatch[1] : '';

// Extract the ITEMS array content
const itemsMatch = itemsContent.match(/export const ITEMS[^=]*=\s*\[([\s\S]*?)\];/);
const itemsArrayContent = itemsMatch ? itemsMatch[1] : '';

// Parse asset objects - handle both single-line and multi-line objects
// Match objects that contain key, fileName, and assetType properties
const assetEntries = [];
const lines = arrayContent.split('\n');

// Build objects by tracking braces
let currentObject = '';
let braceDepth = 0;
let inObject = false;

for (const line of lines) {
    // Skip comments
    if (line.trim().startsWith('//')) {
        continue;
    }
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const prevChar = i > 0 ? line[i - 1] : '';
        
        if (char === '{' && prevChar !== '\\') {
            if (!inObject) {
                inObject = true;
                currentObject = '';
            }
            braceDepth++;
            currentObject += char;
        } else if (char === '}' && prevChar !== '\\') {
            currentObject += char;
            braceDepth--;
            if (braceDepth === 0 && inObject) {
                // Complete object found
                // Extract key, fileName, and assetType
                const keyMatch = currentObject.match(/key:\s*['"]([^'"]+)['"]/);
                const fileNameMatch = currentObject.match(/fileName:\s*['"]([^'"]+)['"]/);
                const assetTypeMatch = currentObject.match(/assetType:\s*AssetType\.(\w+)/);
                
                if (keyMatch && fileNameMatch && assetTypeMatch) {
                    assetEntries.push({
                        key: keyMatch[1],
                        fileName: fileNameMatch[1],
                        assetType: assetTypeMatch[1]
                    });
                }
                
                currentObject = '';
                inObject = false;
            }
        } else if (inObject) {
            currentObject += char;
        }
    }
    
    // Add newline if we're building an object
    if (inObject && braceDepth > 0) {
        currentObject += '\n';
    }
}

if (assetEntries.length === 0) {
    console.error('Could not parse any assets from Assets.ts');
    console.error('Please ensure the file format is correct.');
    process.exit(1);
}

if (loadMapAssetsOnDemand) {
    const before = assetEntries.length;
    const filtered = assetEntries.filter((a) => a.assetType !== 'MAP' && a.assetType !== 'TILE_SPRITE');
    assetEntries.length = 0;
    filtered.forEach((a) => assetEntries.push(a));
    console.log(
        `Map on-demand assets: enabled (excluding ${before - assetEntries.length} map/tile files from zip; serve assets/maps and assets/sprites separately)`,
    );
}

// Parse MONSTERS array to extract sprite names and sounds
const monsterSprites = new Set();
const monsterSounds = new Set();

// Extract monster objects from MONSTERS array
const monsterObjects = [];
let currentMonsterObj = '';
let monsterBraceDepth = 0;
let inMonsterObject = false;

for (const line of monstersArrayContent.split('\n')) {
    // Skip comments
    if (line.trim().startsWith('//')) {
        continue;
    }
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const prevChar = i > 0 ? line[i - 1] : '';
        
        if (char === '{' && prevChar !== '\\') {
            if (!inMonsterObject) {
                inMonsterObject = true;
                currentMonsterObj = '';
            }
            monsterBraceDepth++;
            currentMonsterObj += char;
        } else if (char === '}' && prevChar !== '\\') {
            currentMonsterObj += char;
            monsterBraceDepth--;
            if (monsterBraceDepth === 0 && inMonsterObject) {
                // Complete monster object found
                monsterObjects.push(currentMonsterObj);
                currentMonsterObj = '';
                inMonsterObject = false;
            }
        } else if (inMonsterObject) {
            currentMonsterObj += char;
        }
    }
    
    if (inMonsterObject && monsterBraceDepth > 0) {
        currentMonsterObj += '\n';
    }
}

// Extract spriteName and sounds from each monster object
monsterObjects.forEach(monsterObj => {
    // Extract all spriteName occurrences (top-level and nested in animation overrides)
    const spriteNameMatches = monsterObj.matchAll(/spriteName:\s*['"]([^'"]+)['"]/g);
    for (const match of spriteNameMatches) {
        monsterSprites.add(match[1]);
    }
    
    // Extract sounds from states (move, attack, death, idle)
    const soundMatches = monsterObj.matchAll(/sound:\s*['"]([^'"]+)['"]/g);
    for (const match of soundMatches) {
        monsterSounds.add(match[1]);
    }
});

// Parse EFFECTS array to extract sprite names and sounds
const effectSprites = new Set();
const effectSounds = new Set();
if (effectsArrayContent) {
    const effectObjects = [];
    let currentEffectObj = '';
    let effectBraceDepth = 0;
    let inEffectObject = false;

    for (const line of effectsArrayContent.split('\n')) {
        if (line.trim().startsWith('//')) continue;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const prevChar = i > 0 ? line[i - 1] : '';

            if (char === '{' && prevChar !== '\\') {
                if (!inEffectObject) {
                    inEffectObject = true;
                    currentEffectObj = '';
                }
                effectBraceDepth++;
                currentEffectObj += char;
            } else if (char === '}' && prevChar !== '\\') {
                currentEffectObj += char;
                effectBraceDepth--;
                if (effectBraceDepth === 0 && inEffectObject) {
                    effectObjects.push(currentEffectObj);
                    currentEffectObj = '';
                    inEffectObject = false;
                }
            } else if (inEffectObject) {
                currentEffectObj += char;
            }
        }

        if (inEffectObject && effectBraceDepth > 0) {
            currentEffectObj += '\n';
        }
    }

    effectObjects.forEach(effectObj => {
        const spriteMatch = effectObj.match(/sprite:\s*['"]([^'"]+)['"]/);
        if (spriteMatch) effectSprites.add(spriteMatch[1]);

        // Match literal string: sound: 'E4.mp3' or sound: "E4.mp3"
        const soundLiteralMatch = effectObj.match(/sound:\s*['"]([^'"]+)['"]/);
        if (soundLiteralMatch) {
            effectSounds.add(soundLiteralMatch[1]);
        } else {
            // Match constant reference: sound: EFFECT_EXPLOSION (resolved via SoundFileNames.ts)
            const soundConstMatch = effectObj.match(/sound:\s*([A-Za-z_][A-Za-z0-9_]*)/);
            if (soundConstMatch && soundConstantMap[soundConstMatch[1]]) {
                effectSounds.add(soundConstantMap[soundConstMatch[1]]);
            }
        }
    });
}

// Parse NPCS/NPC_SPRITE_NAMES arrays to extract sprite names
const npcSprites = new Set();
if (npcsArrayContent) {
    const npcObjects = [];
    let currentNpcObj = '';
    let npcBraceDepth = 0;
    let inNpcObject = false;

    for (const line of npcsArrayContent.split('\n')) {
        if (line.trim().startsWith('//')) continue;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const prevChar = i > 0 ? line[i - 1] : '';

            if (char === '{' && prevChar !== '\\') {
                if (!inNpcObject) {
                    inNpcObject = true;
                    currentNpcObj = '';
                }
                npcBraceDepth++;
                currentNpcObj += char;
            } else if (char === '}' && prevChar !== '\\') {
                currentNpcObj += char;
                npcBraceDepth--;
                if (npcBraceDepth === 0 && inNpcObject) {
                    npcObjects.push(currentNpcObj);
                    currentNpcObj = '';
                    inNpcObject = false;
                }
            } else if (inNpcObject) {
                currentNpcObj += char;
            }
        }

        if (inNpcObject && npcBraceDepth > 0) {
            currentNpcObj += '\n';
        }
    }

    npcObjects.forEach(npcObj => {
        const spriteMatch = npcObj.match(/sprite:\s*['"]([^'"]+)['"]/);
        if (spriteMatch) npcSprites.add(spriteMatch[1]);
    });
}
if (npcSpriteNamesArrayContent) {
    const spriteMatches = npcSpriteNamesArrayContent.matchAll(/['"]([^'"]+)['"]/g);
    for (const match of spriteMatches) {
        npcSprites.add(match[1]);
    }
}

// Parse ITEMS array to extract equipped sprites and consumption sounds
const equippedSprites = new Set();
const consumptionSounds = new Set();
if (itemsArrayContent) {
    const equippedMaleMatches = itemsArrayContent.matchAll(/equippedSpriteMale:\s*['"]([^'"]+)['"]/g);
    for (const match of equippedMaleMatches) {
        equippedSprites.add(match[1]);
    }
    const equippedFemaleMatches = itemsArrayContent.matchAll(/equippedSpriteFemale:\s*['"]([^'"]+)['"]/g);
    for (const match of equippedFemaleMatches) {
        equippedSprites.add(match[1]);
    }
    const consumptionSoundMatches = itemsArrayContent.matchAll(/consumptionSound:\s*['"]([^'"]+)['"]/g);
    for (const match of consumptionSoundMatches) {
        consumptionSounds.add(match[1]);
    }
}

const bundledMonsterSprites = loadMonsterAssetsOnDemand
    ? new Set([...monsterSprites].filter((spriteName) => spriteName === monsterPlaceholderSprite))
    : monsterSprites;
const bundledMonsterSounds = loadMonsterAssetsOnDemand
    ? new Set(
        monsterObjects
            .filter((monsterObj) => monsterObj.match(/spriteName:\s*['"]([^'"]+)['"]/)?.[1] === monsterPlaceholderSprite)
            .flatMap((monsterObj) => [...monsterObj.matchAll(/sound:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))
    )
    : monsterSounds;

console.log(`Parsed ${assetEntries.length} base assets from Assets.ts`);
console.log(`Monster on-demand assets: ${loadMonsterAssetsOnDemand ? `enabled (bundling placeholder sprite "${monsterPlaceholderSprite}" and its sounds only)` : 'disabled (bundling all monster assets)'}`);
console.log(`Found ${monsterSprites.size} unique monster sprites from Monsters.ts (${bundledMonsterSprites.size} bundled)`);
console.log(`Found ${monsterSounds.size} unique monster sounds from Monsters.ts (${bundledMonsterSounds.size} bundled)`);
console.log(`Found ${effectSprites.size} unique effect sprites from Effects.ts`);
console.log(`Found ${effectSounds.size} unique effect sounds from Effects.ts`);
console.log(`Found ${npcSprites.size} unique NPC sprites from NPCs.ts`);
console.log(`Found ${equippedSprites.size} unique equipped sprites from Items.ts`);
console.log(`Found ${consumptionSounds.size} unique consumption sounds from Items.ts`);
if (loadPlayerItemAppearanceAssetsOnDemand) {
    console.log(
        'Player item appearance on-demand: enabled (equipped item .spr files excluded from zip for this client Config)',
    );
}

// Add monster sprites to asset entries (with .spr extension)
bundledMonsterSprites.forEach(spriteName => {
    assetEntries.push({
        key: `sprite-${spriteName}`,
        fileName: `${spriteName}.spr`,
        assetType: 'SPRITE'
    });
});

// Add monster sounds to asset entries
bundledMonsterSounds.forEach(soundFile => {
    // Extract key from filename (e.g., 'M91.mp3' -> 'M91')
    const key = soundFile.replace('.mp3', '');
    assetEntries.push({
        key: key,
        fileName: soundFile,
        assetType: 'SOUND'
    });
});

// Add effect sprites to asset entries
effectSprites.forEach(spriteName => {
    assetEntries.push({
        key: `sprite-${spriteName}`,
        fileName: `${spriteName}.spr`,
        assetType: 'SPRITE'
    });
});

// Add effect sounds to asset entries
effectSounds.forEach(soundFile => {
    const key = soundFile.replace('.mp3', '');
    assetEntries.push({
        key: key,
        fileName: soundFile,
        assetType: 'SOUND'
    });
});

// Add NPC sprites to asset entries (with .spr extension)
npcSprites.forEach(spriteName => {
    assetEntries.push({
        key: `sprite-${spriteName}`,
        fileName: `${spriteName}.spr`,
        assetType: 'SPRITE'
    });
});

// Add equipped sprites from Items.ts (skip if already in assetEntries)
if (!loadPlayerItemAppearanceAssetsOnDemand) {
    equippedSprites.forEach(spriteName => {
        if (!assetEntries.some(a => a.key === `sprite-${spriteName}`)) {
            assetEntries.push({
                key: `sprite-${spriteName}`,
                fileName: `${spriteName}.spr`,
                assetType: 'SPRITE'
            });
        }
    });
} else {
    const before = assetEntries.length;
    const filtered = assetEntries.filter((a) => {
        if (a.assetType !== 'SPRITE' || !a.key.startsWith('sprite-')) {
            return true;
        }
        const basename = a.key.slice('sprite-'.length);
        return !equippedSprites.has(basename);
    });
    assetEntries.length = 0;
    filtered.forEach((a) => assetEntries.push(a));
    console.log(
        `Player item appearance on-demand: removed ${before - assetEntries.length} equipped item sprite entries from zip list`,
    );
}

// Add consumption sounds from Items.ts (skip if already in assetEntries)
consumptionSounds.forEach(soundKey => {
    if (!assetEntries.some(a => a.key === soundKey && a.assetType === 'SOUND')) {
        assetEntries.push({
            key: soundKey,
            fileName: `${soundKey}.mp3`,
            assetType: 'SOUND'
        });
    }
});

const ASSETS = assetEntries;
console.log(`Total assets (including monsters, effects, NPCs): ${ASSETS.length}`);

// Map asset types to folder names (based on LoadingScreen.ts logic)
function getAssetFolder(assetType) {
    switch (assetType) {
        case 'MAP':
            return 'maps';
        case 'TILE_SPRITE':
        case 'SPRITE':
            return 'sprites';
        case 'MUSIC':
            return 'music';
        case 'SOUND':
            return 'sounds';
        default:
            throw new Error(`Unknown asset type: ${assetType}`);
    }
}

// Build file map: zipPath -> filePath
const filesToCompress = {};
const assetsBasePath = path.join(clientDir, 'public', 'assets');
let filesFound = 0;
let filesMissing = 0;
const missingFiles = [];

console.log('Scanning assets...');

ASSETS.forEach(asset => {
    const folder = getAssetFolder(asset.assetType);
    const filePath = path.join(assetsBasePath, folder, asset.fileName);
    const zipPath = `assets/${folder}/${asset.fileName}`;
    
    if (fs.existsSync(filePath)) {
        filesToCompress[zipPath] = filePath;
        filesFound++;
    } else {
        filesMissing++;
        missingFiles.push(zipPath);
        console.warn(`Warning: File not found: ${filePath}`);
    }
});

console.log(`Found ${filesFound} files, ${filesMissing} missing`);

if (filesMissing > 0) {
    console.log('\nMissing files:');
    missingFiles.forEach(file => console.log(`  - ${file}`));
    console.log('\nContinuing with available files...\n');
}

if (Object.keys(filesToCompress).length === 0) {
    console.error('No files to compress!');
    process.exit(1);
}

if (dryRun) {
    console.log('\nDry run enabled; ZIP file was not written.');
    process.exit(0);
}

// Read all files and prepare for compression
console.log('Reading files...');
const fileData = {};
let totalSize = 0;

for (const [zipPath, filePath] of Object.entries(filesToCompress)) {
    try {
        const buffer = fs.readFileSync(filePath);
        // Convert Buffer to Uint8Array for fflate
        fileData[zipPath] = new Uint8Array(buffer);
        totalSize += buffer.length;
        process.stdout.write(`\rRead ${Object.keys(fileData).length}/${Object.keys(filesToCompress).length} files...`);
    } catch (error) {
        console.error(`\nError reading ${filePath}:`, error.message);
    }
}

console.log(`\nTotal size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

// Compress files
console.log(`Compressing with ratio ${compressionRatio}...`);
const zipOptions = {
    level: compressionRatio, // Compression level 0-9
};

const zipped = zipSync(fileData, zipOptions);
const compressedSize = zipped.length;

console.log(`Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Compression ratio: ${((1 - compressedSize / totalSize) * 100).toFixed(1)}%`);

// Write ZIP file (output path is relative to the selected client)
const outputPath = path.join(clientDir, outputFile);
if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
    console.log(`Deleted existing ZIP: ${outputFile}`);
}
fs.writeFileSync(outputPath, zipped);

console.log(`\n✓ Successfully created: ${outputFile}`);
console.log(`  Location: ${outputPath}`);
