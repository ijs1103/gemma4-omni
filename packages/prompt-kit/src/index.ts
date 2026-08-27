export {
  buildDocumentContext,
  buildContextFromMessages,
  sanitizeDocumentText,
  truncateText,
  estimateTokenCount,
  CONTEXT_LIMITS,
} from './document-context';

export type {
  ExtractedDocument,
  ContextBuildResult,
  ContextBuildOptions,
} from './document-context';

export {
  buildWebSearchContext,
  buildMobileWebSearchPrompt,
  sanitizeSearchSnippet,
  INJECTION_GUARD,
} from './web-search-context';

export type { SearchSnippet, WebSearchContextResult } from './web-search-context';
