#!/usr/bin/env bash
# ============================================================
# 클라우드 채팅 동기화 — API 수동 검증 스크립트 (curl 기반) v2
# v5 설계서 Verification Plan #1~#15 대응
# (11번 수정: 진짜 "같은 세션" 재요청으로 정정)
#
# 사용법:
#   1. 아래 USER_A_TOKEN, USER_B_TOKEN 을 실제 JWT로 채워넣는다.
#   2. chmod +x chat_sync_api_verification.sh
#   3. ./chat_sync_api_verification.sh
# ============================================================

set -uo pipefail

BASE_URL="http://localhost:8000/api/v1/chats"
USER_A_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiNTdkYTJjODExNTM0MmU1YWFhMDU5YzBiYzE4ZGY0MyIsImlhdCI6MTc4NzA2MzY1NiwiZXhwIjoxNzg3MDY3MjU2fQ._rmuAPFfDOWjOcMSB4I_3WbLJu9ud8AYajJYPW8aM1g"
USER_B_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYjM5MjJjNjE4MjQ0ZjZmOTk4ODFlNzc4NTEwNDdkMSIsImlhdCI6MTc4NzA2MzY1NiwiZXhwIjoxNzg3MDY3MjU2fQ.Rvs1dNHJ6sHGiNJp7o4qzcQUhIit5sID4-r5JPgICK0"
PASS=0
FAIL=0

pp() { if command -v jq >/dev/null 2>&1; then jq . 2>/dev/null || cat; else cat; fi; }

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "✅ PASS [$name] — expected $expected, got $actual"
    PASS=$((PASS+1))
  else
    echo "❌ FAIL [$name] — expected $expected, got $actual"
    FAIL=$((FAIL+1))
  fi
}

echo "======================================================"
echo "1. POST /chats 세션 생성 (사용자 A)"
echo "======================================================"
SESSION_ID="test-session-$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
RESP=$(curl -s -o /tmp/r1.json -w "%{http_code}" -X POST "$BASE_URL" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$SESSION_ID\", \"title\": \"검증용 세션\", \"model_id\": \"gemma4-e2b\"}")
cat /tmp/r1.json | pp
check "#1 세션 생성" "201" "$RESP"

echo
echo "======================================================"
echo "2. POST /chats/{id}/messages 메시지 추가"
echo "======================================================"
MSG_ID="test-msg-$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
RESP=$(curl -s -o /tmp/r2.json -w "%{http_code}" -X POST "$BASE_URL/$SESSION_ID/messages" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$MSG_ID\", \"role\": \"user\", \"content\": \"안녕\"}")
cat /tmp/r2.json | pp
check "#2 메시지 추가" "201" "$RESP"

echo
echo "======================================================"
echo "3. GET /chats 세션 목록 (생성한 세션 포함 확인)"
echo "======================================================"
RESP=$(curl -s -o /tmp/r3.json -w "%{http_code}" -X GET "$BASE_URL" \
  -H "Authorization: Bearer $USER_A_TOKEN")
cat /tmp/r3.json | pp
if grep -q "$SESSION_ID" /tmp/r3.json; then
  echo "✅ PASS [#3 목록에 세션 포함]"; PASS=$((PASS+1))
else
  echo "❌ FAIL [#3 목록에 세션 없음]"; FAIL=$((FAIL+1))
fi
check "#3 status" "200" "$RESP"

echo
echo "======================================================"
echo "4. GET /chats/{id}/messages 메시지 목록 (created_at ASC)"
echo "======================================================"
RESP=$(curl -s -o /tmp/r4.json -w "%{http_code}" -X GET "$BASE_URL/$SESSION_ID/messages" \
  -H "Authorization: Bearer $USER_A_TOKEN")
cat /tmp/r4.json | pp
check "#4 메시지 목록 조회" "200" "$RESP"

echo
echo "======================================================"
echo "5. DELETE /chats/{id} 소프트 삭제"
echo "======================================================"
RESP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/$SESSION_ID" \
  -H "Authorization: Bearer $USER_A_TOKEN")
