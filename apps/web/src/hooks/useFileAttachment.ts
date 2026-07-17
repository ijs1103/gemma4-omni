import { useState, useRef, useEffect, useCallback } from 'react';
import type { Attachment, AttachmentType } from '@repo/ai-core';
import { toast } from 'react-toastify';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite 환경에서 로컬 워커 번들 사용 (CORS 및 브라우저 보안 이슈 방지)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function extractTextFromPdf(file: File): Promise<string> {
  let toastId: string | number | null = null;
  try {
    toastId = toast.loading(`'${file.name}' 텍스트 추출 중... 잠시만 기다려주세요.`);
    
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let fullText = '';
    
    // 최대 페이지 제한 (메모리 및 성능 보호)
    const maxPages = Math.min(pdf.numPages, 50);
    
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n\n';
    }
    
    if (pdf.numPages > maxPages) {
      fullText += `\n... (총 ${pdf.numPages}페이지 중 ${maxPages}페이지까지만 추출되었습니다.)`;
    }
    
    if (toastId) toast.dismiss(toastId);
    
    const textLength = fullText.trim().length;
    if (textLength === 0) {
      toast.warning(`'${file.name}'에서 텍스트를 찾을 수 없습니다. (이미지로 된 스캔본일 수 있습니다.)`, { autoClose: 5000 });
    } else {
      toast.success(`'${file.name}' 텍스트 추출 완료! (${textLength}자) 이제 전송하셔도 됩니다.`, { autoClose: 3000 });
    }
    
    return fullText;
  } catch (err) {
    console.error('[extractTextFromPdf] Error:', err);
    if (toastId) toast.dismiss(toastId);
    throw new Error('PDF 텍스트 추출에 실패했습니다.');
  }
}

const MAX_ATTACHMENTS = 5;

