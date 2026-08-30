const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'by',
	'co',
	'czy',
	'do',
	'dotyczy',
	'dotyczace',
	'dotyczące',
	'for',
	'from',
	'how',
	'i',
	'in',
	'is',
	'it',
	'jak',
	'jaka',
	'jaki',
	'jakie',
	'jakich',
	'jakiś',
	'jakis',
	'je',
	'jego',
	'jej',
	'jest',
	'już',
	'juz',
	'mam',
	'ma',
	'mi',
	'mnie',
	'my',
	'na',
	'notatka',
	'notatki',
	'notatek',
	'o',
	'of',
	'on',
	'or',
	'po',
	'that',
	'the',
	'this',
	'to',
	'what',
	'which',
	'who',
	'with',
	'w',
	'we',
	'you',
	'z',
	'za',
	'ze',
]);

export function extractSearchTerms(query: string): string[] {
	const raw = query
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.split(/[\s,.!?;:()[\]"'«»]+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 3 && !STOPWORDS.has(part));

	return [...new Set(raw)];
}

export function buildSearchQueries(userQuery: string): string[] {
	const trimmed = userQuery.trim();
	if (!trimmed) {
		return [];
	}

	const terms = extractSearchTerms(trimmed);
	const queries: string[] = [];

	if (terms.length >= 2) {
		queries.push(terms.join(' '));
	}
	if (terms.length > 0) {
		queries.push(...terms);
	}
	queries.push(trimmed);

	return [...new Set(queries.filter((q) => q.length > 0))];
}
