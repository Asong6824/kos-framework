import { describe, expect, it } from 'vitest';
import {
  clampReaderProgress,
  formatReaderAgentQuote,
  normalizeReaderSelectionText,
  readerDocumentKind,
  readerPathCandidates,
  readerSelectionFromText,
  readerSourceReference,
  unwrapReaderReference,
} from '../src/reader/model';

describe('Reader selection', () => {
  it('normalizes selected text and rejects an empty selection', () => {
    expect(normalizeReaderSelectionText('  第一行\u00a0 内容 \r\n\r\n\r\n 第二行  ')).toBe('第一行 内容\n\n第二行');
    expect(readerSelectionFromText(' \n\t ', 'page:1', '第 1 页')).toBeNull();
    expect(readerSelectionFromText(' selected ', 'page:1', '第 1 页')).toEqual({
      text: 'selected',
      location: 'page:1',
      positionLabel: '第 1 页',
    });
  });

  it('formats an Agent draft with the quote, Source, document and position', () => {
    expect(formatReaderAgentQuote({
      sourcePath: '11_原材料/论文/Attention.md',
      documentPath: '附件/attention.pdf',
      title: 'Attention',
      kind: 'pdf',
      selection: { text: '第一行\n第二行', location: 'page:3', positionLabel: '第 3 页' },
    })).toBe([
      '> 第一行',
      '> 第二行',
      '',
      '来源：[[11_原材料/论文/Attention]] · [[附件/attention.pdf]] · 第 3 页',
    ].join('\n'));
  });
});

describe('Reader source resolution', () => {
  it('unwraps Obsidian wikilinks and angle-bracket paths', () => {
    expect(unwrapReaderReference('[[assets/book.epub|原书]]')).toBe('assets/book.epub');
    expect(unwrapReaderReference('<assets/paper.pdf>')).toBe('assets/paper.pdf');
  });

  it('prefers source_location and keeps source_url as an external fallback', () => {
    expect(readerSourceReference({
      source_location: '[[books/example.epub]]',
      source_url: 'https://example.com/book',
    })).toEqual({
      documentReference: 'books/example.epub',
      externalUrl: 'https://example.com/book',
    });
  });

  it('uses local PDF/EPUB source_url values but does not embed remote URLs', () => {
    expect(readerSourceReference({ source_url: 'papers/example.pdf' })).toEqual({
      documentReference: 'papers/example.pdf',
      externalUrl: null,
    });
    expect(readerSourceReference({ source_url: 'https://example.com/article' })).toEqual({
      documentReference: null,
      externalUrl: 'https://example.com/article',
    });
  });

  it('resolves root and Source-relative vault candidates deterministically', () => {
    expect(readerPathCandidates('books/example.epub', '11_原材料/book/示例.md')).toEqual([
      'books/example.epub',
      '11_原材料/book/books/example.epub',
    ]);
    expect(readerPathCandidates('../assets/paper.pdf', '11_原材料/paper/示例.md')).toEqual([
      '11_原材料/assets/paper.pdf',
      'assets/paper.pdf',
    ]);
  });

  it('recognizes supported documents and clamps progress', () => {
    expect(readerDocumentKind('Book.EPUB#chapter=1')).toBe('epub');
    expect(readerDocumentKind('paper.pdf?download=1')).toBe('pdf');
    expect(readerDocumentKind('article.html')).toBeNull();
    expect(clampReaderProgress(-0.2)).toBe(0);
    expect(clampReaderProgress(1.4)).toBe(1);
    expect(clampReaderProgress(Number.NaN)).toBeNull();
  });
});
