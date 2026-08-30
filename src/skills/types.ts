export interface VaultSkill {
	id: string;
	name: string;
	description: string;
	body: string;
	path: string;
	allowsEdits: boolean;
}

const EDIT_SKILL_ALLOWLIST = new Set(['conversation-to-obsidian-note']);

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMarkdown(path: string, markdown: string): VaultSkill | null {
	const match = FRONTMATTER_RE.exec(markdown);
	const frontmatter = match?.[1] ?? '';
	const body = (match?.[2] ?? markdown).trim();
	const id = skillIdFromPath(path);
	const name = readFrontmatterField(frontmatter, 'name') ?? id;
	const description = readFrontmatterField(frontmatter, 'description') ?? '';

	if (!body) {
		return null;
	}

	return {
		id,
		name,
		description,
		body,
		path,
		allowsEdits: readSkillAllowsEdits(frontmatter, id),
	};
}

export function skillIdFromPath(path: string): string {
	const parts = path.split('/');
	const folder = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
	return folder?.replace(/\.md$/i, '') ?? path;
}

function readFrontmatterField(frontmatter: string, key: string): string | null {
	const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'im');
	const match = pattern.exec(frontmatter);
	if (!match?.[1]) {
		return null;
	}
	let value = match[1].trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	if (value.startsWith('>-') || value.startsWith('|')) {
		return null;
	}
	return value.trim() || null;
}

export function readFrontmatterDescription(frontmatter: string): string {
	const blockMatch = /^description:\s*>-\s*\r?\n((?:[ \t].+\r?\n?)+)/im.exec(
		frontmatter,
	);
	if (blockMatch?.[1]) {
		return blockMatch[1]
			.split('\n')
			.map((line) => line.replace(/^[ \t]/, '').trim())
			.filter(Boolean)
			.join(' ');
	}
	return readFrontmatterField(frontmatter, 'description') ?? '';
}

export function parseSkillMarkdownWithBlockDescription(
	path: string,
	markdown: string,
): VaultSkill | null {
	const match = FRONTMATTER_RE.exec(markdown);
	if (!match?.[1] || !match[2]) {
		return null;
	}
	const frontmatter = match[1];
	const body = match[2].trim();
	const id = skillIdFromPath(path);
	const name = readFrontmatterField(frontmatter, 'name') ?? id;
	const description =
		readFrontmatterDescription(frontmatter) ||
		readFrontmatterField(frontmatter, 'description') ||
		'';

	if (!body) {
		return null;
	}

	return {
		id,
		name,
		description,
		body,
		path,
		allowsEdits: readSkillAllowsEdits(frontmatter, id),
	};
}

export function skillAllowsEdits(skill: VaultSkill | null): boolean {
	if (!skill) {
		return false;
	}
	return skill.allowsEdits || EDIT_SKILL_ALLOWLIST.has(skill.id);
}

function readSkillAllowsEdits(frontmatter: string, skillId: string): boolean {
	if (EDIT_SKILL_ALLOWLIST.has(skillId)) {
		return true;
	}
	const editField = readFrontmatterField(frontmatter, 'edit');
	if (editField && /^(true|yes|1)$/i.test(editField)) {
		return true;
	}
	const modeField = readFrontmatterField(frontmatter, 'mode');
	return modeField?.toLowerCase() === 'edit';
}
