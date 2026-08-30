import { normalizeTerm, stemVariants } from '../index/normalize';

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
	'moje',
	'moj',
	'mój',
	'jakie',
	'jakis',
	'jakieś',
	'moze',
	'mozesz',
	'możesz',
	'powiedz',
	'powiedziec',
	'powiedzieć',
	'szukam',
	'szukac',
	'szukać',
]);

export function extractSearchTerms(text: string): string[] {
	const raw = text
		.split(/[\s,.!?;:()[\]"'«»]+/)
		.map((part) => normalizeTerm(part))
		.filter((part) => part.length >= 2 && !STOPWORDS.has(part));

	return [...new Set(raw)];
}

export function expandSearchTerms(terms: string[]): string[] {
	const expanded = new Set<string>();
	for (const term of terms) {
		for (const variant of stemVariants(term)) {
			expanded.add(variant);
		}
	}
	return [...expanded];
}

export function allSearchTerms(userQuery: string, context?: string): string[] {
	const terms = extractSearchTerms(userQuery);
	if (context?.trim()) {
		for (const term of extractSearchTerms(context)) {
			terms.push(term);
		}
	}
	return expandSearchTerms([...new Set(terms)]);
}

export function buildSearchQueries(userQuery: string, context?: string): string[] {
	const trimmed = userQuery.trim();
	if (!trimmed) {
		return [];
	}

	const terms = allSearchTerms(trimmed, context);
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
