export function normalizeTerm(term: string): string {
	return term
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

const POLISH_SUFFIXES = [
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
	'ować',
	'yć',
	'ić',
];

export function stemVariants(term: string): string[] {
	const normalized = normalizeTerm(term);
	if (normalized.length < 4) {
		return [normalized];
	}

	const variants = new Set<string>([normalized]);
	for (const suffix of POLISH_SUFFIXES) {
		const stemSuffix = normalizeTerm(suffix);
		if (
			normalized.endsWith(stemSuffix) &&
			normalized.length - stemSuffix.length >= 3
		) {
			variants.add(normalized.slice(0, -stemSuffix.length));
		}
	}

	return [...variants];
}

export function processSearchTerm(term: string): string {
	return normalizeTerm(term);
}
