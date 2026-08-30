import { MarkdownView, Plugin, TFile } from 'obsidian';
import type { ThreadMessage } from './chat/types';
import { VaultIndex } from './index/vault-index';
import { emptyUsage, mergeUsage, type TokenUsage } from './openrouter/usage';
import {
	DEFAULT_SETTINGS,
	GroundedChatSettingTab,
	GroundedChatSettings,
} from './settings';
import {
	loadVaultSkills,
	notifySkillsLoaded,
	type SkillsLoadResult,
} from './skills/loader';
import type { VaultSkill } from './skills/types';
import { ChatView, VIEW_TYPE_GROUNDED_CHAT } from './view/ChatView';

export default class GroundedChatPlugin extends Plugin {
	settings!: GroundedChatSettings;
	vaultIndex!: VaultIndex;
	chatThread: ThreadMessage[] = [];
	skills: VaultSkill[] = [];
	sessionUsage: TokenUsage = emptyUsage();
	lastMarkdownPath: string | null = null;

	async onload() {
		await this.loadSettings();
		await this.refreshSkills();

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.trackMarkdownPath(file);
			}),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.trackMarkdownPath(this.app.workspace.getActiveFile());
			}),
		);

		this.vaultIndex = new VaultIndex(this.app, () => this.settings);
		this.addChild(this.vaultIndex);
		void this.vaultIndex.start();

		this.registerView(
			VIEW_TYPE_GROUNDED_CHAT,
			(leaf) => new ChatView(leaf, this),
		);

		this.addRibbonIcon('message-square', 'Open chat', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-chat',
			name: 'Open chat',
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: 'rebuild-index',
			name: 'Rebuild index',
			callback: () => {
				void this.vaultIndex.rebuild();
			},
		});

		this.addCommand({
			id: 'save-last-answer',
			name: 'Save last answer to note',
			checkCallback: (checking) => {
				const view = this.getChatView();
				if (!view?.hasLastAnswer()) {
					return false;
				}
				if (!checking) {
					void view.saveLastAnswer();
				}
				return true;
			},
		});

		this.addCommand({
			id: 'clear-chat',
			name: 'Clear chat',
			checkCallback: (checking) => {
				const view = this.getChatView();
				if (!view || view.isEmpty()) {
					return false;
				}
				if (!checking) {
					void view.clearChat();
				}
				return true;
			},
		});

		this.addCommand({
			id: 'apply-last-proposal',
			name: 'Apply last note proposal',
			checkCallback: (checking) => {
				const view = this.getChatView();
				if (!view?.hasLastProposal()) {
					return false;
				}
				if (!checking) {
					void view.applyLastProposal();
				}
				return true;
			},
		});

		this.addCommand({
			id: 'refresh-skills',
			name: 'Refresh skills',
			callback: () => {
				void this.refreshSkills().then((result) => {
					notifySkillsLoaded(
						result,
						this.settings.skillsFolder.trim() || '.cursor/skills',
					);
				});
			},
		});

		this.registerSkillsWatcher();

		this.addSettingTab(new GroundedChatSettingTab(this.app, this));
	}

	onunload() {}

	getChatView(): ChatView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_GROUNDED_CHAT,
		)) {
			if (leaf.view instanceof ChatView) {
				return leaf.view;
			}
		}
		return null;
	}

	recentMarkdownPaths(limit = 6): string[] {
		const seen = new Set<string>();
		const paths: string[] = [];
		const active = this.activeNotePath();

		const add = (path: string | null | undefined): void => {
			if (!path || seen.has(path) || path === active) {
				return;
			}
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || file.extension !== 'md') {
				return;
			}
			seen.add(path);
			paths.push(path);
		};

		for (const path of this.app.workspace.getLastOpenFiles()) {
			if (paths.length >= limit) {
				break;
			}
			add(path);
		}

		add(this.lastMarkdownPath);
		return paths.slice(0, limit);
	}

	activeNotePath(): string | null {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile?.extension === 'md') {
			return activeFile.path;
		}

		if (this.lastMarkdownPath) {
			const cached = this.app.vault.getAbstractFileByPath(this.lastMarkdownPath);
			if (cached instanceof TFile && cached.extension === 'md') {
				return cached.path;
			}
		}

		for (const path of this.app.workspace.getLastOpenFiles()) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && file.extension === 'md') {
				return file.path;
			}
		}

		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		return markdownView?.file?.path ?? null;
	}

	private trackMarkdownPath(file: TFile | null): void {
		if (file instanceof TFile && file.extension === 'md') {
			this.lastMarkdownPath = file.path;
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_GROUNDED_CHAT);
		const first = existing[0];
		if (first) {
			await workspace.revealLeaf(first);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({
			type: VIEW_TYPE_GROUNDED_CHAT,
			active: true,
		});
		await workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		const data = (await this.loadData()) as
			| (Partial<GroundedChatSettings> & { chatThread?: ThreadMessage[] })
			| null;
		const { chatThread, ...settingsData } = data ?? {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
		this.chatThread = Array.isArray(chatThread) ? chatThread : [];
	}

	async saveSettings() {
		const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		await this.saveData({
			...data,
			...this.settings,
			chatThread: this.chatThread,
		});
	}

	async persistChatThread(thread: ThreadMessage[]): Promise<void> {
		this.chatThread = thread;
		if (!this.settings.persistChat) {
			return;
		}
		const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		await this.saveData({
			...data,
			...this.settings,
			chatThread: thread,
		});
	}

	async clearChatThread(): Promise<void> {
		this.chatThread = [];
		this.sessionUsage = emptyUsage();
		const data = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		await this.saveData({
			...data,
			...this.settings,
			chatThread: [],
		});
	}

	async refreshSkills(): Promise<SkillsLoadResult> {
		const result = await loadVaultSkills(this);
		this.skills = result.skills;
		this.getChatView()?.refreshSkillsUi();
		return result;
	}

	private registerSkillsWatcher(): void {
		let debounceTimer: number | null = null;
		const scheduleRefresh = (): void => {
			if (debounceTimer !== null) {
				window.clearTimeout(debounceTimer);
			}
			debounceTimer = window.setTimeout(() => {
				debounceTimer = null;
				void this.refreshSkills();
			}, 400);
		};

		const folder = () =>
			(this.settings.skillsFolder.trim() || '.cursor/skills').replace(/\/+$/, '');

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				const skillsRoot = folder();
				if (
					file.path === `${skillsRoot}/SKILL.md` ||
					file.path.endsWith('/SKILL.md') && file.path.startsWith(`${skillsRoot}/`)
				) {
					scheduleRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				const skillsRoot = folder();
				if (
					file.path.endsWith('/SKILL.md') &&
					file.path.startsWith(`${skillsRoot}/`)
				) {
					scheduleRefresh();
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile)) {
					return;
				}
				const skillsRoot = folder();
				if (
					file.path.endsWith('/SKILL.md') &&
					file.path.startsWith(`${skillsRoot}/`)
				) {
					scheduleRefresh();
				}
			}),
		);
	}

	addSessionUsage(usage: TokenUsage | null | undefined): void {
		const merged = mergeUsage(this.sessionUsage, usage);
		if (merged) {
			this.sessionUsage = merged;
		}
		this.getChatView()?.refreshUsageDisplay();
	}
}
