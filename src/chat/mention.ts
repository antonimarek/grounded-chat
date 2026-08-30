import { App, TFile } from 'obsidian';
import { stripFrontmatter } from '../index/chunker';
import { ATTACHED_CHAR_CAP, resolveNoteLink } from './attached-note';

export interface MentionRef {
	path: string;
	title: string;
	heading?: string;
	linktext: string;
}

export type MentionCandidate =
	| { kind: 'note'; path: string; title: string; subtitle?: string }
	| { kind: 'heading'; path: string; noteTitle: string; heading: string };

export interface MentionQuery {
	atIndex: number;
	raw: string;
	noteQuery: string;
	headingQuery: string | null;
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function mentionQueryAtCaret(
	value: string,
	caret: number,
): MentionQuery | null {
	const before = value.slice(0, caret);
	const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
	if (!match || match.index === undefined) {
		return null;
	}
	const raw = match[1] ?? '';
	const atIndex = match.index + match[0].length - raw.length - 1;
	const hashIndex = raw.indexOf('#');
	if (hashIndex >= 0) {
		return {
			atIndex,
			raw,
			noteQuery: raw.slice(0, hashIndex),
			headingQuery: raw.slice(hashIndex + 1),
		};
	}
	return {
		atIndex,
		raw,
		noteQuery: raw,
		headingQuery: null,
	};
}

export function rankMentionCandidates(
	app: App,
	query: MentionQuery,
	activePath: string | null,
	recentPaths: string[],
): MentionCandidate[] {
	if (query.headingQuery !== null) {
		return rankHeadingCandidates(app, query.noteQuery, query.headingQuery);
	}

	const noteQuery = query.noteQuery.trim().toLowerCase();
	if (!noteQuery) {
		return rankDefaultCandidates(app, activePath, recentPaths);
	}

	return rankNoteSearch(app, noteQuery);
}

function rankDefaultCandidates(
	app: App,
	activePath: string | null,
	recentPaths: string[],
): MentionCandidate[] {
	const seen = new Set<string>();
	const results: MentionCandidate[] = [];

	const addPath = (path: string, subtitle?: string): void => {
		if (seen.has(path)) {
			return;
		}
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== 'md') {
			return;
		}
		seen.add(path);
		results.push({
			kind: 'note',
			path,
			title: file.basename,
			subtitle,
		});
	};

	if (activePath) {
		addPath(activePath, 'Active note');
	}

	for (const path of recentPaths) {
		if (results.length >= 8) {
			break;
		}
		addPath(path, 'Recent');
	}

	return results;
}

function rankNoteSearch(app: App, query: string): MentionCandidate[] {
	const results: MentionCandidate[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const basename = file.basename.toLowerCase();
		const pathLower = file.path.toLowerCase();
		if (!basename.includes(query) && !pathLower.includes(query)) {
			continue;
		}
		results.push({
			kind: 'note',
			path: file.path,
			title: file.basename,
			subtitle: parentFolder(file.path),
		});
		if (results.length >= 10) {
			break;
		}
	}
	return results;
}

function rankHeadingCandidates(
	app: App,
	noteQuery: string,
	headingQuery: string,
): MentionCandidate[] {
	const notePath = resolveNoteLink(app, noteQuery.trim());
	if (!notePath) {
		return [];
	}
	const file = app.vault.getAbstractFileByPath(notePath);
	if (!(file instanceof TFile)) {
		return [];
	}
	const cache = app.metadataCache.getFileCache(file);
	const headings = cache?.headings ?? [];
	const lower = headingQuery.trim().toLowerCase();
	const noteTitle = file.basename;

	const filtered = lower
		? headings.filter((heading) =>
				heading.heading.toLowerCase().includes(lower),
			)
		: headings;

	return filtered.slice(0, 10).map((heading) => ({
		kind: 'heading' as const,
		path: notePath,
		noteTitle,
		heading: heading.heading,
	}));
}

function parentFolder(path: string): string {
	const parts = path.split('/');
	if (parts.length <= 1) {
		return '/';
	}
	return parts.slice(0, -1).join('/');
}

