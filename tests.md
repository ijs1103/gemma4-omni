# Self-Verification Checklist

코드 작성 완료 후 아래 항목을 순서대로 직접 검토하고, 각 항목 옆에
[PASS] 또는 [FAIL + 이유]를 표기하여 done.md에 포함시켜라.

## T-01: Type Safety
- [ ] `ModelId`가 string literal union으로 정의되어 있는가?
- [ ] `ModelDownloadState.status`가 5개 값으로 완전히 열거되어 있는가?
- [ ] `ModelCatalogEntry`에 `sizeBytes`와 `sizeLabel`이 모두 존재하는가?

## T-02: Adapter State Isolation
- [ ] E2B 다운로드 progress 업데이트가 E4B 리스너를 트리거하지 않는가?
- [ ] `_setDownloadState('gemma-4-e2b-it', state)`가 E4B Set을 순회하지 않는가?
- [ ] `loadedModelId`가 단일 변수로 두 모델 중 하나만 가리키는가?

## T-03: Model Swap Safety (R-03 검증)
- [ ] E4B가 이미 로드된 상태에서 E2B loadModel() 호출 시
      unloadModel()이 먼저 await되는가?
- [ ] unloadModel() 이후 loadedModelId가 null로 초기화되는가?

## T-04: Free Space Check (R-05 검증)
- [ ] sizeBytes * 1.1 기준으로 freeSpace와 비교하는가?
- [ ] getFSInfo() 예외 발생 시 true를 반환하여 다운로드를 허용하는가?
- [ ] 용량 부족 시 Alert.alert()가 호출되고 downloadModel()이 호출되지 않는가?

## T-05: Partial File Cleanup (R-06 검증)
- [ ] downloadFile() reject 시 catch 블록에서 RNFS.exists() 확인 후
      unlink()를 호출하는가?
- [ ] 이후 상태가 { status: 'error' }로 설정되는가?

## T-06: Listener Lifecycle
- [ ] ModelGalleryScreen 언마운트 시 MODEL_CATALOG 크기만큼의 unsubscribe가
      호출되는가? (예: 2개 모델 → 2개 unsubscribe)
- [ ] ChatRoomScreen 언마운트 시 해당 modelId의 unsubscribe만 호출되는가?

## T-07: Navigation Contract
- [ ] Try it 버튼이 `navigation.navigate('ChatRoom', { modelId: id })`를
      호출하는가?
- [ ] ChatRoomScreen에서 `route.params.modelId`가 올바른 타입으로 읽히는가?

## T-08: Startup Sync (R-09 검증)
- [ ] Adapter 생성자에서 각 모델 파일 존재 여부를 확인하는가?
- [ ] 파일이 존재하면 { status: 'ready' }로 초기화하는가?
- [ ] 이 비동기 로직이 생성자에서 void로 호출되어 await를 강제하지 않는가?

## T-09: ChatRoomScreen Change Scope (R-10 검증)
- [ ] isSettling 관련 코드가 단 한 줄도 변경되지 않았는가?
- [ ] hasReceivedFirstToken 관련 코드가 단 한 줄도 변경되지 않았는가?
- [ ] editable={!isGenerating && !isSettling} 라인이 그대로인가?
- [ ] sendMessage() 내부의 스트리밍 루프가 그대로인가?

## T-10: UI Rules (R-07 검증)
- [ ] ModelGalleryScreen imports에 외부 UI 라이브러리가 없는가?
- [ ] 모든 스타일이 StyleSheet.create() 내부에 정의되어 있는가?
- [ ] 배경색 #0F172A, 카드색 #1E293B, 액센트 #4F46E5가 적용되어 있는가?