export function useFileAttachment() {
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Object URL 추적 — cleanup 시 메모리 해제
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // 메모리 정리: 컴포넌트 언마운트 시 모든 Object URL 해제
  useEffect(() => {
    return () => {
      console.log('[useFileAttachment] Cleanup: revoking all object URLs');
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  const triggerImageSelect = useCallback(() => {
    console.log('[useFileAttachment] Image attachment blocked on web');
    toast.info('웹에서는 멀티모달(이미지 추론) 기능이 곧 지원될 예정입니다.', { toastId: 'web-image-wip' });
    // 임시로 웹 환경에서 이미지 첨부 기능 차단
    // imageInputRef.current?.click();
  }, []);

  const triggerDocumentSelect = useCallback(() => {
    console.log('[useFileAttachment] Triggering document select dialog');
    documentInputRef.current?.click();
  }, []);

  const handleImageFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // FileList는 live 객체이므로 배열로 복사
    const files = Array.from(fileList);
    console.log('[useFileAttachment] handleImageFiles selected count:', files.length);

    setPendingAttachments((prev) => {
      const remaining = MAX_ATTACHMENTS - prev.length;
      if (remaining <= 0) {
        toast.dismiss('max-attachments');
        toast.warning(`최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`, { toastId: 'max-attachments' });
        return prev;
      }

      const newAttachments: Attachment[] = [];
      let duplicateCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        
        // 중복 체크 (이름과 크기 기준)
        const isDuplicate = prev.some((a) => a.name === file.name && a.sizeBytes === file.size) ||
                            newAttachments.some((a) => a.name === file.name && a.sizeBytes === file.size);
        
        if (isDuplicate) {
          duplicateCount++;
          console.log('[useFileAttachment] Duplicate image file skipped:', file.name);
          continue;
        }

        if (newAttachments.length >= remaining) {
          console.log('[useFileAttachment] Max limit reached while processing selected files');
          continue;
        }

        const objectUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(objectUrl);

        console.log('[useFileAttachment] Created Object URL for image:', file.name, objectUrl);

        newAttachments.push({
          id: `${Date.now()}_img_${i}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'image' as AttachmentType,
          uri: objectUrl,
          name: file.name,
          mimeType: file.type || 'image/jpeg',
          sizeBytes: file.size,
        });
      }

      if (duplicateCount > 0) {
        toast.dismiss('duplicate-file');
        toast.warning(`이미 첨부된 이미지 파일은 제외되었습니다. (${duplicateCount}개)`, { toastId: 'duplicate-file' });
      }

      if (files.length - duplicateCount > remaining) {
        toast.dismiss('max-attachments');
        toast.warning(`최대 ${MAX_ATTACHMENTS}개까지만 첨부할 수 있어 일부 파일이 제외되었습니다.`, { toastId: 'max-attachments' });
      }

      return [...prev, ...newAttachments];
    });

    // input 초기화 — 같은 파일을 다시 선택할 수 있도록
    e.target.value = '';
  }, []);

  const handleDocumentFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // FileList 배열 복사
    const files = Array.from(fileList);
    console.log('[useFileAttachment] handleDocumentFiles selected count:', files.length);

    const textFilesToRead: { file: File; index: number; isPdf: boolean }[] = [];

    // 1. 중복 체크 및 Object URL 생성
    setPendingAttachments((prev) => {
      const remaining = MAX_ATTACHMENTS - prev.length;
      if (remaining <= 0) {
        toast.dismiss('max-attachments');
        toast.warning(`최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`, { toastId: 'max-attachments' });
        return prev;
      }

      const newAttachments: Attachment[] = [];
      let duplicateCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file) continue;
        
        // 중복 체크
        const isDuplicate = prev.some((a) => a.name === file.name && a.sizeBytes === file.size) ||
                            newAttachments.some((a) => a.name === file.name && a.sizeBytes === file.size);
        
        if (isDuplicate) {
          duplicateCount++;
          console.log('[useFileAttachment] Duplicate document file skipped:', file.name);
          continue;
        }

        if (newAttachments.length >= remaining) {
          console.log('[useFileAttachment] Max limit reached while processing selected files');
          continue;
        }

        const objectUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(objectUrl);

        console.log('[useFileAttachment] Created Object URL for doc:', file.name, objectUrl);

        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        
        if (isPdf || 
          file.type.includes('text') ||
          file.type.includes('json') ||
          file.type.includes('csv') ||
          file.name.endsWith('.md') ||
          file.name.endsWith('.txt')
        ) {
          // 상태 업데이트 함수 외부로 빼내어 비동기 처리하기 위해 배열에 푸시
          textFilesToRead.push({ file, index: i, isPdf });
        }

        newAttachments.push({
          id: `${Date.now()}_doc_${i}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'document' as AttachmentType,
          uri: objectUrl,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
      }

      if (duplicateCount > 0) {
        toast.dismiss('duplicate-file');
        toast.warning(`이미 첨부된 문서 파일은 제외되었습니다. (${duplicateCount}개)`, { toastId: 'duplicate-file' });
      }

      if (files.length - duplicateCount > remaining) {
        toast.dismiss('max-attachments');
        toast.warning(`최대 ${MAX_ATTACHMENTS}개까지만 첨부할 수 있어 일부 파일이 제외되었습니다.`, { toastId: 'max-attachments' });
      }

      return [...prev, ...newAttachments];
    });

    // 2. 비동기 텍스트 파일 읽기 및 상태 업데이트
    // setTimeout을 이용해 setPendingAttachments(동기)가 완료된 이후에 비동기 작업이 시작되도록 보장
    setTimeout(async () => {
      if (textFilesToRead.length > 0) {
        for (const item of textFilesToRead) {
          try {
            let content = '';
            if (item.isPdf) {
              console.log('[useFileAttachment] Reading PDF content:', item.file.name);
              content = await extractTextFromPdf(item.file);
            } else {
              console.log('[useFileAttachment] Reading text content from doc:', item.file.name);
              content = await item.file.text();
            }
            
            setPendingAttachments((prev) => 
              prev.map((att) => {
                if (att.name === item.file.name && att.sizeBytes === item.file.size) {
                  return { ...att, textContent: content };
                }
                return att;
              })
            );
          } catch (err) {
            console.error('[useFileAttachment] Failed to read content:', item.file.name, err);
            toast.error(`${item.file.name} 파일을 읽는 데 실패했습니다.`);
          }
        }
      }
    }, 0);

    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) {
        console.log('[useFileAttachment] Removing attachment:', target.name);
        if (target.uri.startsWith('blob:')) {
          URL.revokeObjectURL(target.uri);
          objectUrlsRef.current.delete(target.uri);
        }
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    console.log('[useFileAttachment] Clearing pending attachments for send (URLs kept alive for chat bubbles)');
    setPendingAttachments([]);
  }, []);

  return {
    pendingAttachments,
    imageInputRef,
    documentInputRef,
    triggerImageSelect,
    triggerDocumentSelect,
    handleImageFiles,
    handleDocumentFiles,
    removeAttachment,
    clearAttachments,
  };
}
