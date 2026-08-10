# Architecture Rules (위반 시 즉시 재작성)

## R-01: Crash Prevention Logic — IMMUTABLE
ChatRoomScreen 내의 다음 두 가지 안정성 로직은 어떤 이유로도 수정하지 않는다.

- Soft Stop (isSettling):
  네이티브 생성 중단 후 `onGenerationSettled` 이벤트 수신 전까지
  `isSettling = true` 상태를 유지하며 모든 입력을 차단하는 로직.
  이것을 제거하거나 우회하면 네이티브 BUSY 에러가 발생한다.

- Deferred Interrupt (hasReceivedFirstToken):
  Prefill 구간에서 interruptGeneration()을 즉시 호출하면 SIGSEGV 크래시가
  발생하므로, 첫 토큰(TTFT) 수신 후 Decode 구간에서 정지를 실행하는
  지연 처리 로직. 절대 즉시 호출 방식으로 변경하지 않는다.

## R-02: Singleton Identity
`getLiteRTAdapter()`가 반환하는 인스턴스는 앱 전역에서 동일 참조이어야 한다.
new LiteRTLMAdapter()를 Screen 내부에서 직접 호출하지 않는다.

## R-03: One Model Loaded at a Time
네이티브 레이어는 동시에 하나의 모델만 메모리에 올릴 수 있다.
`loadModel(id)` 호출 시 `loadedModelId !== null && loadedModelId !== id`이면
반드시 `LiteRTModule.unloadModel()`을 먼저 await한 후 새 모델을 로드한다.

## R-04: Listener Isolation
`listenersMap`은 `Map<ModelId, Set<Listener>>` 구조를 유지한다.
모델 A의 상태 변경이 모델 B의 리스너를 트리거해서는 안 된다.
`_setDownloadState(id, state)`는 `listenersMap.get(id)`의 Set만 순회한다.

## R-05: Free Space Safety Margin
`checkFreeSpace(requiredBytes)` 구현 시 `freeSpace > requiredBytes * 1.1`
(10% 안전 마진)을 기준으로 검증한다.
`RNFS.getFSInfo()` 호출 실패 시 `true`를 반환하여 다운로드를 진행시킨다
(OS 레벨에서 최종 차단되므로 앱 레벨 블로킹 불필요).

## R-06: Partial Download Cleanup
`downloadModel(id)` 실패 시 `RNFS.exists(path)` 확인 후 부분 파일을
`RNFS.unlink(path)`로 삭제하고 상태를 `error`로 설정한다.

## R-07: No External UI Libraries
ModelGalleryScreen은 `react-native`의 기본 컴포넌트와 `StyleSheet`만 사용한다.
`react-native-paper`, `@rneui/themed`, `native-base` 등 사용 금지.

## R-08: TypeScript Strict
모든 신규/수정 코드는 TypeScript strict 모드를 통과해야 한다.
`any` 타입 사용은 NativeModules 바인딩 부분에만 허용한다.

## R-09: Startup State Sync
Adapter 생성자에서 `MODEL_CATALOG`의 모든 모델 경로를 비동기로 확인한다.
이미 다운로드된 파일이 있으면 해당 상태를 `ready`로 초기화한다.
이 비동기 작업은 생성자에서 `void` 형태로 호출하되 throw하지 않는다.

## R-10: ChatRoomScreen Change Scope
ChatRoomScreen에서 수정하는 코드는 정확히 다음 3곳으로 제한한다:
  1. route.params에서 modelId 읽기
  2. onLoadStateChange → onDownloadStateChange(modelId, cb) 교체
  3. init/getIsLoaded/waitForReady 호출부에 modelId 인자 추가
그 외 어떤 라인도 변경하지 않는다.