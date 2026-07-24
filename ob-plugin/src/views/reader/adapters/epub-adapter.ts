import ePub from 'epubjs';
import type { Contents, NavItem, Location } from 'epubjs';
import type { App, TFile } from 'obsidian';
import type {
  ReaderAdapter,
  ReaderAdapterHandle,
  ReaderAdapterMount,
  ReaderSearchResult,
  ReaderTocItem,
} from '../../../reader/model';
import { clampReaderProgress } from '../../../reader/model';
import { readerContextText, readerSelectionFromText } from '../../../reader/model';

const EPUB_HIGHLIGHT_COLORS = {
  yellow: 'rgba(255, 220, 80, .42)',
  red: 'rgba(215, 25, 32, .30)',
  blue: 'rgba(56, 132, 255, .30)',
  green: 'rgba(42, 166, 101, .30)',
} as const;

function flattenToc(items: NavItem[], depth = 0, result: ReaderTocItem[] = []): ReaderTocItem[] {
  for (const item of items) {
    result.push({ id: item.id || item.href, label: item.label.trim(), target: item.href, depth });
    if (item.subitems?.length) flattenToc(item.subitems, depth + 1, result);
  }
  return result;
}

export class EpubReaderAdapter implements ReaderAdapter {
  readonly kind = 'epub' as const;

  constructor(private readonly app: App, private readonly file: TFile) {}

  async mount(input: ReaderAdapterMount): Promise<ReaderAdapterHandle> {
    const data = await this.app.vault.readBinary(this.file);
    const book = ePub(data);
    await book.ready;
    const navigation = await book.loaded.navigation;
    const toc = flattenToc(navigation.toc);
    const rendition = book.renderTo(input.container, {
      width: '100%',
      height: '100%',
      flow: input.layoutMode === 'paginated' ? 'paginated' : 'scrolled-continuous',
      spread: 'none',
      allowScriptedContent: false,
    });
    rendition.themes.default({
      body: {
        color: 'var(--text-normal) !important',
        background: 'transparent !important',
        'font-family': 'var(--font-text) !important',
        'line-height': '1.75 !important',
      },
      a: { color: 'var(--link-color) !important' },
    });

    let closed = false;
    let lastLocation: Location | null = null;
    let annotations = input.annotations ?? [];
    let renderedAnnotationCfis: string[] = [];
    const renderAnnotations = () => {
      for (const cfi of renderedAnnotationCfis) rendition.annotations.remove(cfi, 'highlight');
      renderedAnnotationCfis = [];
      for (const annotation of annotations) {
        if (annotation.anchor.format !== 'epub') continue;
        const cfi = annotation.anchor.cfiRange;
        rendition.annotations.highlight(cfi, { annotationId: annotation.id }, undefined, 'kos-reader-epub-highlight', {
          fill: EPUB_HIGHLIGHT_COLORS[annotation.color],
          'fill-opacity': '1',
          'mix-blend-mode': 'multiply',
        });
        renderedAnnotationCfis.push(cfi);
      }
    };
    const emit = (location: Location) => {
      lastLocation = location;
      const percentage = clampReaderProgress(location.start.percentage);
      input.onState({
        location: location.start.cfi,
        progress: percentage,
        positionLabel: percentage == null ? '' : `${Math.round(percentage * 100)}%`,
        canPrevious: !location.atStart,
        canNext: !location.atEnd,
        toc,
      });
    };
    const onRelocated = (location: Location) => emit(location);
    const onSelected = (cfiRange: string, contents: Contents) => {
      const label = lastLocation?.start.percentage == null
        ? 'EPUB 选区'
        : `${Math.round(lastLocation.start.percentage * 100)}%`;
      const value = readerSelectionFromText(contents.window.getSelection()?.toString() ?? '', cfiRange, label);
      input.onSelection(value ? { ...value, anchor: { format: 'epub', cfiRange, quote: value.text } } : null);
    };
    rendition.on('relocated', onRelocated);
    rendition.on('selected', onSelected);

    const resizeObserver = new ResizeObserver(() => {
      if (!closed && input.container.clientWidth > 0 && input.container.clientHeight > 0) {
        rendition.resize(input.container.clientWidth, input.container.clientHeight);
      }
    });
    resizeObserver.observe(input.container);
    await rendition.display(input.initialLocation || undefined);
    renderAnnotations();

    void book.locations.generate(1400).then(() => {
      if (!closed && lastLocation) emit(lastLocation);
    }).catch(() => undefined);

    return {
      previous: () => {
        input.onSelection(null);
        return rendition.prev();
      },
      next: () => {
        input.onSelection(null);
        return rendition.next();
      },
      goTo: async (target) => {
        input.onSelection(null);
        const annotation = target.startsWith('annotation:') ? annotations.find((item) => item.id === target.slice(11)) : undefined;
        const destination = annotation?.anchor.format === 'epub' ? annotation.anchor.cfiRange : target;
        if (destination.startsWith('epubcfi(')) {
          const section = (book.spine as unknown as { get(value: string): { href?: string } | undefined }).get(destination);
          if (section?.href) await rendition.display(section.href);
        }
        await rendition.display(destination);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        renderAnnotations();
      },
      search: async (query) => {
        const results: ReaderSearchResult[] = [];
        const spine = await book.loaded.spine;
        for (let index = 0; index < spine.length && results.length < 100; index += 1) {
          const section = book.section(index);
          try {
            await section.load(book.load.bind(book));
            const matches = section.find(query) as unknown as Array<{ cfi?: string; excerpt?: string }>;
            for (let matchIndex = 0; matchIndex < matches.length && results.length < 100; matchIndex += 1) {
              const match = matches[matchIndex];
              if (!match.cfi) continue;
              results.push({
                id: `epub:${index}:${matchIndex}`,
                location: match.cfi,
                positionLabel: navigation.get(section.href)?.label?.trim() || `章节 ${index + 1}`,
                excerpt: match.excerpt?.replace(/\s+/g, ' ').trim() || query,
              });
            }
          } finally {
            section.unload();
          }
        }
        return results;
      },
      setAnnotations: (next) => { annotations = next; renderAnnotations(); },
      getContext: async () => {
        const contents = rendition.getContents() as unknown as Contents | Contents[];
        const current = Array.isArray(contents) ? contents[0] : contents;
        return {
          location: lastLocation?.start.cfi ?? '',
          positionLabel: lastLocation?.start.percentage == null ? '当前章节' : `${Math.round(lastLocation.start.percentage * 100)}%`,
          text: readerContextText(current?.document.body?.innerText ?? ''),
        };
      },
      close: () => {
        closed = true;
        resizeObserver.disconnect();
        rendition.off('relocated', onRelocated);
        rendition.off('selected', onSelected);
        input.onSelection(null);
        rendition.destroy();
        book.destroy();
        input.container.empty();
      },
    };
  }
}