check "#5 소프트 삭제" "204" "$RESP"

echo
echo "======================================================"
echo "6. GET /chats 삭제 후 목록 (미포함 확인)"
echo "======================================================"
RESP=$(curl -s -o /tmp/r6.json -w "%{http_code}" -X GET "$BASE_URL" \
  -H "Authorization: Bearer $USER_A_TOKEN")
if grep -q "$SESSION_ID" /tmp/r6.json; then
  echo "❌ FAIL [#6 삭제된 세션이 여전히 목록에 있음]"; FAIL=$((FAIL+1))
else
  echo "✅ PASS [#6 삭제된 세션이 목록에서 제외됨]"; PASS=$((PASS+1))
fi
check "#6 status" "200" "$RESP"

echo
echo "======================================================"
echo "7. 사용자 A 세션에 사용자 B 토큰으로 접근 → 403"
echo "======================================================"
SESSION_ID_2="test-session-b-$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
curl -s -o /dev/null -X POST "$BASE_URL" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$SESSION_ID_2\", \"title\": \"A 소유 세션\", \"model_id\": \"gemma4-e2b\"}"
RESP=$(curl -s -o /tmp/r7.json -w "%{http_code}" -X GET "$BASE_URL/$SESSION_ID_2/messages" \
  -H "Authorization: Bearer $USER_B_TOKEN")
cat /tmp/r7.json | pp
check "#7 타 사용자 접근 차단" "403" "$RESP"

echo
echo "======================================================"
echo "8. 같은 ID로 세션 생성 2회 (같은 사용자, 활성) → 멱등"
echo "======================================================"
RESP=$(curl -s -o /tmp/r8.json -w "%{http_code}" -X POST "$BASE_URL" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$SESSION_ID_2\", \"title\": \"수정된 제목\", \"model_id\": \"gemma4-e2b\"}")
cat /tmp/r8.json | pp
check "#8 멱등 upsert" "201" "$RESP"

echo
echo "======================================================"
echo "9. 다른 사용자가 사용 중인 ID로 세션 생성 → 409"
echo "======================================================"
RESP=$(curl -s -o /tmp/r9.json -w "%{http_code}" -X POST "$BASE_URL" \
  -H "Authorization: Bearer $USER_B_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$SESSION_ID_2\", \"title\": \"탈취 시도\", \"model_id\": \"gemma4-e2b\"}")
cat /tmp/r9.json | pp
check "#9 타 사용자 ID 충돌" "409" "$RESP"

