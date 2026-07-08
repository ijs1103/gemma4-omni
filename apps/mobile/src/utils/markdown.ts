/**
 * 마크다운 렌더링 시 한국어 조사 결합으로 인한 볼드 파싱 오류를 해결하기 위한 전처리기
 * 예: **'불의 날개'**를 -> '**불의 날개**'를
 */
export const preprocessMarkdown = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\*\*(['"])(.*?)\1\*\*/g, '$1**$2**$1')
    .replace(/\*\*‘(.*?)’\*\*/g, '‘**$1**’')
    .replace(/\*\*“(.*?)”\*\*/g, '“**$1**”');
};
