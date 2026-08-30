import type GroundedChatPlugin from '../main';
import { parseSkillMarkdownWithBlockDescription, type VaultSkill } from './types';

export async function loadVaultSkills(
	plugin: GroundedChatPlugin,
): Promise<VaultSkill[]> {
	const folderPath = normalizeFolderPath(
		plugin.settings.skillsFolder.trim() || '.cursor/skills',
	);
	const adapter = plugin.app.vault.adapter;

	if (!(await adapter.exists(folderPath))) {
		console.warn(`Grounded Chat: skills folder not found: ${folderPath}`);
		return [];
	}

	let listing: { folders: string[]; files: string[] };
	try {
		listing = await adapter.list(folderPath);
	} catch (error) {
		console.warn(`Grounded Chat: could not list skills folder ${folderPath}`, error);
		return [];
	}

	const skills: VaultSkill[] = [];
	for (const name of listing.folders) {
		const skillPath = `${folderPath}/${name}/SKILL.md`;
		if (!(await adapter.exists(skillPath))) {
			continue;
		}
		try {
			const markdown = await adapter.read(skillPath);
			const parsed = parseSkillMarkdownWithBlockDescription(skillPath, markdown);
			if (parsed) {
				skills.push(parsed);
			}
		} catch (error) {
			console.warn(`Grounded Chat: failed to read skill ${skillPath}`, error);
		}
	}

	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeFolderPath(path: string): string {
	return path.replace(/\/+$/, '');
}

export function findSkill(
	skills: VaultSkill[],
	skillId: string,
): VaultSkill | null {
	if (!skillId) {
		return null;
	}
	return skills.find((skill) => skill.id === skillId) ?? null;
}

export function skillPromptSection(skill: VaultSkill): string {
	return [
		`ACTIVE SKILL: ${skill.name}`,
		skill.description ? `Purpose: ${skill.description}` : '',
		'Follow the skill instructions below. Use vault search when the skill requires note content or related links.',
		'Do not invent facts that are not in retrieved notes or the conversation.',
		'',
		skill.body,
	].filter(Boolean).join('\n');
}
