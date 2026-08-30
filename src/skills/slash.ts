import type { VaultSkill } from './types';

export interface SkillSlashParse {
	skill: VaultSkill | null;
	message: string;
	displayText: string;
}

export function parseSkillSlash(
	text: string,
	skills: VaultSkill[],
): SkillSlashParse {
	const trimmed = text.trim();
	if (!trimmed.startsWith('/')) {
		return { skill: null, message: trimmed, displayText: trimmed };
	}

	const match = /^\/([^\s/]+)\/?(?:\s+(.*))?$/s.exec(trimmed);
	if (!match?.[1]) {
		return { skill: null, message: trimmed, displayText: trimmed };
	}

	const token = match[1];
	const message = (match[2] ?? '').trim();
	const skill = matchSkillToken(token, skills);
	if (!skill) {
		return { skill: null, message: trimmed, displayText: trimmed };
	}

	const displayText =
		message.length > 0 ? message : `/${skill.id}/`;

	return { skill, message, displayText };
}

export function matchSkillToken(
	token: string,
	skills: VaultSkill[],
): VaultSkill | null {
	const lower = token.toLowerCase();
	const exact =
		skills.find((skill) => skill.id.toLowerCase() === lower) ??
		skills.find((skill) => skill.name.toLowerCase() === lower);
	if (exact) {
		return exact;
	}

	const partial = skills.filter(
		(skill) =>
			skill.id.toLowerCase().startsWith(lower) ||
			skill.name.toLowerCase().startsWith(lower),
	);
	if (partial.length === 1) {
		return partial[0] ?? null;
	}

	return null;
}

export function slashQueryFromInput(value: string): string | null {
	if (!value.startsWith('/') || value.includes('\n')) {
		return null;
	}
	const tokenMatch = /^\/([^\s/]*)/.exec(value);
	return tokenMatch?.[1] ?? '';
}

export function shouldShowSlashMenu(value: string): boolean {
	if (!value.startsWith('/') || value.includes('\n')) {
		return false;
	}
	return !/\s/.test(value);
}

export function filterSkillsForSlash(
	query: string,
	skills: VaultSkill[],
): VaultSkill[] {
	const lower = query.toLowerCase();
	if (!lower) {
		return skills;
	}
	return skills.filter(
		(skill) =>
			skill.id.toLowerCase().includes(lower) ||
			skill.name.toLowerCase().includes(lower),
	);
}

export function slashInsert(skill: VaultSkill): string {
	return `/${skill.id}/ `;
}

/** Remove a leading `/token`, `/token/`, or lone `/` prefix from composer input. */
export function stripSkillSlashPrefix(value: string): string {
	const withToken = /^\/([^\s/]+)\/?\s*/.exec(value);
	if (withToken) {
		return value.slice(withToken[0].length);
	}
	if (value.startsWith('/')) {
		return value.replace(/^\/\s*/, '');
	}
	return value;
}

export function ambiguousSkillMatches(
	token: string,
	skills: VaultSkill[],
): VaultSkill[] {
	const lower = token.toLowerCase();
	return skills.filter(
		(skill) =>
			skill.id.toLowerCase().startsWith(lower) ||
			skill.name.toLowerCase().startsWith(lower),
	);
}
