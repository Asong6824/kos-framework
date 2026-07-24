import { MarkdownRenderer } from 'obsidian';
import type { App, Component, TFile } from 'obsidian';
import type { ReaderAdapter, ReaderAdapterHandle, ReaderAdapterMount, ReaderAnnotation, ReaderTocItem } from '../../../reader/model';
import { readerContextText, readerSearchMatches } from '../../../reader/model';
import { selectionWithin } from './selection';

function markAnnotations(container: HTMLElement, annotations: ReaderAnnotation[]): void {
  for (const annotation of annotations.filter((item) => item.anchor.format === 'markdown')) {
    const quote = annotation.anchor.quote;
    if (!quote) continue;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const index = (node.nodeValue ?? '').indexOf(quote);
      if (index >= 0 && node.parentElement && !node.parentElement.closest('.kos-reader-mark')) {
        const before = node.splitText(index);
        const after = before.splitText(quote.length);
        const mark = document.createElement('mark');
        mark.className = `kos-reader-mark is-${annotation.color}`;
        mark.dataset.annotationId = annotation.id;
        before.parentNode?.insertBefore(mark, before);
        mark.append(before);
        node = after;
        break;
      }
      node = walker.nextNode() as Text | null;
    }
  }
}

export class MarkdownReaderAdapter implements ReaderAdapter {
  readonly kind = 'markdown' as const;

  constructor(
    private readonly app: App,
    private readonly owner: Component,
    private readonly file: TFile,
  ) {}

  async mount(input: ReaderAdapterMount): Promise<ReaderAdapterHandle> {
    input.container.classList.add('kos-reader-markdown', 'markdown-rendered');
    const content = await this.app.vault.cachedRead(this.file);
    let annotations = input.annotations ?? [];
    let toc: ReaderTocItem[] = [];
    const render = async () => {
      input.container.empty();
      await MarkdownRenderer.render(this.app, content, input.container, this.file.path, this.owner);
      toc = [...input.container.querySelectorAll<HTMLElement>('h1, h2, h3, h4')].map((heading, index) => {
        const id = heading.id || `reader-heading-${index}`;
        heading.id = id;
        return { id, label: heading.textContent?.trim() || `章节 ${index + 1}`, target: `heading:${id}`, depth: Number(heading.tagName.slice(1)) - 1 };
      });
      markAnnotations(input.container, annotations);
      input.onState({ location: 'source:markdown', progress: null, positionLabel: 'Markdown', canPrevious: false, canNext: false, toc });
    };
    await render();
    const onSelectionChange = () => {
      const selection = selectionWithin(input.container, 'source:markdown', 'Source Markdown');
      input.onSelection(selection ? { ...selection, anchor: { format: 'markdown', quote: selection.text } } : null);
    };
    input.container.ownerDocument.addEventListener('selectionchange', onSelectionChange);
    return {
      previous: async () => undefined,
      next: async () => undefined,
      goTo: async (target) => {
        const element = target.startsWith('heading:')
          ? input.container.querySelector<HTMLElement>(`#${CSS.escape(target.slice(8))}`)
          : target.startsWith('annotation:')
            ? input.container.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(target.slice(11))}"]`)
            : null;
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      search: async (query) => readerSearchMatches(content, query, 'source:markdown', 'Markdown', 'markdown'),
      setAnnotations: async (next) => { annotations = next; await render(); },
      getContext: async () => ({ location: 'source:markdown', positionLabel: 'Markdown', text: readerContextText(content) }),
      close: () => {
        input.container.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
        input.onSelection(null);
        input.container.empty();
      },
    };
  }
}
