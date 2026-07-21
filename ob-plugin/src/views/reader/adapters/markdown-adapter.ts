import { MarkdownRenderer } from 'obsidian';
import type { App, Component, TFile } from 'obsidian';
import type { ReaderAdapter, ReaderAdapterHandle, ReaderAdapterMount } from '../../../reader/model';
import { selectionWithin } from './selection';

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
    await MarkdownRenderer.render(this.app, content, input.container, this.file.path, this.owner);
    const onSelectionChange = () => input.onSelection(selectionWithin(input.container, 'source:markdown', 'Source Markdown'));
    input.container.ownerDocument.addEventListener('selectionchange', onSelectionChange);
    input.onState({
      location: '',
      progress: null,
      positionLabel: '',
      canPrevious: false,
      canNext: false,
      toc: [],
    });
    return {
      previous: async () => undefined,
      next: async () => undefined,
      goTo: async () => undefined,
      close: () => {
        input.container.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
        input.onSelection(null);
        input.container.empty();
      },
    };
  }
}
