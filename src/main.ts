import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	VaultChatSettingTab,
	VaultChatSettings,
} from './settings';
import { ChatView, VIEW_TYPE_VAULT_CHAT } from './view/ChatView';

export default class VaultChatPlugin extends Plugin {
	settings!: VaultChatSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_VAULT_CHAT,
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

		this.addSettingTab(new VaultChatSettingTab(this.app, this));
	}

	onunload() {}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_VAULT_CHAT);
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
			type: VIEW_TYPE_VAULT_CHAT,
			active: true,
		});
		await workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<VaultChatSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
