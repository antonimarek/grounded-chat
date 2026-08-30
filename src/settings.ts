import { App, PluginSettingTab, Setting } from 'obsidian';
import GroundedChatPlugin from './main';

export interface GroundedChatSettings {
	openRouterApiKey: string;
	chatModel: string;
	baseUrl: string;
	topK: number;
	excludeFolders: string;
	persistChat: boolean;
	saveAnswerFolder: string;
}

export const DEFAULT_SETTINGS: GroundedChatSettings = {
	openRouterApiKey: '',
	chatModel: 'deepseek/deepseek-chat',
	baseUrl: 'https://openrouter.ai/api/v1',
	topK: 8,
	excludeFolders: '',
	persistChat: false,
	saveAnswerFolder: 'Grounded Chat/Answers',
};

export class GroundedChatSettingTab extends PluginSettingTab {
	plugin: GroundedChatPlugin;

	constructor(app: App, plugin: GroundedChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API key')
			.setDesc('Provider key. Stored in plugin data.json.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Paste key')
					.setValue(this.plugin.settings.openRouterApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openRouterApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Chat model')
			.setDesc('Model slug (example: deepseek/deepseek-chat).')
			.addText((text) =>
				text
					.setPlaceholder('Model slug')
					.setValue(this.plugin.settings.chatModel)
					.onChange(async (value) => {
						this.plugin.settings.chatModel = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('API base URL')
			.setDesc('Default endpoint for the chat provider.')
			.addText((text) =>
				text
					.setPlaceholder('Base URL')
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Notes per answer')
			.setDesc('How many retrieved chunks to send with each question.')
			.addSlider((slider) =>
				slider
					.setLimits(3, 16, 1)
					.setValue(this.plugin.settings.topK)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.topK = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Exclude paths')
			.setDesc(
				'Dot-folders are always skipped. Add one rule per line: plain folder prefix, or /regex/. Lines starting with # are ignored.',
			)
			.addTextArea((area) =>
				area
					.setPlaceholder('Templates')
					.setValue(this.plugin.settings.excludeFolders)
					.onChange(async (value) => {
						this.plugin.settings.excludeFolders = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Persist chat')
			.setDesc(
				'Keep the chat thread when you close the pane or reload Obsidian. Stored in plugin data on this device.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.persistChat).onChange(async (value) => {
					this.plugin.settings.persistChat = value;
					await this.plugin.saveSettings();
					if (!value) {
						await this.plugin.clearChatThread();
					}
				}),
			);

		new Setting(containerEl)
			.setName('Save answer folder')
			.setDesc('Vault folder for saved answers from the command palette or the save icon on each reply.')
			.addText((text) =>
				text
					.setPlaceholder('Grounded chat/answers')
					.setValue(this.plugin.settings.saveAnswerFolder)
					.onChange(async (value) => {
						this.plugin.settings.saveAnswerFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
