import { setIcon } from 'obsidian';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  ReaderAdapterHandle,
  ReaderAdapterState,
  ReaderAnnotation,
  ReaderAnnotationColor,
  ReaderContext,
  ReaderLayoutMode,
  ReaderProgress,
  ReaderSearchResult,
  ReaderSelection,
} from '../../reader/model';
import type { ResolvedReaderDocument } from './source';

const EMPTY_STATE: ReaderAdapterState = {
  location: '', progress: null, positionLabel: '', canPrevious: false, canNext: false, toc: [],
};
const COLORS: ReaderAnnotationColor[] = ['yellow', 'red', 'blue', 'green'];
type PanelMode = 'toc' | 'search' | 'annotations' | 'summary' | null;

function Icon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (ref.current) setIcon(ref.current, name); }, [name]);
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
    <button type="button" className={`kos-reader-icon-button${active ? ' is-active' : ''}`} aria-label={label} title={label}
      disabled={disabled} onPointerDown={preserveDocumentSelection ? (event) => event.preventDefault() : undefined} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

function SelectionActionButton({ label, busyLabel, icon, busy, disabled, onClick }: {
  label: string; busyLabel: string; icon: string; busy: boolean; disabled: boolean; onClick(): void;
}) {
  return (
    <button type="button" className="kos-reader-selection-action" disabled={disabled}
      onPointerDown={(event) => event.preventDefault()} onClick={onClick}>
      <Icon name={icon} /><span>{busy ? busyLabel : label}</span>
    </button>
  );
}

export interface ReaderAppProps {
  document: ResolvedReaderDocument;
  initialProgress?: ReaderProgress;
  initialAnnotations: ReaderAnnotation[];
  backToInput(): void;
  saveProgress(progress: ReaderProgress): Promise<void>;
  addAnnotation(selection: ReaderSelection, note: string, color: ReaderAnnotationColor): Promise<ReaderAnnotation>;
  deleteAnnotation(annotation: ReaderAnnotation): Promise<void>;
  addToAgent(selection: ReaderSelection): Promise<void>;
  summarize(context: ReaderContext, annotations: ReaderAnnotation[], mode: 'section' | 'session'): Promise<void>;
}

