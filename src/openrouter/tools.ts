export const SEARCH_VAULT_TOOL = {
	type: 'function' as const,
	function: {
		name: 'search_vault',
		description:
			'Search the user Obsidian vault for note excerpts. Use when the answer needs note content. Do not use for meta questions about this chat, clarifications of the previous answer, thanks, or short follow-ups answerable from conversation history.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Focused keyword query using content words from the question and earlier turns. Use the same language as the note content when possible. Not the full conversational sentence.',
				},
			},
			required: ['query'],
		},
	},
};

export const ROUTER_SYSTEM = [
	'You route requests for a vault assistant.',
	'Call search_vault only when note content is required.',
	'Do not call search_vault when the user asks about this conversation, repeats a prior question, clarifies the last answer, or sends thanks.',
	'If search_vault is not needed, reply briefly in the user language without inventing note content.',
].join(' ');

export function parseSearchQuery(raw: string): string | null {
	try {
		const parsed = JSON.parse(raw) as { query?: string };
		const query = parsed.query?.trim();
		return query && query.length > 0 ? query : null;
	} catch {
		return null;
	}
}
