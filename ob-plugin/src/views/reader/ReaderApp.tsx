import { setIcon } from 'obsidian';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ReaderAdapterHandle,
  ReaderAdapterState,
  ReaderLayoutMode,
  ReaderProgress,
  ReaderSelection,
} from '../../reader/model';
import type { ResolvedReaderDocument } from './source';

const EMPTY_STATE: ReaderAdapterState = {
  location: '',
  progress: null,
  positionLabel: '',
  canPrevious: false,
  canNext: false,
  toc: [],
};

interface IconProps {
  name: string;
}

function Icon({ name }: IconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} aria-hidden="true" />;
}

interface IconButtonProps {
  label: string;
  icon: string;
  disabled?: boolean;
  active?: boolean;
  preserveDocumentSelection?: boolean;
  onClick(): void;
}

function IconButton({ label, icon, disabled, active, preserveDocumentSelection, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`kos-reader-icon-button${active ? ' is-active' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={preserveDocumentSelection ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

interface SelectionActionButtonProps {
  label: string;
  busyLabel: string;
  icon: string;
  busy: boolean;
  disabled: boolean;
  onClick(): void;
}

function SelectionActionButton({ label, busyLabel, icon, busy, disabled, onClick }: SelectionActionButtonProps) {
  return (
    <button
      type="button"
      className="kos-reader-selection-action"
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{busy ? busyLabel : label}</span>
    </button>
  );
}

export interface ReaderAppProps {
  document: ResolvedReaderDocument;
  initialProgress?: ReaderProgress;
  backToInput(): void;
  saveProgress(progress: ReaderProgress): Promise<void>;
  addToExtract(selection: ReaderSelection): Promise<void>;
  addToAgent(selection: ReaderSelection): Promise<void>;
}

export function ReaderApp({ document, initialProgress, backToInput, saveProgress, addToExtract, addToAgent }: ReaderAppProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReaderAdapterHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<ReaderProgress | null>(null);
  const currentLocationRef = useRef('');
  const currentDocumentRef = useRef(document.documentPath);
  const [adapterState, setAdapterState] = useState<ReaderAdapterState>(EMPTY_STATE);
  const [epubLayoutMode, setEpubLayoutMode] = useState<ReaderLayoutMode>('scrolled');
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [selectionAction, setSelectionAction] = useState<'extract' | 'agent' | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    let mountedHandle: ReaderAdapterHandle | null = null;
    if (currentDocumentRef.current !== document.documentPath) {
      currentDocumentRef.current = document.documentPath;
      currentLocationRef.current = '';
    }
    host.empty();
    setAdapterState(EMPTY_STATE);
    setSelection(null);
    setStatus('loading');
    setError('');

    const persist = (state: ReaderAdapterState) => {
      if (!state.location) return;
      const progress: ReaderProgress = {
        kind: document.kind,
        location: state.location,
        progress: state.progress,
        updatedAt: new Date().toISOString(),
      };
      pendingProgressRef.current = progress;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        if (pendingProgressRef.current) void saveProgress(pendingProgressRef.current);
      }, 500);
    };

    void document.adapter.mount({
      container: host,
      initialLocation: currentLocationRef.current || (initialProgress?.kind === document.kind ? initialProgress.location : undefined),
      layoutMode: document.kind === 'epub' ? epubLayoutMode : undefined,
      onState: (state) => {
        if (!active) return;
        currentLocationRef.current = state.location;
        setAdapterState(state);
        persist(state);
      },
      onSelection: (value) => {
        if (active) setSelection(value);
      },
    }).then((handle) => {
      if (!active) {
        void handle.close();
        return;
      }
      mountedHandle = handle;
      handleRef.current = handle;
      setStatus('ready');
    }).catch((reason: unknown) => {
      if (!active) return;
      setStatus('error');
      setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      active = false;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingProgressRef.current) void saveProgress(pendingProgressRef.current);
      pendingProgressRef.current = null;
      handleRef.current = null;
      if (mountedHandle) void mountedHandle.close();
      else host.empty();
    };
  }, [document, epubLayoutMode, initialProgress, saveProgress]);

  const run = (action: (handle: ReaderAdapterHandle) => Promise<void>) => {
    const handle = handleRef.current;
    if (!handle) return;
    void action(handle).catch((reason: unknown) => {
      setStatus('error');
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  const runSelectionAction = (kind: 'extract' | 'agent', action: (value: ReaderSelection) => Promise<void>) => {
    if (!selection || selectionAction) return;
    setSelectionAction(kind);
    void action(selection).finally(() => setSelectionAction(null));
  };

  let overlay: ReactNode = null;
  if (status === 'loading') overlay = <div className="kos-reader-status">正在载入...</div>;
  if (status === 'error') overlay = <div className="kos-reader-status is-error">{error || '文档载入失败。'}</div>;

  return (
    <main className="kos-reader-shell">
      <header className="kos-reader-header">
        <div className="kos-reader-header-primary">
          <IconButton label="返回看板" icon="arrow-left" onClick={backToInput} />
          <div className="kos-reader-identity" title={document.documentPath}>
            <span className="kos-reader-format">{document.kind.toUpperCase()}</span>
            <h1>{document.title}</h1>
          </div>
        </div>
        <div className="kos-reader-toolbar" role="toolbar" aria-label="阅读工具栏">
          <IconButton
            label="目录"
            icon="list-tree"
            active={tocOpen}
            disabled={status !== 'ready' || adapterState.toc.length === 0}
            onClick={() => setTocOpen((open) => !open)}
          />
          {document.kind === 'epub' && (
            <IconButton
              label={epubLayoutMode === 'scrolled' ? '切换到分页阅读' : '切换到滚动阅读'}
              icon={epubLayoutMode === 'scrolled' ? 'rows-3' : 'book-open'}
              active={epubLayoutMode === 'scrolled'}
              disabled={status !== 'ready' || selectionAction !== null}
              onClick={() => setEpubLayoutMode((mode) => mode === 'scrolled' ? 'paginated' : 'scrolled')}
            />
          )}
          <IconButton
            label="添加到摘录"
            icon="notebook-pen"
            preserveDocumentSelection
            disabled={status !== 'ready' || !selection || selectionAction !== null}
            active={selectionAction === 'extract'}
            onClick={() => runSelectionAction('extract', addToExtract)}
          />
          <IconButton
            label="添加到 Agent"
            icon="message-square-plus"
            preserveDocumentSelection
            disabled={status !== 'ready' || !selection || selectionAction !== null}
            active={selectionAction === 'agent'}
            onClick={() => runSelectionAction('agent', addToAgent)}
          />
          <span className="kos-reader-toolbar-divider" aria-hidden="true" />
          <IconButton
            label="上一页"
            icon="chevron-left"
            disabled={status !== 'ready' || !adapterState.canPrevious}
            onClick={() => run((handle) => handle.previous())}
          />
          <span className="kos-reader-position" aria-live="polite">{adapterState.positionLabel}</span>
          <IconButton
            label="下一页"
            icon="chevron-right"
            disabled={status !== 'ready' || !adapterState.canNext}
            onClick={() => run((handle) => handle.next())}
          />
          {document.externalUrl && (
            <a
              className="kos-reader-icon-button"
              href={document.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="打开原文"
              title="打开原文"
            >
              <Icon name="external-link" />
            </a>
          )}
        </div>
      </header>
      <div className="kos-reader-progress-track" aria-hidden="true">
        <span style={{ width: `${Math.round((adapterState.progress ?? 0) * 100)}%` }} />
      </div>
      <div className="kos-reader-workspace">
        {tocOpen && adapterState.toc.length > 0 && (
          <aside className="kos-reader-toc" aria-label="文档目录">
            {adapterState.toc.map((item) => (
              <button
                type="button"
                key={item.id}
                style={{ paddingInlineStart: `${14 + Math.min(item.depth, 4) * 14}px` }}
                onClick={() => run((handle) => handle.goTo(item.target))}
              >
                {item.label}
              </button>
            ))}
          </aside>
        )}
        <section
          className="kos-reader-document"
          aria-label="阅读内容"
          data-reader-kind={document.kind}
          data-reader-location={adapterState.location}
        >
          <div ref={hostRef} className="kos-reader-adapter-host" />
          {status === 'ready' && selection && (
            <div className="kos-reader-selection-bar" role="toolbar" aria-label="选区操作">
              <div className="kos-reader-selection-count">
                <Icon name="text-select" />
                <span>已选择 {selection.text.length} 字</span>
              </div>
              <div className="kos-reader-selection-actions">
                <SelectionActionButton
                  label="添加到摘录"
                  busyLabel="正在添加"
                  icon="notebook-pen"
                  busy={selectionAction === 'extract'}
                  disabled={selectionAction !== null}
                  onClick={() => runSelectionAction('extract', addToExtract)}
                />
                <SelectionActionButton
                  label="添加到 Agent"
                  busyLabel="正在添加"
                  icon="message-square-plus"
                  busy={selectionAction === 'agent'}
                  disabled={selectionAction !== null}
                  onClick={() => runSelectionAction('agent', addToAgent)}
                />
              </div>
            </div>
          )}
          {overlay}
        </section>
      </div>
    </main>
  );
}
