import { promises as fs } from 'fs';
import { join } from 'path';
import { FileSystemAdapter, Notice, type DataAdapter } from 'obsidian';
import type GroundedChatPlugin from '../main';
import { parseSkillMarkdownWithBlockDescription, type VaultSkill } from './types';

export interface SkillsLoadResult {
	skills: VaultSkill[];
	folderCount: number;
	skippedCount: number;
}

export async function loadVaultSkills(
	plugin: GroundedChatPlugin,
): Promise<SkillsLoadResult> {
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
): Promise<SkillsLoadResult> {
	const skillsDir = adapter.getFullPath(folderPath);

	try {
		const entries = await fs.readdir(skillsDir, { withFileTypes: true });
		const skills: VaultSkill[] = [];
		let folderCount = 0;
		let skippedCount = 0;
		for (const entry of entries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) {
				continue;
			}
			folderCount++;
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
				} else {
					skippedCount++;
				}
			} catch (error) {
				skippedCount++;
				console.warn(
					`Grounded Chat: skipped skill folder ${entryName}`,
					error,
				);
			}
		}
		return {
			skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
			folderCount,
			skippedCount,
		};
	} catch (error) {
		console.warn(
			`Grounded Chat: skills folder not readable at ${skillsDir}`,
			error,
		);
		return { skills: [], folderCount: 0, skippedCount: 0 };
	}
}

async function loadSkillsFromAdapter(
	adapter: DataAdapter,
	folderPath: string,
): Promise<SkillsLoadResult> {
	if (!(await adapter.exists(folderPath))) {
		return { skills: [], folderCount: 0, skippedCount: 0 };
	}

	let listing: { folders: string[]; files: string[] };
	try {
		listing = await adapter.list(folderPath);
	} catch {
		return { skills: [], folderCount: 0, skippedCount: 0 };
	}

	const skills: VaultSkill[] = [];
	let skippedCount = 0;
	for (const name of listing.folders) {
		const skillPath = `${folderPath}/${name}/SKILL.md`;
		if (!(await adapter.exists(skillPath))) {
			skippedCount++;
			continue;
		}
		try {
			const markdown = await adapter.read(skillPath);
			const parsed = parseSkillMarkdownWithBlockDescription(skillPath, markdown);
			if (parsed) {
				skills.push(parsed);
			} else {
				skippedCount++;
			}
		} catch {
			skippedCount++;
		}
	}

	return {
		skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
		folderCount: listing.folders.length,
		skippedCount,
	};
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

export function notifySkillsLoaded(
	result: SkillsLoadResult,
	folderPath: string,
): void {
	const { skills, folderCount, skippedCount } = result;
	if (skills.length === 0) {
		if (folderCount > 0 && skippedCount > 0) {
			new Notice(
				`No valid skills in ${folderPath}. ${skippedCount} folder${skippedCount === 1 ? '' : 's'} skipped (missing or invalid SKILL.md).`,
				6000,
			);
			return;
		}
		new Notice(
			`No skills found in ${folderPath}. Expected subfolders with SKILL.md.`,
			5000,
		);
		return;
	}
	let message = `Loaded ${skills.length} skill${skills.length === 1 ? '' : 's'}.`;
	if (skippedCount > 0) {
		message += ` ${skippedCount} skipped.`;
	}
	new Notice(message, 3000);
}
