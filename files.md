# File Map

## Read First (참조 전용 — 수정 금지)
- `src/adapters/LiteRTLMAdapter.ts`          ← 현재 단일 모델 구현 전체 파악
- `src/screens/ChatRoomScreen.tsx`            ← isSettling/hasReceivedFirstToken 위치 파악
- `android/app/src/main/java/.../LiteRTModule.kt`  ← 네이티브 메서드 시그니처 확인
- `ios/.../LiteRTSwiftEngine.swift`           ← 네이티브 메서드 시그니처 확인
- `src/navigation/RootNavigator.tsx`          ← 라우트 파라미터 타입 구조 파악

## Allowed to Edit (수정 허용)
- `src/adapters/LiteRTLMAdapter.ts`           ← 전면 리팩토링
- `src/screens/ChatRoomScreen.tsx`            ← 최소 패치 (3개 변경점만)

## Create New (신규 생성)
- `src/screens/ModelGalleryScreen.tsx`        ← 전체 신규 작성
- `src/types/models.ts`                       ← ModelId, ModelDownloadState,
                                                 ModelCatalogEntry 타입 정의

## Do Not Edit (절대 수정 금지)
- `android/app/src/main/java/.../LiteRTModule.kt`
- `ios/.../LiteRTSwiftEngine.swift`
- `src/navigation/RootNavigator.tsx`
- `package.json`, `tsconfig.json`
- 위 목록 외 모든 파일