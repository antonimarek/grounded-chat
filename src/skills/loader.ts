import { promises as fs } from 'fs';
import { join } from 'path';
import { FileSystemAdapter, Notice, type DataAdapter } from 'obsidian';
import type GroundedChatPlugin from '../main';
import { parseSkillMarkdownWithBlockDescription, type VaultSkill } from './types';

export async function loadVaultSkills(
	plugin: GroundedChatPlugin,
): Promise<VaultSkill[]> {
	const folderPath = normalizeFolderPath(
		plugin.settings.skillsFolder.trim() || '.cursor/skills',
	);
	const adapter = plugin.app.vault.adapter;

	if (adapter instanceof FileSystemAdapter) {
		return loadSkillsFromFilesystem(adapter, folderPath);
	}

	return loadSkillsFromAdapter(adapter, folderPath);
}

async function loadSkillsFromFilesystem(
	adapter: FileSystemAdapter,
	folderPath: string,
): Promise<VaultSkill[]> {
	const skillsDir = adapter.getFullPath(folderPath);

	try {
		const entries = await fs.readdir(skillsDir, { withFileTypes: true });
		const skills: VaultSkill[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) {
				continue;
			}
			const entryName = String(entry.name);
			const vaultSkillPath = `${folderPath}/${entryName}/SKILL.md`;
			const diskSkillPath = join(skillsDir, entryName, 'SKILL.md');
			try {
				const markdown = await fs.readFile(diskSkillPath, 'utf8');
				const parsed = parseSkillMarkdownWithBlockDescription(
					vaultSkillPath,
					markdown,
				);
				if (parsed) {
					skills.push(parsed);
				}
			} catch (error) {
				console.warn(
					`Grounded Chat: skipped skill folder ${entryName}`,
					error,
				);
			}
		}
		return skills.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.warn(
			`Grounded Chat: skills folder not readable at ${skillsDir}`,
			error,
		);
		return [];
	}
}

async function loadSkillsFromAdapter(
	adapter: DataAdapter,
	folderPath: string,
): Promise<VaultSkill[]> {
	if (!(await adapter.exists(folderPath))) {
		return [];
	}

	let listing: { folders: string[]; files: string[] };
	try {
		listing = await adapter.list(folderPath);
	} catch {
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
		} catch {
			continue;
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

export function notifySkillsLoaded(skills: VaultSkill[], folderPath: string): void {
	if (skills.length === 0) {
		new Notice(
			`No skills found in ${folderPath}. Expected subfolders with SKILL.md.`,
			5000,
		);
		return;
	}
	new Notice(`Loaded ${skills.length} skill${skills.length === 1 ? '' : 's'}.`, 3000);
}
