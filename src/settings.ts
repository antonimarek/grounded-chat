import { App, PluginSettingTab, Setting } from 'obsidian';
import VaultChatPlugin from './main';

export interface VaultChatSettings {
	openRouterApiKey: string;
	chatModel: string;
	baseUrl: string;
}

export const DEFAULT_SETTINGS: VaultChatSettings = {
	openRouterApiKey: '',
	chatModel: 'deepseek/deepseek-chat',
	baseUrl: 'https://openrouter.ai/api/v1',
};

export class VaultChatSettingTab extends PluginSettingTab {
	plugin: VaultChatPlugin;

	constructor(app: App, plugin: VaultChatPlugin) {
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
	}
}
