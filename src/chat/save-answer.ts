import { App, Notice, TFile } from 'obsidian';
import type { EpistemicStatus } from './epistemic';
import { statusLabel } from './epistemic';
import type { AnswerMode } from './planner';

export interface SaveAnswerInput {
	userQuestion: string;
	content: string;
	mode: AnswerMode;
	status: EpistemicStatus | null;
	searchQuery?: string;
	evidence: Array<{ path: string; title: string; heading: string }>;
}

export async function saveAnswerToVault(
	app: App,
	folder: string,
	input: SaveAnswerInput,
): Promise<TFile> {
	const dir = folder.trim() || 'Grounded Chat/Answers';
	await ensureFolder(app, dir);

	const stamp = formatStamp(new Date());
	const slug = slugify(input.searchQuery || input.userQuestion);
	const path = `${dir}/${stamp} ${slug}.md`;
	const body = formatAnswerNote(input);

	try {
		return await app.vault.create(path, body);
	} catch (error) {
		const suffix =
			error instanceof Error && /already exists/i.test(error.message)
				? `-${Date.now()}`
				: '';
		return app.vault.create(`${dir}/${stamp} ${slug}${suffix}.md`, body);
	}
}

export async function openSavedAnswer(app: App, file: TFile): Promise<void> {
	await app.workspace.getLeaf(false)?.openFile(file);
	new Notice(`Saved ${file.basename}`);
}

function formatAnswerNote(input: SaveAnswerInput): string {
	const lines: string[] = [
		'---',
		'source: grounded-chat',
		`date: ${new Date().toISOString()}`,
	];

	if (input.status) {
		lines.push(`status: ${input.status}`);
	}
	if (input.searchQuery) {
		lines.push(`search: ${JSON.stringify(input.searchQuery)}`);
	}
	lines.push('---', '', '## Question', '', input.userQuestion, '', '## Answer', '', input.content);

	if (input.mode === 'vault' && input.evidence.length > 0) {
		lines.push('', '## Evidence', '');
		for (const chunk of input.evidence) {
			const label =
				chunk.heading === chunk.title
					? chunk.title
					: `${chunk.title} › ${chunk.heading}`;
			lines.push(`- [[${chunk.title}|${label}]]`);
		}
	}

	if (input.status) {
		lines.push('', `> ${statusLabel(input.status)}`);
	}

	return `${lines.join('\n')}\n`;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	const parts = folder.split('/').filter(Boolean);
	let acc = '';
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(acc)) {
			await app.vault.createFolder(acc);
		}
	}
}

function formatStamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.split(/\s+/)
		.slice(0, 6)
		.join('-');
	return slug || 'answer';
}
