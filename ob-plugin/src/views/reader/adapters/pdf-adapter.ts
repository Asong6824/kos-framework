import { loadPdfJs } from 'obsidian';
import type { App, TFile } from 'obsidian';
import type {
  ReaderAdapter,
  ReaderAdapterHandle,
  ReaderAdapterMount,
  ReaderSearchResult,
  ReaderTocItem,
} from '../../../reader/model';
import { readerContextText, readerSearchMatches } from '../../../reader/model';
import { selectionWithin } from './selection';

interface PdfRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

interface PdfViewport {
  width: number;
  height: number;
  [key: string]: unknown;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<unknown>;
  render(options: Record<string, unknown>): PdfRenderTask;
}

interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  getOutline?(): Promise<PdfOutline[] | null>;
  getDestination?(name: string): Promise<unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
  destroy(): Promise<void>;
}

interface PdfOutline {
  title?: string;
  dest?: string | unknown[];
  items?: PdfOutline[];
}

interface PdfJs {
  getDocument(options: { data: ArrayBuffer }): { promise: Promise<PdfDocument>; destroy?(): Promise<void> };
  TextLayer?: new (options: Record<string, unknown>) => { render(): Promise<void> };
  renderTextLayer?: (options: Record<string, unknown>) => { promise?: Promise<void> } | Promise<void>;
}

interface PdfPageView {
  pageNumber: number;
  shell: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  annotationLayer: HTMLDivElement;
  aspectRatio: number;
  renderTask: PdfRenderTask | null;
  renderPromise: Promise<void> | null;
  renderVersion: number;
  rendered: boolean;
}

interface PdfTextContent { items?: Array<{ str?: string }> }

const RENDER_BEHIND = 2;
const RENDER_AHEAD = 3;
const KEEP_DISTANCE = 5;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  return result;
}

function cancellationError(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(`${error.name} ${error.message}`);
}

export class PdfReaderAdapter implements ReaderAdapter {
  readonly kind = 'pdf' as const;

  constructor(private readonly app: App, private readonly file: TFile) {}

  async mount(input: ReaderAdapterMount): Promise<ReaderAdapterHandle> {
    const data = await this.app.vault.readBinary(this.file);
    const pdfjs = await loadPdfJs() as PdfJs;
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;
    const initialPage = Math.min(
      pdf.numPages,
      Math.max(1, Number.parseInt(input.initialLocation?.replace(/^page:/, '') ?? '1', 10) || 1),
    );
    const firstPage = await pdf.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    const defaultAspectRatio = firstViewport.width / firstViewport.height;
    const stage = element('div', 'kos-reader-pdf-stage');
    const pageViews: PdfPageView[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const shell = element('div', 'kos-reader-pdf-page');
      shell.dataset.page = String(pageNumber);
      shell.setAttribute('aria-label', `第 ${pageNumber} 页`);
      const canvas = element('canvas', 'kos-reader-pdf-canvas');
      canvas.hidden = true;
      const textLayer = element('div', 'kos-reader-pdf-text-layer');
      const annotationLayer = element('div', 'kos-reader-pdf-annotation-layer');
      shell.append(canvas, textLayer, annotationLayer);
      stage.append(shell);
      pageViews.push({
        pageNumber,
        shell,
        canvas,
        textLayer,
        annotationLayer,
        aspectRatio: defaultAspectRatio,
        renderTask: null,
        renderPromise: null,
        renderVersion: 0,
        rendered: false,
      });
    }
    input.container.append(stage);

    let pageNumber = initialPage;
    let closed = false;
    let toc: ReaderTocItem[] = [];
    let observedWidth = 0;
    let scrollFrame: number | null = null;
    let resizeFrame: number | null = null;
    let annotations = input.annotations ?? [];
    const pageText = new Map<number, string>();

    const availableWidth = () => Math.max(120, input.container.clientWidth - 40);
    const viewportFor = (page: PdfPage) => {
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, availableWidth() / base.width);
      return { base, viewport: page.getViewport({ scale }) };
    };
    const layoutView = (view: PdfPageView) => {
      const width = availableWidth();
      const height = width / view.aspectRatio;
      view.shell.style.width = `${width}px`;
      view.shell.style.height = `${height}px`;
      view.textLayer.style.width = `${width}px`;
      view.textLayer.style.height = `${height}px`;
    };
    const layoutViews = () => pageViews.forEach(layoutView);

    const emit = () => input.onState({
      location: `page:${pageNumber}`,
      progress: pdf.numPages > 0 ? pageNumber / pdf.numPages : null,
      positionLabel: `${pageNumber} / ${pdf.numPages}`,
      canPrevious: pageNumber > 1,
      canNext: pageNumber < pdf.numPages,
      toc,
    });

