# Task: Single-to-Multi Model Architecture Migration

## Objective
Refactor a React Native on-device AI app from supporting a single hardcoded
model (Gemma 4 E4B) to a multi-model gallery architecture supporting
Gemma 4 E2B and Gemma 4 E4B, following Google AI Edge Gallery UX patterns.

## Goals
1. Refactor `LiteRTLMAdapter.ts`
   - Replace scalar state fields (`isLoaded`, `isDownloaded`) with
     `Map<ModelId, ModelDownloadState>` and `Map<ModelId, Set<Listener>>`.
   - Add `downloadModel(id)`, `loadModel(id)`, `checkFreeSpace(bytes)`,
     `getDownloadState(id)`, `onDownloadStateChange(id, fn)`,
     `getIsLoaded(id)`, `waitForReady(id)` as the new public API.
   - Keep `getLiteRTAdapter()` singleton factory unchanged.
   - On construction, async-check all model files and sync state to `ready`
     for any already-downloaded files.

2. Create `ModelGalleryScreen.tsx` (new file)
   - FlatList rendering MODEL_CATALOG (E2B, E4B entries).
   - Per-card state: not_downloaded → [Download + size], downloading →
     [ProgressBar %], ready → [Update + Try it].
   - On Download: call `adapter.checkFreeSpace(sizeBytes)` first.
     If false → Alert and abort. If true → `adapter.downloadModel(id)`.
   - On Try it: `navigation.navigate('ChatRoom', { modelId: id })`.
   - Subscribe to all model IDs on mount; unsubscribe all on unmount.
   - Use only RN core StyleSheet (no external UI libraries).
   - Dark theme: background #0F172A, card #1E293B, primary accent #4F46E5.

3. Patch `ChatRoomScreen.tsx` (minimal changes only)
   - Read `modelId` from `route.params`.
   - Replace `adapter.onLoadStateChange(cb)` with
     `adapter.onDownloadStateChange(modelId, cb)`.
   - Replace `adapter.init({ id: 'litert-gemma-4-e4b', ... })` with
     `adapter.loadModel(modelId)`.
   - Replace `adapter.getIsLoaded()` with `adapter.getIsLoaded(modelId)`.
   - Replace `adapter.waitForReady()` with `adapter.waitForReady(modelId)`.

## Not Goals (절대 건드리지 말 것)
- `isSettling` state and all logic gated on it in ChatRoomScreen.
- `hasReceivedFirstToken` ref and deferred-interrupt logic in ChatRoomScreen.
- `editable={!isGenerating && !isSettling}` on TextInput.
- The streaming response handling loop in `sendMessage()`.
- All native bridge files: `LiteRTModule.kt`, `LiteRTSwiftEngine.swift`.
- Navigation stack definition files.
- Any file not listed in `files.md` → Allowed to Edit.