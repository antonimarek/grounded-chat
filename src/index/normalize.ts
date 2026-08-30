export function normalizeTerm(term: string): string {
	return term
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

const STEM_SUFFIXES = [
	// Polish
	'owi',
	'iem',
	'ami',
	'ach',
	'ów',
	'om',
	'em',
	'ie',
	'nym',
	'nej',
	'nego',
	'aniu',
	'enie',
	'owac',
	'yć',
	'ić',
	// English
	'tion',
	'ions',
	'ment',
	'ness',
	'able',
	'ible',
	'ing',
	'ed',
	'es',
	'ly',
];

export function stemVariants(term: string): string[] {
	const normalized = normalizeTerm(term);
	if (normalized.length < 3) {
		return normalized ? [normalized] : [];
	}

	const variants = new Set<string>([normalized]);
	for (const suffix of STEM_SUFFIXES) {
		const stemSuffix = normalizeTerm(suffix);
		if (
			stemSuffix.length > 0 &&
			normalized.endsWith(stemSuffix) &&
			normalized.length - stemSuffix.length >= 3
		) {
			variants.add(normalized.slice(0, -stemSuffix.length));
		}
	}

	if (normalized.endsWith('s') && normalized.length >= 4) {
		variants.add(normalized.slice(0, -1));
	}

	return [...variants];
}

export function processSearchTerm(term: string): string {
	return normalizeTerm(term);
}