    const renderAnnotations = (view: PdfPageView) => {
      view.annotationLayer.empty();
      for (const annotation of annotations) {
        if (annotation.anchor.format !== 'pdf' || annotation.anchor.page !== view.pageNumber) continue;
        for (const rect of annotation.anchor.rects) {
          const highlight = element('button', `kos-reader-pdf-highlight is-${annotation.color}`);
          highlight.type = 'button';
          highlight.dataset.annotationId = annotation.id;
          highlight.title = annotation.note || annotation.text;
          highlight.style.left = `${rect.x * 100}%`;
          highlight.style.top = `${rect.y * 100}%`;
          highlight.style.width = `${rect.width * 100}%`;
          highlight.style.height = `${rect.height * 100}%`;
          view.annotationLayer.append(highlight);
        }
      }
    };

    const textForPage = async (pageToRead: number, page?: PdfPage): Promise<string> => {
      const cached = pageText.get(pageToRead);
      if (cached !== undefined) return cached;
      const content = await (page ?? await pdf.getPage(pageToRead)).getTextContent() as PdfTextContent;
      const text = (content.items ?? []).map((item) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim();
      pageText.set(pageToRead, text);
      return text;
    };

    const renderText = async (view: PdfPageView, page: PdfPage, viewport: PdfViewport) => {
      view.textLayer.empty();
      const textContent = await page.getTextContent() as PdfTextContent;
      pageText.set(view.pageNumber, (textContent.items ?? []).map((item) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim());
      if (pdfjs.TextLayer) {
        const layer = new pdfjs.TextLayer({ textContentSource: textContent, container: view.textLayer, viewport });
        await layer.render();
      } else if (pdfjs.renderTextLayer) {
        const task = pdfjs.renderTextLayer({ textContent, container: view.textLayer, viewport, textDivs: [] });
        if (task instanceof Promise) await task;
        else if (task.promise) await task.promise;
      }
    };

    const clearView = (view: PdfPageView) => {
      if (!view.rendered && !view.renderPromise) return;
      view.renderVersion += 1;
      view.renderTask?.cancel();
      view.renderTask = null;
      view.renderPromise = null;
      view.rendered = false;
      view.canvas.hidden = true;
      view.canvas.width = 1;
      view.canvas.height = 1;
      view.canvas.style.width = '';
      view.canvas.style.height = '';
      view.textLayer.empty();
      view.annotationLayer.empty();
    };

    const renderView = (view: PdfPageView): Promise<void> => {
      if (closed || view.rendered) return Promise.resolve();
      if (view.renderPromise) return view.renderPromise;
      const version = ++view.renderVersion;
      view.renderPromise = (async () => {
        const page = await pdf.getPage(view.pageNumber);
        if (closed || version !== view.renderVersion) return;
        const { base, viewport } = viewportFor(page);
        view.aspectRatio = base.width / base.height;
        view.shell.style.width = `${viewport.width}px`;
        view.shell.style.height = `${viewport.height}px`;
        view.textLayer.style.width = `${viewport.width}px`;
        view.textLayer.style.height = `${viewport.height}px`;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        view.canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        view.canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        view.canvas.style.width = `${viewport.width}px`;
        view.canvas.style.height = `${viewport.height}px`;
        view.canvas.hidden = false;
        const context = view.canvas.getContext('2d');
        if (!context) throw new Error('无法创建 PDF Canvas。');
        const renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        view.renderTask = renderTask;
        await Promise.all([renderTask.promise, renderText(view, page, viewport)]);
        if (!closed && version === view.renderVersion) {
          view.rendered = true;
          renderAnnotations(view);
        }
      })().catch((error: unknown) => {
        if (!closed && version === view.renderVersion && !cancellationError(error)) throw error;
      }).finally(() => {
        if (version === view.renderVersion) {
          view.renderTask = null;
          view.renderPromise = null;
        }
      });
      return view.renderPromise;
    };

    const renderWindow = () => {
      const first = Math.max(1, pageNumber - RENDER_BEHIND);
      const last = Math.min(pdf.numPages, pageNumber + RENDER_AHEAD);
      for (let page = first; page <= last; page += 1) {
        void renderView(pageViews[page - 1]).catch(() => undefined);
      }
      for (const view of pageViews) {
        if (Math.abs(view.pageNumber - pageNumber) > KEEP_DISTANCE) clearView(view);
      }
    };

    const setCurrentPage = (next: number) => {
      const normalized = Math.min(pdf.numPages, Math.max(1, next));
      if (normalized === pageNumber) {
        renderWindow();
        return;
      }
      pageNumber = normalized;
      input.onSelection(null);
      emit();
      renderWindow();
    };

    const pageAtScrollPosition = () => {
      const marker = input.container.scrollTop + Math.min(180, input.container.clientHeight * 0.3);
      let nearest = pageViews[0];
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const view of pageViews) {
        const top = view.shell.offsetTop;
        const bottom = top + view.shell.offsetHeight;
        if (marker >= top && marker < bottom) return view.pageNumber;
        const distance = Math.min(Math.abs(marker - top), Math.abs(marker - bottom));
        if (distance < nearestDistance) {
          nearest = view;
          nearestDistance = distance;
        }
      }
      return nearest.pageNumber;
    };

    const onScroll = () => {
      if (scrollFrame !== null) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        if (!closed) setCurrentPage(pageAtScrollPosition());
      });
    };
    input.container.addEventListener('scroll', onScroll, { passive: true });

    const onSelectionChange = () => {
      const selection = input.container.ownerDocument.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        input.onSelection(null);
        return;
      }
      const node = selection.getRangeAt(0).commonAncestorContainer;
      const origin = node.nodeType === 3 ? node.parentElement : node as Element;
      const pageShell = origin?.closest<HTMLElement>('.kos-reader-pdf-page');
      const selectedPage = Number.parseInt(pageShell?.dataset.page ?? '', 10);
      const view = Number.isFinite(selectedPage) ? pageViews[selectedPage - 1] : undefined;
      if (!view) {
        input.onSelection(null);
        return;
      }
      const value = selectionWithin(view.textLayer, `page:${selectedPage}`, `第 ${selectedPage} 页`);
      if (!value) {
        input.onSelection(null);
        return;
      }
      const shellRect = view.shell.getBoundingClientRect();
      const rects = [...selection.getRangeAt(0).getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: Math.max(0, (rect.left - shellRect.left) / shellRect.width),
          y: Math.max(0, (rect.top - shellRect.top) / shellRect.height),
          width: Math.min(1, rect.width / shellRect.width),
          height: Math.min(1, rect.height / shellRect.height),
        }));
      input.onSelection({ ...value, anchor: { format: 'pdf', page: selectedPage, rects, quote: value.text } });
    };
    input.container.ownerDocument.addEventListener('selectionchange', onSelectionChange);

    const destinationPage = async (dest: string | unknown[]): Promise<number | null> => {
      const explicit = typeof dest === 'string' ? await pdf.getDestination?.(dest) : dest;
      const ref = explicit?.[0];
      if (typeof ref === 'number') return ref + 1;
      if (ref && pdf.getPageIndex) return (await pdf.getPageIndex(ref)) + 1;
      return null;
    };

    const buildOutline = async (): Promise<ReaderTocItem[]> => {
      const outline = await pdf.getOutline?.();
      if (!outline) return [];
      const result: ReaderTocItem[] = [];
      const visit = async (items: PdfOutline[], depth: number) => {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const page = item.dest ? await destinationPage(item.dest) : null;
          if (page) result.push({ id: `${depth}-${index}-${page}`, label: item.title?.trim() || `第 ${page} 页`, target: String(page), depth });
          if (item.items?.length) await visit(item.items, depth + 1);
        }
      };
      await visit(outline, 0);
      return result;
    };

    const scrollToPage = async (next: number, behavior: ScrollBehavior = 'smooth') => {
      if (closed) return;
      const target = Math.min(pdf.numPages, Math.max(1, next));
      setCurrentPage(target);
      await renderView(pageViews[target - 1]);
      if (closed) return;
      input.container.scrollTo({
        top: Math.max(0, pageViews[target - 1].shell.offsetTop - 20),
        behavior,
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      const width = input.container.clientWidth;
      if (closed || width <= 0 || Math.abs(width - observedWidth) < 1 || resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (closed) return;
        observedWidth = input.container.clientWidth;
        for (const view of pageViews) clearView(view);
        layoutViews();
        void scrollToPage(pageNumber, 'auto').catch(() => undefined);
        renderWindow();
      });
    });

    layoutViews();
    toc = await buildOutline().catch(() => []);
    observedWidth = input.container.clientWidth;
    await renderView(pageViews[pageNumber - 1]);
    input.container.scrollTop = Math.max(0, pageViews[pageNumber - 1].shell.offsetTop - 20);
    emit();
    renderWindow();
    resizeObserver.observe(input.container);

    return {
      previous: () => scrollToPage(pageNumber - 1),
      next: () => scrollToPage(pageNumber + 1),
      goTo: (target) => {
        const annotation = target.startsWith('annotation:') ? annotations.find((item) => item.id === target.slice(11)) : undefined;
        const value = annotation?.anchor.format === 'pdf'
          ? annotation.anchor.page
          : Number.parseInt(target.replace(/^page:/, ''), 10);
        return scrollToPage(value || pageNumber);
      },
      search: async (query) => {
        const results: ReaderSearchResult[] = [];
        for (let current = 1; current <= pdf.numPages && results.length < 100; current += 1) {
          results.push(...readerSearchMatches(
            await textForPage(current), query, `page:${current}`, `第 ${current} 页`, `pdf:${current}`, 100 - results.length,
          ));
        }
        return results;
      },
      setAnnotations: (next) => {
        annotations = next;
        for (const view of pageViews) if (view.rendered) renderAnnotations(view);
      },
      getContext: async () => ({
        location: `page:${pageNumber}`,
        positionLabel: `第 ${pageNumber} 页`,
        text: readerContextText(await textForPage(pageNumber)),
      }),
      close: async () => {
        closed = true;
        resizeObserver.disconnect();
        input.container.removeEventListener('scroll', onScroll);
        input.container.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
        if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        input.onSelection(null);
        for (const view of pageViews) clearView(view);
        input.container.empty();
        await pdf.destroy();
        await loadingTask.destroy?.();
      },
    };
  }
}
