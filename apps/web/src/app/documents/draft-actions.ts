import type { GenerationMode } from '@/lib/document-client';

/** Browser-side actions on a finished draft: copy, download, file naming. */

/** `RENTAL_AGREEMENT` + `template` -> `rental-agreement-template-draft.txt`. */
export function draftFilename(documentType: string, mode: GenerationMode): string {
  const slug =
    documentType
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document';
  return `${slug}-${mode === 'template' ? 'template' : 'ai'}-draft.txt`;
}

/** Windows Notepad and similar editors want CRLF; the BOM keeps rupee signs and Hindi intact. */
export function toDownloadText(text: string): string {
  return `﻿${text.replace(/\r?\n/g, '\r\n')}`;
}

/** Copy text to the clipboard. Resolves false (never throws) when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path (insecure origins, older browsers).
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Save text as a UTF-8 file through a temporary link. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([toDownloadText(text)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
