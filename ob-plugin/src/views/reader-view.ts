import { ItemView } from 'obsidian';
import type { ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ReaderExcerpt, ReaderProgress, ReaderSelection } from '../reader/model';
import { ReaderApp } from './reader/ReaderApp';
import { resolveDirectReaderDocument, resolveReaderDocument } from './reader/source';

export const READER_VIEW_TYPE = 'kos-reader';

export interface ReaderViewDeps {
  backToInput(): Promise<void>;
  getProgress(path: string): ReaderProgress | undefined;
  saveProgress(path: string, progress: ReaderProgress): Promise<void>;
  ensureSource(documentPath: string): Promise<string>;
  addToExtract(excerpt: ReaderExcerpt): Promise<void>;
  addToAgent(excerpt: ReaderExcerpt): Promise<void>;
}

interface ReaderState extends Record<string, unknown> {
  path?: string;
  file?: string;
}

export class ReaderView extends ItemView {
  private sourcePath = '';
  private documentPath = '';
  private root: Root | null = null;
  private renderVersion = 0;
  private stateVersion = 0;

  constructor(leaf: WorkspaceLeaf, private readonly deps: ReaderViewDeps) {
    super(leaf);
  }

  getViewType(): string { return READER_VIEW_TYPE; }
  getDisplayText(): string {
    const path = this.documentPath || this.sourcePath;
    return path ? `阅读 · ${path.split('/').pop()?.replace(/\.(md|epub)$/i, '')}` : 'kos Reader';
  }
  getIcon(): string { return 'book-open'; }
  getState(): ReaderState { return this.documentPath ? { file: this.documentPath } : { path: this.sourcePath }; }

  async setState(state: ReaderState, result: ViewStateResult): Promise<void> {
    const version = ++this.stateVersion;
    this.documentPath = typeof state.file === 'string' ? state.file : '';
    this.sourcePath = typeof state.path === 'string' ? state.path : '';
    await super.setState(state, result);
    if (this.documentPath) {
      const root = this.ensureRoot();
      root.render(createElement('div', { className: 'kos-reader-status' }, '正在关联 Source...'));
      try {
        const sourcePath = await this.deps.ensureSource(this.documentPath);
        if (version !== this.stateVersion) return;
        this.sourcePath = sourcePath;
      } catch (error) {
        if (version !== this.stateVersion) return;
        root.render(createElement('div', { className: 'kos-reader-status is-error' }, error instanceof Error ? error.message : String(error)));
        return;
      }
    }
    await this.renderReader();
  }

  async onOpen(): Promise<void> {
    await this.renderReader();
  }

  async onClose(): Promise<void> {
    this.renderVersion += 1;
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }

  async openSource(path: string): Promise<void> {
    this.stateVersion += 1;
    this.documentPath = '';
    this.sourcePath = path;
    await this.leaf.setViewState({ type: READER_VIEW_TYPE, active: true, state: { path } });
  }

  async openDocument(path: string): Promise<void> {
    await this.leaf.setViewState({ type: READER_VIEW_TYPE, active: true, state: { file: path } });
  }

  private ensureRoot(): Root {
    if (!this.root) {
      this.contentEl.empty();
      this.contentEl.addClass('kos-reader-view');
      this.root = createRoot(this.contentEl);
    }
    return this.root;
  }

  private async renderReader(): Promise<void> {
    const version = ++this.renderVersion;
    const root = this.ensureRoot();
    if (!this.sourcePath) {
      root.render(createElement('div', { className: 'kos-reader-status is-empty' }, '尚未选择 Source。'));
      return;
    }

    root.render(createElement('div', { className: 'kos-reader-status' }, '正在载入...'));
    const resolution = this.documentPath
      ? resolveDirectReaderDocument(this.app, this, this.sourcePath, this.documentPath)
      : await resolveReaderDocument(this.app, this, this.sourcePath);
    if (version !== this.renderVersion) return;
    if (!resolution.ok) {
      root.render(createElement('div', { className: 'kos-reader-status is-error' }, resolution.message));
      return;
    }

    const sourcePath = resolution.document.sourcePath;
    const excerpt = (selection: ReaderSelection): ReaderExcerpt => ({
      sourcePath,
      documentPath: resolution.document.documentPath,
      title: resolution.document.title,
      kind: resolution.document.kind,
      selection,
    });
    root.render(createElement(ReaderApp, {
      document: resolution.document,
      initialProgress: this.deps.getProgress(sourcePath),
      backToInput: () => void this.deps.backToInput(),
      saveProgress: (progress: ReaderProgress) => this.deps.saveProgress(sourcePath, progress),
      addToExtract: (selection: ReaderSelection) => this.deps.addToExtract(excerpt(selection)),
      addToAgent: (selection: ReaderSelection) => this.deps.addToAgent(excerpt(selection)),
    }));
  }
}