echo
echo "======================================================"
echo "10. POST /chats/sync 동일 데이터 2회 전송 → 멱등"
echo "======================================================"
SYNC_SESSION_ID="sync-test-$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
SYNC_MSG_ID="sync-msg-$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SYNC_PAYLOAD="{\"sessions\": [{\"id\": \"$SYNC_SESSION_ID\", \"title\": \"동기화 테스트\", \"model_id\": \"gemma4-e2b\", \"status\": \"active\", \"created_at\": \"$NOW\", \"updated_at\": \"$NOW\", \"messages\": [{\"id\": \"$SYNC_MSG_ID\", \"role\": \"user\", \"content\": \"sync 메시지\", \"created_at\": \"$NOW\"}]}]}"

curl -s -o /tmp/r10a.json -X POST "$BASE_URL/sync" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "$SYNC_PAYLOAD"
cat /tmp/r10a.json | pp
RESP=$(curl -s -o /tmp/r10b.json -w "%{http_code}" -X POST "$BASE_URL/sync" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "$SYNC_PAYLOAD")
cat /tmp/r10b.json | pp
check "#10 sync 재전송 멱등" "200" "$RESP"

echo
echo "======================================================"
echo "11. 같은 메시지 ID로 진짜 같은 세션에 2회 POST → 멱등 반환"
echo "======================================================"
# 주의: 세션 X(SESSION_ID_2)에 소속된 적 없는 '새 메시지 ID'를 만들어서
#       바로 그 같은 세션(SESSION_ID_2)에 두 번 보낸다.
#       (이전 버전은 실수로 SESSION_ID에 속한 MSG_ID를 다른 세션에 보내서 409가 정상 발생했었음)
FRESH_MSG_ID="idem-msg-$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
curl -s -o /tmp/r11a.json -X POST "$BASE_URL/$SESSION_ID_2/messages" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$FRESH_MSG_ID\", \"role\": \"user\", \"content\": \"진짜 중복 테스트\"}"
cat /tmp/r11a.json | pp
RESP=$(curl -s -o /tmp/r11b.json -w "%{http_code}" -X POST "$BASE_URL/$SESSION_ID_2/messages" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$FRESH_MSG_ID\", \"role\": \"user\", \"content\": \"진짜 중복 테스트\"}")
cat /tmp/r11b.json | pp
check "#11 같은 세션 메시지 재요청 멱등" "201" "$RESP"

echo
echo "======================================================"
echo "12. 삭제된 세션 ID로 재생성 시도 → 410"
echo "======================================================"
RESP=$(curl -s -o /tmp/r12.json -w "%{http_code}" -X POST "$BASE_URL" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$SESSION_ID\", \"title\": \"부활 시도\", \"model_id\": \"gemma4-e2b\"}")
cat /tmp/r12.json | pp
check "#12 삭제 세션 자동 복원 차단" "410" "$RESP"

echo
echo "======================================================"
echo "13. 삭제된 세션을 포함한 sync push → skipped_sessions 확인"
echo "======================================================"
DEL_SYNC_PAYLOAD="{\"sessions\": [{\"id\": \"$SESSION_ID\", \"title\": \"삭제됐던 세션\", \"model_id\": \"gemma4-e2b\", \"status\": \"active\", \"created_at\": \"$NOW\", \"updated_at\": \"$NOW\", \"messages\": []}]}"
RESP=$(curl -s -o /tmp/r13.json -w "%{http_code}" -X POST "$BASE_URL/sync" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "$DEL_SYNC_PAYLOAD")
cat /tmp/r13.json | pp
check "#13 status" "200" "$RESP"

echo
echo "======================================================"
echo "14. 세션 X에 있는 메시지 ID를 세션 Y에 재사용 → 409 (IDOR 방지)"
echo "======================================================"
RESP=$(curl -s -o /tmp/r14.json -w "%{http_code}" -X POST "$BASE_URL/$SYNC_SESSION_ID/messages" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\": \"$MSG_ID\", \"role\": \"user\", \"content\": \"IDOR 시도\"}")
cat /tmp/r14.json | pp
check "#14 메시지 소속 세션 불일치 방지" "409" "$RESP"

echo
echo "======================================================"
echo "15. sync push에 다른 세션 소속 메시지 ID 포함 → skipped_messages 확인"
echo "======================================================"
IDOR_SYNC_PAYLOAD="{\"sessions\": [{\"id\": \"$SYNC_SESSION_ID\", \"title\": \"IDOR sync 테스트\", \"model_id\": \"gemma4-e2b\", \"status\": \"active\", \"created_at\": \"$NOW\", \"updated_at\": \"$NOW\", \"messages\": [{\"id\": \"$MSG_ID\", \"role\": \"user\", \"content\": \"충돌 메시지\", \"created_at\": \"$NOW\"}]}]}"
RESP=$(curl -s -o /tmp/r15.json -w "%{http_code}" -X POST "$BASE_URL/sync" \
  -H "Authorization: Bearer $USER_A_TOKEN" -H "Content-Type: application/json" \
  -d "$IDOR_SYNC_PAYLOAD")
cat /tmp/r15.json | pp
check "#15 status" "200" "$RESP"

echo
echo "======================================================"
echo "결과 요약: PASS=$PASS  FAIL=$FAIL"
echo "======================================================"
