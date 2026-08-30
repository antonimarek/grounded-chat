import { App, Notice, TFile } from 'obsidian';
import { stripFrontmatter } from '../index/chunker';
import { hashText } from '../index/hash';
import type { VaultSkill } from '../skills/types';
import { skillAllowsEdits } from '../skills/types';
import type { AttachedNote } from './attached-note';
import type { NoteProposal } from './types';

const EDIT_INTENT_RE =
	/\b(improve|rewrite|re-?gist|gist|split|edit|update|fix|polish|ulepsz|przepisz|podziel)\b/i;

const FENCE_RE = /```([^\n`]*)\r?\n([\s\S]*?)```/g;

export interface ProposalDiffStats {
	added: number;
	removed: number;
}

interface ProposalPayload {
	type?: string;
	path?: string;
	content?: string;
}

interface ProposalFence {
	fullMatch: string;
	lang: string;
	body: string;
}

export function isEditIntent(message: string): boolean {
	return EDIT_INTENT_RE.test(message);
}

export function shouldRequestProposal(params: {
	attachedNote: AttachedNote | null;
	skill: VaultSkill | null;
	userMessage: string;
}): boolean {
	if (!params.attachedNote) {
		return false;
	}
	return skillAllowsEdits(params.skill) || isEditIntent(params.userMessage);
}

export function stripProposalBlock(markdown: string): string {
	let result = markdown;
	for (const fence of findProposalFences(markdown)) {
		if (looksLikeProposal(fence.body)) {
			result = result.replace(fence.fullMatch, '');
		}
	}
	return result.trim();
}

export function hasProposalBlock(markdown: string): boolean {
	return findProposalFences(markdown).some((fence) => looksLikeProposal(fence.body));
}

export async function parseNoteProposal(
	app: App,
	markdown: string,
	expectedPath: string,
): Promise<{ proposal: NoteProposal; displayContent: string } | null> {
	const fences = findProposalFences(markdown).filter((fence) =>
		looksLikeProposal(fence.body),
	);
	if (fences.length === 0) {
		return null;
	}

	const file = app.vault.getAbstractFileByPath(expectedPath);
	if (!(file instanceof TFile)) {
		return null;
	}

	const raw = await app.vault.read(file);
	const baseBodyHash = hashText(stripFrontmatter(raw));

	for (const fence of fences) {
		const payload = parseProposalPayload(fence.body);
		if (!payload || payload.type !== 'replace_body') {
			continue;
		}
		const content = payload.content?.trim();
		if (!content) {
			continue;
		}

		return {
			proposal: {
				type: 'replace_body',
				path: expectedPath,
				content,
				baseBodyHash,
			},
			displayContent: stripProposalBlock(markdown),
		};
	}

	return null;
}

export function computeProposalDiffStats(
	before: string,
	after: string,
): ProposalDiffStats {
	const beforeCounts = lineMultiset(before.split('\n'));
	const afterCounts = lineMultiset(after.split('\n'));
	const keys = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
	let added = 0;
	let removed = 0;

	for (const key of keys) {
		const beforeCount = beforeCounts.get(key) ?? 0;
		const afterCount = afterCounts.get(key) ?? 0;
		if (afterCount > beforeCount) {
			added += afterCount - beforeCount;
		}
		if (beforeCount > afterCount) {
			removed += beforeCount - afterCount;
		}
	}

	return { added, removed };
}

export function extractFrontmatterBlock(markdown: string): string | null {
	if (!markdown.startsWith('---')) {
		return null;
	}
	const end = markdown.indexOf('\n---', 3);
	if (end === -1) {
		return null;
	}
	return markdown.slice(0, end + 4);
}

export async function applyNoteProposal(
	app: App,
	proposal: NoteProposal,
): Promise<TFile> {
	const file = app.vault.getAbstractFileByPath(proposal.path);
	if (!(file instanceof TFile)) {
		throw new Error('Attached note not found.');
	}

	const raw = await app.vault.read(file);
	const currentHash = hashText(stripFrontmatter(raw));
	if (currentHash !== proposal.baseBodyHash) {
		new Notice('Note changed since this proposal was generated.');
	}

	const frontmatter = extractFrontmatterBlock(raw);
	const body = proposal.content.trim();
	const next = frontmatter ? `${frontmatter}\n\n${body}\n` : `${body}\n`;
	await app.vault.modify(file, next);
	return file;
}

function findProposalFences(markdown: string): ProposalFence[] {
	const fences: ProposalFence[] = [];
	FENCE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FENCE_RE.exec(markdown)) !== null) {
		const lang = (match[1] ?? '').trim().toLowerCase();
		const body = match[2] ?? '';
		fences.push({
			fullMatch: match[0],
			lang,
			body,
		});
	}
	return fences;
}

function looksLikeProposal(body: string): boolean {
	const trimmed = body.trim();
	if (!trimmed) {
		return false;
	}
	if (/"type"\s*:\s*"replace_body"/.test(trimmed)) {
		return true;
	}
	if (/^\s*\{[\s\S]*"content"\s*:/.test(trimmed) && /replace_body/.test(trimmed)) {
		return true;
	}
	return false;
}

function parseProposalPayload(raw: string): ProposalPayload | null {
	const trimmed = raw.trim();
	try {
		const parsed = JSON.parse(trimmed) as ProposalPayload;
		if (parsed?.type === 'replace_body' && parsed.content) {
			return parsed;
		}
	} catch {
		// Fall back to manual field extraction for slightly invalid JSON.
	}

	if (!/"type"\s*:\s*"replace_body"/.test(trimmed)) {
		return null;
	}

	const path = extractJsonStringField(trimmed, 'path');
	const content =
		extractJsonStringField(trimmed, 'content') ??
		extractMultilineContentField(trimmed);
	if (!content) {
		return null;
	}

	return {
		type: 'replace_body',
		path: path ?? undefined,
		content,
	};
}

function extractJsonStringField(raw: string, field: string): string | null {
	const pattern = new RegExp(`"${field}"\\s*:\\s*"`, 's');
	const match = pattern.exec(raw);
	if (!match) {
		return null;
	}

	let index = match.index + match[0].length;
	let out = '';
	while (index < raw.length) {
		const ch = raw[index];
		if (ch === '\\' && index + 1 < raw.length) {
			out += decodeJsonEscape(raw[index + 1]!);
			index += 2;
			continue;
		}
		if (ch === '"') {
			return out;
		}
		out += ch;
		index += 1;
	}
	return out.length > 0 ? out : null;
}

function extractMultilineContentField(raw: string): string | null {
	const match = /"content"\s*:\s*"\s*\r?\n([\s\S]*?)\r?\n"\s*\r?\n?\s*\}/.exec(
		raw,
	);
	return match?.[1]?.trim() ?? null;
}

function decodeJsonEscape(ch: string): string {
	switch (ch) {
		case 'n':
			return '\n';
		case 't':
			return '\t';
		case 'r':
			return '\r';
		case '"':
			return '"';
		case '\\':
			return '\\';
		default:
			return ch;
	}
}

function lineMultiset(lines: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const line of lines) {
		counts.set(line, (counts.get(line) ?? 0) + 1);
	}
	return counts;
}
