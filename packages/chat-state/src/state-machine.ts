/**
 * 채팅 화면의 전체 상태를 표현하는 유한 상태 머신.
 * 공통 패키지에 정의하여 웹/모바일 모두 동일한 상태 전이 로직을 사용한다.
 */
export type ChatPhase =
  | 'model-loading'         // 모델 초기화 중
  | 'model-error'           // 모델 로딩 실패 / 미지원
  | 'idle'                  // 입력 대기
  | 'generating'            // 스트리밍 응답 생성 중
  | 'interrupted'           // 사용자가 생성 중단
  | 'tool-executing'        // 도구 호출 실행 중
  | 'error';                // 런타임 에러

export type ChatAction =
  | { type: 'MODEL_LOAD_START' }
  | { type: 'MODEL_LOAD_SUCCESS' }
  | { type: 'MODEL_LOAD_FAILURE'; error: string }
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'STREAM_CHUNK'; chunk: string }
  | { type: 'STREAM_COMPLETE' }
  | { type: 'STREAM_ERROR'; error: string }
  | { type: 'INTERRUPT' }
  | { type: 'RETRY' }
  | { type: 'TOOL_CALL_START'; name: string }
  | { type: 'TOOL_CALL_COMPLETE'; result: string }
  | { type: 'NEW_SESSION' }
  | { type: 'RESTORE_SESSION'; sessionId: string };
