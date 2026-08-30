import { App, Component, MarkdownRenderer, Modal, TFile } from 'obsidian';
import type { VaultSkill } from '../skills/types';
import { skillAllowsEdits } from '../skills/types';

export class SkillPreviewModal extends Modal {
	private renderComponent = new Component();

	constructor(
		app: App,
		private skill: VaultSkill,
	) {
		super(app);
	}

	onOpen(): void {
		this.renderComponent.load();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gc-skill-preview-modal');

		contentEl.createEl('h2', { text: this.skill.name });

		if (this.skill.description) {
			contentEl.createEl('p', {
				cls: 'gc-skill-preview-desc',
				text: this.skill.description,
			});
		}

		if (skillAllowsEdits(this.skill)) {
			contentEl.createSpan({
				cls: 'gc-skill-edit-badge',
				text: 'Edits notes',
			});
		}

		contentEl.createDiv({
			cls: 'gc-skill-preview-token',
			text: `/${this.skill.id}/`,
		});

		const bodyEl = contentEl.createDiv({ cls: 'gc-skill-preview-body markdown-rendered' });
		void MarkdownRenderer.render(
			this.app,
			this.skill.body,
			bodyEl,
			this.skill.path,
			this.renderComponent,
		);

		const actions = contentEl.createDiv({ cls: 'gc-skill-preview-actions' });
		const openBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: 'Open SKILL.md',
		});
		openBtn.addEventListener('click', () => {
			const file = this.app.vault.getAbstractFileByPath(this.skill.path);
			if (file instanceof TFile) {
				void this.app.workspace.getLeaf(false)?.openFile(file);
			}
			this.close();
		});
	}

	onClose(): void {
		this.renderComponent.unload();
		this.contentEl.empty();
	}
}
