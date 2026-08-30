import { TFile, TFolder } from 'obsidian';
import type GroundedChatPlugin from '../main';
import { parseSkillMarkdownWithBlockDescription, type VaultSkill } from './types';

export async function loadVaultSkills(
	plugin: GroundedChatPlugin,
): Promise<VaultSkill[]> {
	const folderPath = plugin.settings.skillsFolder.trim() || '.cursor/skills';
	const folder = plugin.app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		return [];
	}

	const skills: VaultSkill[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFolder)) {
			continue;
		}
		const skillFile = child.children.find(
			(entry) => entry instanceof TFile && entry.name === 'SKILL.md',
		);
		if (!(skillFile instanceof TFile)) {
			continue;
		}
		const markdown = await plugin.app.vault.cachedRead(skillFile);
		const parsed = parseSkillMarkdownWithBlockDescription(
			skillFile.path,
			markdown,
		);
		if (parsed) {
			skills.push(parsed);
		}
	}

	return skills.sort((a, b) => a.name.localeCompare(b.name));
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
