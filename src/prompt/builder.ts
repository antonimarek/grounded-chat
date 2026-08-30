import type { RetrievedChunk } from '../index/types';
import { evidenceLinkMarkdown } from '../vault/links';

const CHUNK_CHAR_CAP = 1200;

function composePrompt(
	base: string,
	skillInstructions?: string,
	attachedNoteSection?: string,
): string {
	const sections = [skillInstructions, attachedNoteSection, base].filter(
		(section) => section && section.trim().length > 0,
	);
	return sections.join('\n\n');
}

export function buildSystemPrompt(
	evidence: RetrievedChunk[],
	skillInstructions?: string,
	attachedNoteSection?: string,
): string {
	if (evidence.length === 0) {
		return composePrompt(
			[
				'You are a vault assistant.',
				'No notes matched this question.',
				'Reply that the vault evidence is missing.',
				'Use the word UNCERTAIN.',
				'Do not invent notes, quotes, or citations.',
			].join(' '),
			skillInstructions,
			attachedNoteSection,
		);
	}

	const blocks = evidence.map((chunk, index) => {
		const body =
			chunk.text.length > CHUNK_CHAR_CAP
				? `${chunk.text.slice(0, CHUNK_CHAR_CAP)}\n…`
				: chunk.text;
		return `[${index + 1}] ${evidenceLinkMarkdown(chunk)} › ${chunk.heading}\n${body}`;
	});

	return composePrompt(
		[
			'You are a vault assistant.',
			'Answer only from EVIDENCE and any ATTACHED NOTE above.',
			'Cite notes with the exact title from evidence, including any leading or trailing spaces.',
			'Prefer path-style wikilinks from evidence when titles are ambiguous.',
			'If the evidence is incomplete, say UNCERTAIN.',
			'Do not invent facts, quotes, or sources.',
			'If you interpret, label it as interpretation.',
			'Match the language of the user question unless the active skill says otherwise.',
			'',
			'EVIDENCE:',
			blocks.join('\n\n'),
		].join('\n'),
		skillInstructions,
		attachedNoteSection,
	);
}

export function buildAttachedNoteEditPrompt(
	skillInstructions?: string,
	attachedNoteSection?: string,
	attachedPath?: string,
): string {
	const pathHint = attachedPath
		? `Use path "${attachedPath}" in the grounded-edit block.`
		: 'Use the attached note path in the grounded-edit block.';
	return composePrompt(
		[
			'You are a vault assistant.',
			'Work only on the ATTACHED NOTE above.',
			'First explain what you changed and why in normal markdown.',
			'Then emit exactly one fenced code block tagged grounded-edit containing JSON on one line or with escaped newlines in content.',
			'Use this fence opener exactly: ```grounded-edit',
			'JSON shape: {"type":"replace_body","path":"…","content":"…"}.',
			'In content use \\n for line breaks, not literal line breaks inside the JSON string.',
			'Copy the attached note path exactly into path.',
			'content must be the full new note body without frontmatter.',
			pathHint,
			'Do not claim the note was saved.',
			'Do not invent facts outside the attached note.',
			'Match the language of the attached note unless the active skill says otherwise.',
		].join(' '),
		skillInstructions,
		attachedNoteSection,
	);
}

export function buildAttachedNotePrompt(
	skillInstructions?: string,
	attachedNoteSection?: string,
): string {
	return composePrompt(
		[
			'You are a vault assistant.',
			'Work only on the ATTACHED NOTE above.',
			'Ignore earlier chat messages about other notes.',
			'Do not mention or summarize notes that are not the attached note.',
			'If the user asks to improve, re-gist, split, or rewrite, apply that to the attached note only.',
			'Do not invent facts, quotes, or sources outside the attached note.',
			'If you need related notes, say so instead of guessing.',
			'Match the language of the attached note unless the active skill says otherwise.',
		].join(' '),
		skillInstructions,
		attachedNoteSection,
	);
}

export function buildConversationPrompt(
	skillInstructions?: string,
	attachedNoteSection?: string,
): string {
	return composePrompt(
		[
			'You are a vault assistant.',
			'Answer from the conversation history and any ATTACHED NOTE above.',
			'Do not invent note content or citations.',
			'If the user asks what they asked before, quote their earlier user message.',
			'If you lack context, say UNCERTAIN.',
			'Match the language of the user question unless the active skill says otherwise.',
		].join(' '),
		skillInstructions,
		attachedNoteSection,
	);
}