export function ReaderApp(props: ReaderAppProps) {
  const { document, initialProgress, initialAnnotations, backToInput, saveProgress, addAnnotation, deleteAnnotation, addToAgent, summarize } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReaderAdapterHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<ReaderProgress | null>(null);
  const currentLocationRef = useRef('');
  const currentDocumentRef = useRef(document.documentPath);
  const annotationsRef = useRef(initialAnnotations);
  const [adapterState, setAdapterState] = useState<ReaderAdapterState>(EMPTY_STATE);
  const [epubLayoutMode, setEpubLayoutMode] = useState<ReaderLayoutMode>('scrolled');
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [selectionAction, setSelectionAction] = useState<'highlight' | 'annotation' | 'agent' | null>(null);
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [sessionAnnotationIds, setSessionAnnotationIds] = useState<Set<string>>(() => new Set());
  const [panel, setPanel] = useState<PanelMode>(null);
  const [annotationComposer, setAnnotationComposer] = useState(false);
  const [annotationNote, setAnnotationNote] = useState('');
  const [annotationColor, setAnnotationColor] = useState<ReaderAnnotationColor>('yellow');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => { annotationsRef.current = annotations; void handleRef.current?.setAnnotations(annotations); }, [annotations]);

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
      pendingProgressRef.current = { kind: document.kind, location: state.location, progress: state.progress, updatedAt: new Date().toISOString() };
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
      annotations: annotationsRef.current,
      onState: (state) => { if (active) { currentLocationRef.current = state.location; setAdapterState(state); persist(state); } },
      onSelection: (value) => { if (active) { setSelection(value); setAnnotationComposer(false); } },
    }).then((handle) => {
      if (!active) { void handle.close(); return; }
      mountedHandle = handle;
      handleRef.current = handle;
      setStatus('ready');
    }).catch((reason: unknown) => {
      if (active) { setStatus('error'); setError(reason instanceof Error ? reason.message : String(reason)); }
    });

    return () => {
      active = false;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (pendingProgressRef.current) void saveProgress(pendingProgressRef.current);
      pendingProgressRef.current = null;
      handleRef.current = null;
      if (mountedHandle) void mountedHandle.close(); else host.empty();
    };
  }, [document, epubLayoutMode, initialProgress, saveProgress]);

  const showError = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const run = (action: (handle: ReaderAdapterHandle) => Promise<void>) => {
    const handle = handleRef.current;
    if (handle) {
      setError('');
      void action(handle).catch(showError);
    }
  };
  const togglePanel = (next: Exclude<PanelMode, null>) => setPanel((current) => current === next ? null : next);

  const persistAnnotation = (note: string, color: ReaderAnnotationColor, action: 'highlight' | 'annotation') => {
    if (!selection || selectionAction) return;
    setError('');
    setSelectionAction(action);
    void addAnnotation(selection, note, color).then((saved) => {
      setAnnotations((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setSessionAnnotationIds((current) => new Set(current).add(saved.id));
      setAnnotationComposer(false);
      setAnnotationNote('');
    }).catch(showError).finally(() => setSelectionAction(null));
  };

  const sendSelection = () => {
    if (!selection || selectionAction) return;
    setError('');
    setSelectionAction('agent');
    void addToAgent(selection).catch(showError).finally(() => setSelectionAction(null));
  };

  const removeAnnotation = (annotation: ReaderAnnotation) => {
    setError('');
    void deleteAnnotation(annotation).then(() => {
      setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
      setSessionAnnotationIds((current) => {
        const next = new Set(current);
        next.delete(annotation.id);
        return next;
      });
    }).catch(showError);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const handle = handleRef.current;
    if (!handle || !searchQuery.trim()) return;
    setError('');
    setSearching(true);
    void handle.search(searchQuery).then(setSearchResults).catch(showError).finally(() => setSearching(false));
  };

  const runSummary = (mode: 'section' | 'session') => {
    const handle = handleRef.current;
    if (!handle) return;
    setError('');
    const evidence = mode === 'session' ? annotations.filter((item) => sessionAnnotationIds.has(item.id)) : annotations;
    void handle.getContext().then((context) => summarize(context, evidence, mode)).catch(showError);
  };

  let overlay: ReactNode = null;
  if (status === 'loading') overlay = <div className="kos-reader-status">正在载入...</div>;
  if (status === 'error') overlay = <div className="kos-reader-status is-error">{error || '文档载入失败。'}</div>;

  return (
    <main className="kos-reader-shell">
      <header className="kos-reader-header">
        <div className="kos-reader-header-primary">
          <IconButton label="返回看板" icon="arrow-left" onClick={backToInput} />
          <div className="kos-reader-identity" title={document.documentPath}><span className="kos-reader-format">{document.kind.toUpperCase()}</span><h1>{document.title}</h1></div>
        </div>
        <div className="kos-reader-toolbar" role="toolbar" aria-label="阅读工具栏">
          <IconButton label="目录" icon="list-tree" active={panel === 'toc'} disabled={status !== 'ready' || adapterState.toc.length === 0} onClick={() => togglePanel('toc')} />
          <IconButton label="搜索" icon="search" active={panel === 'search'} disabled={status !== 'ready'} onClick={() => togglePanel('search')} />
          <IconButton label="划线与批注" icon="highlighter" active={panel === 'annotations'} disabled={status !== 'ready'} onClick={() => togglePanel('annotations')} />
          <IconButton label="阅读摘要" icon="sparkles" active={panel === 'summary'} disabled={status !== 'ready'} onClick={() => togglePanel('summary')} />
          {document.kind === 'epub' && <IconButton label={epubLayoutMode === 'scrolled' ? '切换到分页阅读' : '切换到滚动阅读'} icon={epubLayoutMode === 'scrolled' ? 'rows-3' : 'book-open'} active={epubLayoutMode === 'scrolled'} disabled={status !== 'ready'} onClick={() => setEpubLayoutMode((mode) => mode === 'scrolled' ? 'paginated' : 'scrolled')} />}
          <span className="kos-reader-toolbar-divider" aria-hidden="true" />
          <IconButton label="上一页" icon="chevron-left" disabled={status !== 'ready' || !adapterState.canPrevious} onClick={() => run((handle) => handle.previous())} />
          <span className="kos-reader-position" aria-live="polite">{adapterState.positionLabel}</span>
          <IconButton label="下一页" icon="chevron-right" disabled={status !== 'ready' || !adapterState.canNext} onClick={() => run((handle) => handle.next())} />
          {document.externalUrl && <a className="kos-reader-icon-button" href={document.externalUrl} target="_blank" rel="noopener noreferrer" aria-label="打开原文" title="打开原文"><Icon name="external-link" /></a>}
        </div>
      </header>
      <div className="kos-reader-progress-track" aria-hidden="true"><span style={{ width: `${Math.round((adapterState.progress ?? 0) * 100)}%` }} /></div>
      {status === 'ready' && error && <div className="kos-reader-action-error" role="alert"><span>{error}</span><IconButton label="关闭错误" icon="x" onClick={() => setError('')} /></div>}
      <div className="kos-reader-workspace">
        {panel && <aside className="kos-reader-panel" aria-label="阅读工具面板">
          <div className="kos-reader-panel-head"><strong>{panel === 'toc' ? '目录' : panel === 'search' ? '搜索' : panel === 'annotations' ? `划线与批注 · ${annotations.length}` : '阅读摘要'}</strong><IconButton label="关闭面板" icon="x" onClick={() => setPanel(null)} /></div>
          {panel === 'toc' && <nav className="kos-reader-toc">{adapterState.toc.map((item) => <button type="button" key={item.id} style={{ paddingInlineStart: `${14 + Math.min(item.depth, 4) * 14}px` }} onClick={() => run((handle) => handle.goTo(item.target))}>{item.label}</button>)}</nav>}
          {panel === 'search' && <div className="kos-reader-search"><form onSubmit={submitSearch}><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索当前文档" aria-label="搜索当前文档" /><button type="submit" disabled={searching || !searchQuery.trim()}><Icon name="search" /></button></form><div className="kos-reader-result-count">{searching ? '正在搜索' : `${searchResults.length} 个结果`}</div>{searchResults.map((result) => <button type="button" className="kos-reader-search-result" key={result.id} onClick={() => run((handle) => handle.goTo(result.location))}><span>{result.positionLabel}</span><p>{result.excerpt}</p></button>)}</div>}
          {panel === 'annotations' && <div className="kos-reader-annotations">{annotations.length === 0 && <p className="kos-reader-panel-empty">选择原文后可创建划线或批注。</p>}{annotations.map((item) => <article key={item.id} className={`kos-reader-annotation is-${item.color}`}><button type="button" className="kos-reader-annotation-main" onClick={() => run((handle) => handle.goTo(item.kind === 'markdown' ? `annotation:${item.id}` : item.location))}><span>{item.positionLabel || item.location}</span><blockquote>{item.text}</blockquote>{item.note && <p>{item.note}</p>}</button><IconButton label="删除批注" icon="trash-2" onClick={() => removeAnnotation(item)} /></article>)}</div>}
          {panel === 'summary' && <div className="kos-reader-summary-actions"><button type="button" onClick={() => runSummary('section')}><Icon name="scan-text" /><span>总结当前页或章节</span></button><button type="button" onClick={() => runSummary('session')} disabled={sessionAnnotationIds.size === 0}><Icon name="notebook-tabs" /><span>总结本次阅读</span></button></div>}
        </aside>}
        <section className="kos-reader-document" aria-label="阅读内容" data-reader-kind={document.kind} data-reader-location={adapterState.location}>
          <div ref={hostRef} className="kos-reader-adapter-host" />
          {status === 'ready' && selection && <div className="kos-reader-selection-bar" role="toolbar" aria-label="选区操作">
            {!annotationComposer ? <>
              <div className="kos-reader-selection-count"><Icon name="text-select" /><span>已选择 {selection.text.length} 字</span></div>
              <div className="kos-reader-selection-actions">
                <SelectionActionButton label="划线" busyLabel="正在保存" icon="highlighter" busy={selectionAction === 'highlight'} disabled={selectionAction !== null} onClick={() => persistAnnotation('', 'yellow', 'highlight')} />
                <SelectionActionButton label="批注" busyLabel="正在保存" icon="message-square-text" busy={selectionAction === 'annotation'} disabled={selectionAction !== null} onClick={() => setAnnotationComposer(true)} />
                <SelectionActionButton label="添加到 Agent" busyLabel="正在添加" icon="message-square-plus" busy={selectionAction === 'agent'} disabled={selectionAction !== null} onClick={sendSelection} />
              </div>
              </> : <div className="kos-reader-annotation-composer">
                <input value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} placeholder="写下批注" maxLength={2000} autoFocus />
                <div className="kos-reader-color-swatches" aria-label="批注颜色">{COLORS.map((color) => <button type="button" key={color} className={`is-${color}${annotationColor === color ? ' is-selected' : ''}`} aria-label={color} onClick={() => setAnnotationColor(color)} />)}</div>
                <button type="button" className="kos-reader-annotation-save" disabled={!annotationNote.trim() || selectionAction !== null} onClick={() => persistAnnotation(annotationNote, annotationColor, 'annotation')}>保存</button>
                <IconButton label="取消批注" icon="x" onClick={() => setAnnotationComposer(false)} />
              </div>}
          </div>}
          {overlay}
        </section>
      </div>
    </main>
  );
}
