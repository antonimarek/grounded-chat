import { MarkdownView, Plugin } from 'obsidian';
import type { ThreadMessage } from './chat/types';
import { VaultIndex } from './index/vault-index';
import { emptyUsage, mergeUsage, type TokenUsage } from './openrouter/usage';
import {
	DEFAULT_SETTINGS,
	GroundedChatSettingTab,
	GroundedChatSettings,
} from './settings';
import { loadVaultSkills, notifySkillsLoaded } from './skills/loader';
import type { VaultSkill } from './skills/types';
import { ChatView, VIEW_TYPE_GROUNDED_CHAT } from './view/ChatView';

export default class GroundedChatPlugin extends Plugin {
	settings!: GroundedChatSettings;
	vaultIndex!: VaultIndex;
	chatThread: ThreadMessage[] = [];
	skills: VaultSkill[] = [];
	sessionUsage: TokenUsage = emptyUsage();

	async onload() {
		await this.loadSettings();
		await this.refreshSkills();

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
			id: 'refresh-skills',
			name: 'Refresh skills',
			callback: () => {
				void this.refreshSkills().then((skills) => {
					notifySkillsLoaded(
						skills,
						this.settings.skillsFolder.trim() || '.cursor/skills',
					);
				});
			},
		});

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

	activeNotePath(): string | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file?.path ?? null;
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

	async refreshSkills(): Promise<VaultSkill[]> {
		this.skills = await loadVaultSkills(this);
		this.getChatView()?.refreshSkillsUi();
		return this.skills;
	}

	addSessionUsage(usage: TokenUsage | null | undefined): void {
		const merged = mergeUsage(this.sessionUsage, usage);
		if (merged) {
			this.sessionUsage = merged;
		}
		this.getChatView()?.refreshUsageDisplay();
	}
}
