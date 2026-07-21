import {
  getFrontMatterInfo,
  normalizePath,
  parseYaml,
  stringifyYaml,
  TFile,
} from 'obsidian';
import type { App } from 'obsidian';
import { sanitizeFileName } from '../../actions/capture';
import { ensureFolder } from '../../actions/create';
import type { ObjectDirs } from '../../core/model';
import { readerDocumentKind, readerPathCandidates, readerSourceReference } from '../../reader/model';

const BOOK_SOURCE_TEMPLATE = '90_系统/模板/BookSource_书籍输入源模板.md';

export interface ReaderSourceAssociation {
  sourcePath: string;
  created: boolean;
}

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

async function findAssociatedSource(app: App, documentPath: string): Promise<TFile | null> {
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (frontmatter?.type !== 'source') continue;
    const reference = readerSourceReference(frontmatter);
    if (!reference.documentReference) continue;
    if (readerPathCandidates(reference.documentReference, file.path).includes(documentPath)) return file;
  }
  return null;
}

async function availableSourcePath(app: App, directory: string, title: string): Promise<string> {
  const base = sanitizeFileName(title) || '未命名书籍';
  let suffix = 1;
  while (true) {
    const name = suffix === 1 ? base : `${base} (${suffix})`;
    const path = normalizePath(`${directory}/${name}.md`);
    if (!(await app.vault.adapter.exists(path))) return path;
    suffix += 1;
  }
}

function defaultTemplate(): string {
  return [
    '---',
    'type: source',
    'format: book',
    'title: "书名"',
    'author: ""',
    'source_url: ""',
    'source_location: ""',
    'created: YYYY-MM-DD',
    'status: captured',
    'related_topics: []',
    'related_projects: []',
    'importance: medium',
    'summary_file: ""',
    'extract_file: ""',
    'tags: [book]',
    '---',
    '# 书名',
    '',
    '## 阅读目的',
    '',
    '<!-- human-notes:start -->',
    '- 我为什么读这本书：',
    '- 希望解决的问题：',
    '<!-- human-notes:end -->',
    '',
  ].join('\n');
}

async function sourceContent(app: App, document: TFile): Promise<string> {
  const templateFile = app.vault.getFileByPath(BOOK_SOURCE_TEMPLATE);
  const template = templateFile instanceof TFile
    ? await app.vault.cachedRead(templateFile)
    : defaultTemplate();
  const info = getFrontMatterInfo(template);
  const parsed = info.exists ? parseYaml(info.frontmatter) : {};
  const frontmatter = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  frontmatter.type = 'source';
  frontmatter.format = 'book';
  frontmatter.title = document.basename;
  frontmatter.source_location = `[[${document.path}]]`;
  frontmatter.created = localDate();
  frontmatter.status = 'captured';
  frontmatter.importance = 'medium';
  frontmatter.tags = ['book'];
  const body = (info.exists ? template.slice(info.contentStart) : template)
    .replace(/^# 书名[ \t]*$/m, `# ${document.basename}`)
    .replace(/^- 书名：[ \t]*$/m, `- 书名：${document.basename}`)
    .replace(/^- 来源链接或位置：[ \t]*$/m, `- 来源链接或位置：[[${document.path}]]`);
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n${body.replace(/^\r?\n/, '')}`;
}

export async function ensureReaderSource(
  app: App,
  dirs: ObjectDirs,
  documentPath: string,
): Promise<ReaderSourceAssociation> {
  const document = app.vault.getFileByPath(documentPath);
  const kind = readerDocumentKind(documentPath);
  if (!(document instanceof TFile) || (kind !== 'pdf' && kind !== 'epub')) {
    throw new Error('Reader 只能为 Vault 内的 PDF 或 EPUB 建立 Source。');
  }

  const existing = await findAssociatedSource(app, document.path);
  if (existing) return { sourcePath: existing.path, created: false };

  await ensureFolder(app, dirs.source);
  const sourcePath = await availableSourcePath(app, dirs.source, document.basename);
  await app.vault.create(sourcePath, await sourceContent(app, document));
  return { sourcePath, created: true };
}
