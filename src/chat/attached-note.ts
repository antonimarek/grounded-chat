import { App, TFile } from 'obsidian';
import { stripFrontmatter } from '../index/chunker';

export interface AttachedNote {
	path: string;
	title: string;
	content: string;
}

export const ATTACHED_CHAR_CAP = 24_000;

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/;

export async function loadAttachedNote(
	app: App,
	path: string,
): Promise<AttachedNote | null> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) || file.extension !== 'md') {
		return null;
	}

	const raw = await app.vault.cachedRead(file);
	let content = stripFrontmatter(raw);
	if (content.length > ATTACHED_CHAR_CAP) {
		content = `${content.slice(0, ATTACHED_CHAR_CAP)}\n…`;
	}

	return {
		path: file.path,
		title: file.basename,
		content,
	};
}

export function resolveNoteLink(app: App, linktext: string): string | null {
	const dest = app.metadataCache.getFirstLinkpathDest(linktext, '');
	const file = dest ? app.vault.getAbstractFileByPath(dest.path) : null;
	if (file instanceof TFile && file.extension === 'md') {
		return file.path;
	}
	return null;
}

export function parseLeadingNoteLink(message: string): {
	linktext: string | null;
	message: string;
} {
	const match = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*(.*)$/s.exec(message.trim());
	if (!match?.[1]) {
		return { linktext: null, message: message.trim() };
	}
	return {
		linktext: match[1].trim(),
		message: (match[2] ?? '').trim(),
	};
}

export function parseNoteMention(message: string): {
	linktext: string | null;
	path: string | null;
	message: string;
} {
	const trimmed = message.trim();
	const match = WIKILINK_RE.exec(trimmed);
	if (!match?.[1]) {
		return { linktext: null, path: null, message: trimmed };
	}
	const linktext = match[1].trim();
	return {
		linktext,
		path: null,
		message: trimmed,
	};
}

export function resolveNoteMentionPath(
	app: App,
	message: string,
): {
	linktext: string | null;
	path: string | null;
	message: string;
} {
	const parsed = parseNoteMention(message);
	if (!parsed.linktext) {
		return parsed;
	}
	const notePart = parsed.linktext.includes('#')
		? parsed.linktext.slice(0, parsed.linktext.indexOf('#'))
		: parsed.linktext;
	const path = resolveNoteLink(app, notePart.trim());
	return {
		linktext: parsed.linktext,
		path,
		message: parsed.message,
	};
}

export function wantsRelatedNoteSearch(message: string): boolean {
	return /\b(related|powi[aą]z|linki|links|search vault|szukaj|find notes|other notes|innych notatk)\b/i.test(
		message,
	);
}

export function shouldIsolateAttachedTurn(message: string): boolean {
	if (wantsRelatedNoteSearch(message)) {
		return false;
	}
	return !/\b(above|previous|earlier|wcze[sś]niej|poprzedni|o co pyta|what did i ask|this conversation|ta rozmowa)\b/i.test(
		message,
	);
}

export function relatedSearchQuery(note: AttachedNote): string {
	return note.title;
}

export function attachedNotePromptSection(note: AttachedNote): string {
	return [
		'ATTACHED NOTE (primary source for this request):',
		`Title: "${note.title}"`,
		`Path: ${note.path}`,
		'Use this note as the main input when the active skill or question refers to "this note".',
		'Do not answer about other notes unless the user explicitly asks for related notes.',
		'',
		note.content,
	].join('\n');
}
