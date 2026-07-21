import { TFile } from 'obsidian';
import type { App, Component } from 'obsidian';
import { readerDocumentKind, readerPathCandidates, readerSourceReference } from '../../reader/model';
import type { ReaderAdapter, ReaderDocumentKind } from '../../reader/model';
import { EpubReaderAdapter } from './adapters/epub-adapter';
import { MarkdownReaderAdapter } from './adapters/markdown-adapter';
import { PdfReaderAdapter } from './adapters/pdf-adapter';

export interface ResolvedReaderDocument {
  sourcePath: string;
  documentPath: string;
  title: string;
  kind: ReaderDocumentKind;
  externalUrl: string | null;
  adapter: ReaderAdapter;
}

export type ReaderDocumentResolution =
  | { ok: true; document: ResolvedReaderDocument }
  | { ok: false; sourcePath: string; title: string; externalUrl: string | null; message: string };

function sourceTitle(file: TFile, frontmatter: Record<string, unknown> | undefined): string {
  return typeof frontmatter?.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : file.basename;
}

function adapterFor(app: App, owner: Component, file: TFile, kind: ReaderDocumentKind): ReaderAdapter {
  if (kind === 'pdf') return new PdfReaderAdapter(app, file);
  if (kind === 'epub') return new EpubReaderAdapter(app, file);
  return new MarkdownReaderAdapter(app, owner, file);
}

export async function resolveReaderDocument(app: App, owner: Component, sourcePath: string): Promise<ReaderDocumentResolution> {
  const sourceFile = app.vault.getFileByPath(sourcePath);
  if (!(sourceFile instanceof TFile)) {
    return { ok: false, sourcePath, title: '阅读', externalUrl: null, message: 'Source 文件不存在或已移动。' };
  }

  const frontmatter = app.metadataCache.getFileCache(sourceFile)?.frontmatter as Record<string, unknown> | undefined;
  const title = sourceTitle(sourceFile, frontmatter);
  const reference = readerSourceReference(frontmatter);
  if (!reference.documentReference) {
    return {
      ok: true,
      document: {
        sourcePath,
        documentPath: sourcePath,
        title,
        kind: 'markdown',
        externalUrl: reference.externalUrl,
        adapter: adapterFor(app, owner, sourceFile, 'markdown'),
      },
    };
  }

  for (const candidate of readerPathCandidates(reference.documentReference, sourcePath)) {
    const file = app.vault.getFileByPath(candidate);
    if (!(file instanceof TFile)) continue;
    const kind = readerDocumentKind(file.path);
    if (!kind) {
      return {
        ok: false,
        sourcePath,
        title,
        externalUrl: reference.externalUrl,
        message: `Reader 暂不支持 .${file.extension} 文件。`,
      };
    }
    return {
      ok: true,
      document: {
        sourcePath,
        documentPath: file.path,
        title,
        kind,
        externalUrl: reference.externalUrl,
        adapter: adapterFor(app, owner, file, kind),
      },
    };
  }

  return {
    ok: false,
    sourcePath,
    title,
    externalUrl: reference.externalUrl,
    message: `找不到原文件：${reference.documentReference}`,
  };
}

export function resolveDirectReaderDocument(
  app: App,
  owner: Component,
  sourcePath: string,
  documentPath: string,
): ReaderDocumentResolution {
  const file = app.vault.getFileByPath(documentPath);
  const kind = readerDocumentKind(documentPath);
  if (!(file instanceof TFile) || (kind !== 'pdf' && kind !== 'epub')) {
    return { ok: false, sourcePath, title: '阅读', externalUrl: null, message: '阅读文件不存在或格式不受支持。' };
  }
  const source = app.vault.getFileByPath(sourcePath);
  const frontmatter = source instanceof TFile
    ? app.metadataCache.getFileCache(source)?.frontmatter as Record<string, unknown> | undefined
    : undefined;
  return {
    ok: true,
    document: {
      sourcePath,
      documentPath: file.path,
      title: source instanceof TFile ? sourceTitle(source, frontmatter) : file.basename,
      kind,
      externalUrl: readerSourceReference(frontmatter).externalUrl,
      adapter: adapterFor(app, owner, file, kind),
    },
  };
}
