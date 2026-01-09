# Voice Recognition Models

This directory contains AI models for voice recognition features:

## Models Used

### Whisper (Speech-to-Text)
- **Location**: `public/models/whisper-tiny/`
- **Size**: ~42MB
- **Purpose**: Offline speech recognition
- **Models available**: tiny, base, small

### OpenWakeWord (Wake Word Detection)
- **Location**: `public/openwakeword/`
- **Size**: ~58MB
- **Purpose**: Wake word detection (e.g., "Hey Jarvis")

## Automatic Download

**Models are downloaded automatically on first use.** You don't need to manually download them.

The application will:
1. Detect missing models on first voice input usage
2. Download models from HuggingFace/CDN
3. Cache them in the browser for offline use
4. Store them in these directories for future use

## Manual Setup (Optional)

If you want to pre-download models:

1. The models will be fetched from:
   - Whisper: HuggingFace transformers.js models
   - OpenWakeWord: npm package assets

2. On first run, the app downloads and stores them locally

## Storage Location

- **Browser Cache**: Models are cached in IndexedDB
- **Local Files**: Served from `public/` directory

## Size Information

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| Whisper Tiny | ~40MB | Fastest | Good |
| Whisper Base | ~75MB | Balanced | Better |
| Whisper Small | ~150MB | Slower | Best |

## Note

⚠️ These model files are **NOT** committed to git due to their large size.
They are downloaded automatically when the voice features are first used.
