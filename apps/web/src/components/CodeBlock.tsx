import React, { useState, useEffect, useMemo } from 'react';
import { createHighlighter, type Highlighter } from 'shiki';
import { toast } from 'react-toastify';
import { useTheme } from '../context/ThemeContext';

interface CodeBlockProps {
  code: string;
  language?: string;
}

let highlighterPromise: Promise<Highlighter> | null = null;
let cachedHighlighter: Highlighter | null = null;
const readyListeners = new Set<() => void>();

function initHighlighter() {
  if (cachedHighlighter) return Promise.resolve(cachedHighlighter);
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['typescript', 'tsx', 'javascript', 'json', 'bash', 'python', 'sql', 'html', 'css', 'markdown'],
    }).then((h) => {
      cachedHighlighter = h;
      readyListeners.forEach((fn) => fn());
      return h;
    }).catch((err) => {
      console.error('[CodeBlock] Shiki initialization failed:', err);
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

// Module 로드 시점에 Shiki 싱글톤 사전 초기화
initHighlighter();

export const CodeBlock: React.FC<CodeBlockProps> = React.memo(({ code, language = 'text' }) => {
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const { isDarkMode } = useTheme();

  const cleanLang = language.toLowerCase().trim() || 'text';

  // Highlighter 로드 완료 시 1회 리렌더링 트리거
  useEffect(() => {
    if (cachedHighlighter) return;
    const onReady = () => setTick((t) => t + 1);
    readyListeners.add(onReady);
    initHighlighter();
    return () => {
      readyListeners.delete(onReady);
    };
  }, []);

  // cachedHighlighter가 준비되어 있으면 동일 렌더 프레임에서 동기식(Synchronous)으로 즉시 하이라이팅
  const highlightedHtml = useMemo(() => {
    if (!cachedHighlighter) return null;
    const loadedLangs = cachedHighlighter.getLoadedLanguages();
    const validLang = loadedLangs.includes(cleanLang) ? cleanLang : 'text';
    const activeTheme = isDarkMode ? 'github-dark' : 'github-light';

    try {
      return cachedHighlighter.codeToHtml(code, {
        lang: validLang,
        theme: activeTheme,
      });
    } catch (err) {
      console.warn('[CodeBlock] Highlighting fallback to plain text:', err);
      return null;
    }
  }, [code, cleanLang, isDarkMode]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.dismiss('code-copy-toast');
      toast.success('코드가 복사되었습니다.', { toastId: 'code-copy-toast', autoClose: 2000 });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={`shiki-code-block-container my-3 rounded-lg overflow-hidden border ${
      isDarkMode 
        ? 'border-white/10 bg-[#0d1117] text-gray-200' 
        : 'border-gray-200 bg-[#ffffff] text-gray-800'
    }`}>
      <div className={`shiki-code-header flex items-center justify-between px-4 py-2 border-b text-xs font-mono select-none ${
        isDarkMode 
          ? 'bg-[#161b22] border-white/10 text-gray-400' 
          : 'bg-[#f6f8fa] border-gray-200 text-gray-600'
      }`}>
        <span className={`code-lang-label uppercase text-[11px] font-semibold tracking-wider ${
          isDarkMode ? 'text-purple-400' : 'text-purple-600'
        }`}>
          {cleanLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={`code-copy-btn transition-colors flex items-center gap-1 text-[11px] px-2 py-1 rounded font-medium ${
            isDarkMode 
              ? 'hover:text-white bg-white/5 hover:bg-white/10 text-gray-300' 
              : 'hover:text-black bg-gray-200/70 hover:bg-gray-300/80 text-gray-700'
          }`}
          aria-label="Code copy"
        >
          {copied ? '✓ 복사됨' : '📋 복사'}
        </button>
      </div>
      <div className="shiki-code-content p-4 text-xs font-mono overflow-x-auto">
        {highlightedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <pre className={`m-0 p-0 bg-transparent text-xs font-mono ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';
