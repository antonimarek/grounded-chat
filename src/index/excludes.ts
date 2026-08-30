export interface ExcludeRules {
	prefixes: string[];
	regexes: RegExp[];
}

const EMPTY_RULES: ExcludeRules = { prefixes: [], regexes: [] };

/** Any path segment that is a folder and starts with "." */
export function isInDotFolder(path: string): boolean {
	const parts = path.split('/');
	if (parts.length <= 1) {
		return false;
	}
	const dirs = parts.slice(0, -1);
	return dirs.some((dir) => dir.startsWith('.'));
}

export function parseExcludeRules(raw: string): ExcludeRules {
	const prefixes: string[] = [];
	const regexes: RegExp[] = [];

	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const regexMatch = /^\/(.+)\/([gimsuy]*)$/.exec(trimmed);
		if (regexMatch?.[1] !== undefined) {
			try {
				regexes.push(new RegExp(regexMatch[1], regexMatch[2] ?? ''));
			} catch {
				console.warn(
					`Grounded Chat: invalid exclude regex skipped: ${trimmed}`,
				);
			}
			continue;
		}

		prefixes.push(trimmed.replace(/\/$/, ''));
	}

	return { prefixes, regexes };
}

export function isPathExcluded(path: string, rules: ExcludeRules): boolean {
	if (isInDotFolder(path)) {
		return true;
	}
	for (const prefix of rules.prefixes) {
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			return true;
		}
	}
	for (const pattern of rules.regexes) {
		if (pattern.test(path)) {
			return true;
		}
	}
	return false;
}

export function emptyExcludeRules(): ExcludeRules {
	return EMPTY_RULES;
}