export function mentionInsert(candidate: MentionCandidate): string {
	if (candidate.kind === 'heading') {
		return `[[${candidate.noteTitle}#${candidate.heading}]]`;
	}
	return `[[${candidate.title}]]`;
}

export function mentionRefFromCandidate(
	candidate: MentionCandidate,
): MentionRef {
	if (candidate.kind === 'heading') {
		const linktext = `${candidate.noteTitle}#${candidate.heading}`;
		return {
			path: candidate.path,
			title: candidate.noteTitle,
			heading: candidate.heading,
			linktext,
		};
	}
	return {
		path: candidate.path,
		title: candidate.title,
		linktext: candidate.title,
	};
}

export function applyMentionPick(
	inputEl: HTMLTextAreaElement,
	atIndex: number,
	caret: number,
	insert: string,
): void {
	const value = inputEl.value;
	const before = value.slice(0, atIndex);
	const after = value.slice(caret);
	const text = `${before}${insert} `;
	inputEl.value = text + after;
	const pos = text.length;
	inputEl.focus();
	inputEl.setSelectionRange(pos, pos);
}

export function parseWikilinks(message: string): string[] {
	const links: string[] = [];
	let match: RegExpExecArray | null;
	const re = new RegExp(WIKILINK_RE.source, 'g');
	while ((match = re.exec(message)) !== null) {
		if (match[1]) {
			links.push(match[1].trim());
		}
	}
	return links;
}

export function mentionRefKey(ref: MentionRef): string {
	return ref.heading ? `${ref.path}#${ref.heading}` : ref.path;
}

export function mentionRefsEqual(a: MentionRef, b: MentionRef): boolean {
	return mentionRefKey(a) === mentionRefKey(b);
}

export async function resolveMentionRef(
	app: App,
	linktext: string,
): Promise<MentionRef | null> {
	const hashIndex = linktext.indexOf('#');
	const notePart = hashIndex >= 0 ? linktext.slice(0, hashIndex) : linktext;
	const heading =
		hashIndex >= 0 ? linktext.slice(hashIndex + 1).trim() : undefined;
	const path = resolveNoteLink(app, notePart.trim());
	if (!path) {
		return null;
	}
	const file = app.vault.getAbstractFileByPath(path);
	const title = file?.name.replace(/\.md$/i, '') ?? notePart.trim();
	return {
		path,
		title,
		heading: heading || undefined,
		linktext: linktext.trim(),
	};
}

export async function syncMentionsFromText(
	app: App,
	message: string,
): Promise<MentionRef[]> {
	const linktexts = parseWikilinks(message);
	const refs: MentionRef[] = [];
	const seen = new Set<string>();
	for (const linktext of linktexts) {
		const ref = await resolveMentionRef(app, linktext);
		if (!ref) {
			continue;
		}
		const key = mentionRefKey(ref);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		refs.push(ref);
	}
	return refs;
}

export function removeWikilinkFromText(
	message: string,
	linktext: string,
): string {
	const escaped = linktext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`\\[\\[${escaped}(?:\\|[^\\]]+)?\\]\\]\\s*`);
	return message.replace(re, '').trim();
}

export async function estimateNoteSize(
	app: App,
	path: string,
): Promise<number> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) || file.extension !== 'md') {
		return 0;
	}
	const raw = await app.vault.cachedRead(file);
	return stripFrontmatter(raw).length;
}

export function formatNoteSizeHint(size: number): string | null {
	if (size <= 0) {
		return null;
	}
	if (size > ATTACHED_CHAR_CAP) {
		return `~${formatChars(ATTACHED_CHAR_CAP)} chars (truncated at send)`;
	}
	if (size >= 1000) {
		return `~${formatChars(size)} chars`;
	}
	return null;
}

function formatChars(n: number): string {
	if (n >= 1000) {
		return `${Math.round(n / 1000)}k`;
	}
	return String(n);
}

export function mentionChipLabel(ref: MentionRef): string {
	if (ref.heading) {
		return `${ref.title} › ${ref.heading}`;
	}
	return ref.title;
}
