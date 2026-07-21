import ePub from 'epubjs';
import type { Contents, NavItem, Location } from 'epubjs';
import type { App, TFile } from 'obsidian';
import type {
  ReaderAdapter,
  ReaderAdapterHandle,
  ReaderAdapterMount,
  ReaderTocItem,
} from '../../../reader/model';
import { clampReaderProgress } from '../../../reader/model';
import { readerSelectionFromText } from '../../../reader/model';

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
      input.onSelection(readerSelectionFromText(contents.window.getSelection()?.toString() ?? '', cfiRange, label));
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
      goTo: (target) => {
        input.onSelection(null);
        return rendition.display(target);
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
