# Asset Loading System

This project supports two methods for loading game assets:

## 1. ZIP-based Loading

Assets are bundled into a single `assets.zip` file for faster loading, especially over slow network connections.

ZIP loading is controlled by `ENABLE_ZIP_LOADING` in `src/Config.ts`. When it is `true`, the loading scene reads `public/assets.zip`; when it is `false`, assets are loaded individually from `public/assets/`.

**Performance optimization:** Audio files remain MP3s in the archive and are decoded in parallel during ZIP registration.

### How to use:

1. **Generate the assets.zip file:**
   ```bash
   pnpm compress-assets
   ```

   This will:
   - Delete the existing `public/assets.zip` if it exists
   - Compress the selected client's assets (including MP3 audio as-is) into `public/assets.zip`
   - Use compression level 1 (recommended)

   **Note on Compression Levels:**
   - Game assets (MP3s, binary sprites/maps) are already compressed or don't compress well
   - Higher levels (6-9) only save ~3-5% file size
   - BUT cause significantly slower decompression in the browser
   - **Level 1 is recommended** for best balance (fast decompress, minimal size penalty)

   Optional: Try different compression levels:
   ```bash
   npm run compress-assets:fast   # Level 1 (recommended)
   npm run compress-assets:best   # Level 9 (slower decompress, ~3-5% smaller)
   node compress-assets.js --ratio=3  # Custom level
   ```

2. **Run the game normally:**
   ```bash
   npm run dev
   ```

If `ENABLE_ZIP_LOADING` is `true`, the game will automatically load from `assets.zip` located in the `public/` folder.

### How it works:
- **0-25%**: Fetching `assets.zip` with streaming progress
- **25-50%**: Decompressing files with per-file progress tracking
- **50-100%**: Processing sprites and maps

### Benefits:
- **Fewer HTTP requests** (1 instead of 150+)
- **Better compression** across all assets
- **Faster loading** on slow connections
- **Small file sizes** (MP3 compression)
- **Parallel audio decode** during ZIP registration
- **Automatic fallback** to traditional loading on error

### How it Works:

**Build time (compress-assets.js):**
1. Selects the client from the current working directory, or from `--client-dir=...`
2. Reads `src/constants/Assets.ts` and related asset catalogs
3. Reads `src/Config.ts` to honor asset-loading flags
4. Compresses the selected assets into a single zip file (level 1 - fast compression/decompression)

For `multiplayer/mp-client`, when `LOAD_MONSTER_ASSETS_ON_DEMAND` is `true`, the ZIP intentionally includes only the placeholder monster sprite and its sounds. Other monster sprites and sounds are fetched later as monsters enter view. When on-demand monster loading is `false`, all monster assets are bundled.

**Runtime (LoadingScreen.ts):**
1. Downloads zip file with streaming progress (0-25%)
2. Decompresses with fflate (25-35%) - very fast at level 1
3. Decodes audio in parallel using Web Audio API (35-50%)
4. Processes sprites and maps (50-100%)

## 2. Traditional Loading (Backward Compatible)

Load assets individually, one file at a time. Useful for development, debugging, or when ZIP loading is not suitable.

**When to use per-file loading:**
- **Local development:** Set `ENABLE_ZIP_LOADING` to `false` in `src/Config.ts` to disable ZIP loading. This can be faster for iteration because there is no decompression step and changed files are read directly.
- **CDN limitations:** Some CDNs don't support large files (e.g. multi-megabyte `assets.zip`). In those cases, per-file loading must be used.

### How to use:

Set `ENABLE_ZIP_LOADING` to `false` in `src/Config.ts`.

### How it works:
- Each asset is loaded individually via HTTP request
- Progress tracked per-file through Phaser's loader
- Same as the original loading method

## Automatic Fallback

If ZIP loading fails for any reason (missing file, corrupt archive, etc.), the system will automatically:
1. Log the error to console
2. Switch to traditional loading mode
3. Restart the loading scene
4. Continue loading normally

## Performance Notes

### Audio Loading Performance:

**ZIP-based loading:**
- Audio files are stored as MP3s in `assets.zip`
- After decompression, audio files are decoded through the Web Audio API in parallel
- File size: Small (MP3 compression)

**Traditional loading:**
- Phaser loads audio files directly from `public/assets/sounds` and `public/assets/music`
- Useful during development when avoiding ZIP decompression is more convenient

## Troubleshooting

### "Missing files in assets.zip" error:

This means some assets in `Assets.ts` are not present in `public/assets/`. Check:
1. All required files exist in their respective folders (`public/assets/maps/`, `public/assets/sprites/`, etc.)
2. Filenames match exactly (case-sensitive)
3. Run `npm run compress-assets` to regenerate the zip

The error will list which files are missing.

### ZIP file not found:

Make sure `public/assets.zip` exists. If not, run:
```bash
npm run compress-assets
```

### Slow loading during development:

For faster iteration during development, set `ENABLE_ZIP_LOADING` to `false` in `src/Config.ts`.

Or use fast compression when regenerating the zip:
```bash
npm run compress-assets:fast
```
