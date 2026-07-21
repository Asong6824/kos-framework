export type ReaderDocumentKind = 'markdown' | 'pdf' | 'epub';
export type ReaderLayoutMode = 'scrolled' | 'paginated';

export interface ReaderProgress {
  kind: ReaderDocumentKind;
  location: string;
  progress: number | null;
  updatedAt: string;
}

export const MAX_READER_SELECTION_LENGTH = 20_000;

export interface ReaderSelection {
  text: string;
  location: string;
  positionLabel: string;
}

export interface ReaderExcerpt {
  sourcePath: string;
  documentPath: string;
  title: string;
  kind: ReaderDocumentKind;
  selection: ReaderSelection;
}

export interface ReaderSourceReference {
  documentReference: string | null;
  externalUrl: string | null;
}

export interface ReaderTocItem {
  id: string;
  label: string;
  target: string;
  depth: number;
}

export interface ReaderAdapterState {
  location: string;
  progress: number | null;
  positionLabel: string;
  canPrevious: boolean;
  canNext: boolean;
  toc: ReaderTocItem[];
}

export interface ReaderAdapterHandle {
  previous(): Promise<void>;
  next(): Promise<void>;
  goTo(target: string): Promise<void>;
  close(): Promise<void> | void;
}

export interface ReaderAdapterMount {
  container: HTMLElement;
  initialLocation?: string;
  layoutMode?: ReaderLayoutMode;
  onState(state: ReaderAdapterState): void;
  onSelection(selection: ReaderSelection | null): void;
}

export interface ReaderAdapter {
  readonly kind: ReaderDocumentKind;
  mount(input: ReaderAdapterMount): Promise<ReaderAdapterHandle>;
}

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const READER_EXTENSIONS = new Set(['md', 'pdf', 'epub']);

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeReaderSelectionText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function readerSelectionFromText(
  text: string,
  location: string,
  positionLabel: string,
): ReaderSelection | null {
  const normalized = normalizeReaderSelectionText(text);
  if (!normalized) return null;
  return { text: normalized, location, positionLabel };
}

function wikiLink(path: string): string {
  return `[[${path.replace(/\.md$/i, '')}]]`;
}

export function formatReaderAgentQuote(excerpt: ReaderExcerpt): string {
  const quote = excerpt.selection.text.split('\n').map((line) => `> ${line}`).join('\n');
  const location = excerpt.selection.positionLabel || excerpt.selection.location || '位置未记录';
  const document = excerpt.documentPath === excerpt.sourcePath ? '' : ` · ${wikiLink(excerpt.documentPath)}`;
  return [
    quote,
    '',
    `来源：${wikiLink(excerpt.sourcePath)}${document} · ${location}`,
  ].join('\n');
}

export function unwrapReaderReference(value: string): string {
  let result = value.trim();
  if (result.startsWith('<') && result.endsWith('>')) result = result.slice(1, -1).trim();
  if (result.startsWith('[[') && result.endsWith(']]')) {
    result = result.slice(2, -2);
    const alias = result.indexOf('|');
    if (alias >= 0) result = result.slice(0, alias);
  }
  return result.trim();
}

export function readerDocumentKind(path: string): ReaderDocumentKind | null {
  const clean = path.split(/[?#]/, 1)[0].toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = clean.slice(dot + 1);
  return READER_EXTENSIONS.has(extension) ? extension as ReaderDocumentKind : null;
}

export function readerSourceReference(frontmatter: Record<string, unknown> | null | undefined): ReaderSourceReference {
  const sourceLocation = optionalString(frontmatter?.source_location);
  const sourceUrl = optionalString(frontmatter?.source_url);
  if (sourceLocation) {
    const reference = unwrapReaderReference(sourceLocation);
    return URL_SCHEME.test(reference)
      ? { documentReference: null, externalUrl: reference }
      : { documentReference: reference, externalUrl: sourceUrl };
  }
  if (!sourceUrl) return { documentReference: null, externalUrl: null };
  const reference = unwrapReaderReference(sourceUrl);
  if (URL_SCHEME.test(reference)) return { documentReference: null, externalUrl: reference };
  if (readerDocumentKind(reference)) return { documentReference: reference, externalUrl: null };
  return { documentReference: null, externalUrl: reference };
}

function normalizeVaultPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export function readerPathCandidates(reference: string, sourcePath: string): string[] {
  const clean = unwrapReaderReference(reference).split('#', 1)[0];
  const sourceDir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
  const root = normalizeVaultPath(clean.replace(/^\//, ''));
  const relative = normalizeVaultPath(`${sourceDir}/${clean}`);
  const relativeFirst = clean.startsWith('./') || clean.startsWith('../');
  return [...new Set(relativeFirst ? [relative, root] : [root, relative])].filter(Boolean);
}

export function clampReaderProgress(progress: number | null | undefined): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.min(1, Math.max(0, progress));
}

export function normalizeReaderProgressRecord(value: unknown): Record<string, ReaderProgress> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, ReaderProgress> = {};
  for (const [sourcePath, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const entry = candidate as Record<string, unknown>;
    if (entry.kind !== 'markdown' && entry.kind !== 'pdf' && entry.kind !== 'epub') continue;
    if (typeof entry.location !== 'string' || typeof entry.updatedAt !== 'string') continue;
    const rawProgress = entry.progress;
    if (rawProgress !== null && typeof rawProgress !== 'number') continue;
    result[sourcePath] = {
      kind: entry.kind,
      location: entry.location,
      progress: clampReaderProgress(rawProgress),
      updatedAt: entry.updatedAt,
    };
  }
  return result;
}
