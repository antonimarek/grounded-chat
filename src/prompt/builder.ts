import type { RetrievedChunk } from '../index/types';

const CHUNK_CHAR_CAP = 1200;

export function buildSystemPrompt(evidence: RetrievedChunk[]): string {
	if (evidence.length === 0) {
		return [
			'You are a vault assistant.',
			'No notes matched this question.',
			'Reply that the vault evidence is missing.',
			'Use the word UNCERTAIN.',
			'Do not invent notes, quotes, or citations.',
		].join(' ');
	}

	const blocks = evidence.map((chunk, index) => {
		const body =
			chunk.text.length > CHUNK_CHAR_CAP
				? `${chunk.text.slice(0, CHUNK_CHAR_CAP)}\n…`
				: chunk.text;
		return `[${index + 1}] [[${chunk.title}]] › ${chunk.heading}\n${body}`;
	});

	return [
		'You are a vault assistant.',
		'Answer only from EVIDENCE.',
		'Cite notes as [[Note title]].',
		'If the evidence is incomplete, say UNCERTAIN.',
		'Do not invent facts, quotes, or sources.',
		'If you interpret, label it as interpretation.',
		'',
		'EVIDENCE:',
		blocks.join('\n\n'),
	].join('\n');
}

export function buildConversationPrompt(): string {
	return [
		'You are a vault assistant.',
		'Answer from the conversation history above.',
		'Do not invent note content or citations.',
		'If the user asks what they asked before, quote their earlier user message.',
		'If you lack context, say UNCERTAIN.',
	].join(' ');
}
