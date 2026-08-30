import { App, TFile } from 'obsidian';
import { stripFrontmatter } from '../index/chunker';

export interface AttachedNote {
	path: string;
	title: string;
	content: string;
}

const ATTACHED_CHAR_CAP = 24_000;

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

export function attachedNotePromptSection(note: AttachedNote): string {
	return [
		'ATTACHED NOTE (primary source for this request):',
		`Title: "${note.title}"`,
		`Path: ${note.path}`,
		'Use this note as the main input when the active skill or question refers to "this note".',
		'',
		note.content,
	].join('\n');
}
