import { setIcon } from 'obsidian';
import type GroundedChatPlugin from '../main';
import { findSkill } from '../skills/loader';
import type { VaultSkill } from '../skills/types';
import { skillAllowsEdits } from '../skills/types';
import { SkillPreviewModal } from './skill-preview-modal';

export class SkillPicker {
	private wrapEl: HTMLElement;
	private btnEl: HTMLButtonElement;
	private popoverEl: HTMLElement;
	private searchEl!: HTMLInputElement;
	private listEl!: HTMLElement;
	private visible = false;
	private query = '';
	private onDocumentClick: (event: MouseEvent) => void;

	constructor(
		private anchorEl: HTMLElement,
		private plugin: GroundedChatPlugin,
		private onSelect: (skill: VaultSkill | null) => void,
	) {
		this.wrapEl = anchorEl.createDiv({ cls: 'gc-skill-picker' });
		this.btnEl = this.wrapEl.createEl('button', {
			cls: 'gc-skill-picker-btn',
			attr: { type: 'button' },
		});
		this.popoverEl = this.wrapEl.createDiv({
			cls: 'gc-skill-picker-popover gc-skill-picker-popover-hidden',
		});

		this.btnEl.addEventListener('click', (event) => {
			event.stopPropagation();
			this.toggle();
		});

		this.onDocumentClick = (event: MouseEvent) => {
			if (!this.visible) {
				return;
			}
			const target = event.target;
			if (target instanceof Node && this.wrapEl.contains(target)) {
				return;
			}
			this.hide();
		};
		document.addEventListener('mousedown', this.onDocumentClick);
	}

	destroy(): void {
		document.removeEventListener('mousedown', this.onDocumentClick);
	}

	refresh(): void {
		this.renderButton();
		if (this.visible) {
			this.renderList();
		}
	}

	private toggle(): void {
		if (this.visible) {
			this.hide();
			return;
		}
		this.show();
	}

	private show(): void {
		this.visible = true;
		this.query = '';
		this.popoverEl.empty();

		const header = this.popoverEl.createDiv({ cls: 'gc-skill-picker-header' });
		this.searchEl = header.createEl('input', {
			cls: 'gc-skill-picker-search',
			attr: {
				type: 'text',
				placeholder: 'Search skills…',
			},
		});
		this.searchEl.addEventListener('input', () => {
			this.query = this.searchEl.value.trim().toLowerCase();
			this.renderList();
		});
		this.searchEl.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.hide();
			}
		});

		const refreshBtn = header.createEl('button', {
			cls: 'gc-skill-picker-refresh clickable-icon',
			attr: {
				type: 'button',
				'aria-label': 'Refresh skills',
				title: 'Refresh skills',
			},
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			void this.plugin.refreshSkills();
		});

		this.listEl = this.popoverEl.createDiv({ cls: 'gc-skill-picker-list' });
		this.renderList();
		this.popoverEl.removeClass('gc-skill-picker-popover-hidden');
		window.setTimeout(() => this.searchEl.focus(), 0);
	}

	hide(): void {
		this.visible = false;
		this.popoverEl.empty();
		this.popoverEl.addClass('gc-skill-picker-popover-hidden');
	}

	private renderButton(): void {
		const active = findSkill(
			this.plugin.skills,
			this.plugin.settings.activeSkillId,
		);
		this.btnEl.empty();
		if (active) {
			this.btnEl.addClass('gc-skill-picker-btn-active');
			this.btnEl.setText(active.name);
			const editHint = skillAllowsEdits(active)
				? ' · Can propose note edits when a note is attached'
				: '';
			this.btnEl.title = active.description
				? `${active.description}${editHint}`
				: active.name;
		} else {
			this.btnEl.removeClass('gc-skill-picker-btn-active');
			this.btnEl.setText('Skill');
			const folder =
				this.plugin.settings.skillsFolder.trim() || '.cursor/skills';
			if (this.plugin.skills.length === 0) {
				this.btnEl.title = `No skills in ${folder}`;
			} else {
				this.btnEl.title = `${this.plugin.skills.length} skills loaded`;
			}
		}
	}

	private renderList(): void {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();

		const skills = this.filterSkills();
		const folder =
			this.plugin.settings.skillsFolder.trim() || '.cursor/skills';

		if (this.plugin.skills.length === 0) {
			this.listEl.createDiv({
				cls: 'gc-skill-picker-empty',
				text: `No skills in ${folder} — add SKILL.md folders`,
			});
			return;
		}

		const noneRow = this.listEl.createDiv({ cls: 'gc-skill-picker-row gc-skill-picker-none' });
		noneRow.createSpan({ cls: 'gc-skill-picker-row-name', text: 'None' });
		noneRow.createSpan({
			cls: 'gc-skill-picker-row-desc',
			text: 'Clear active skill',
		});
		noneRow.addEventListener('mousedown', (event) => {
			event.preventDefault();
			this.pick(null);
		});

		if (skills.length === 0) {
			this.listEl.createDiv({
				cls: 'gc-skill-picker-empty',
				text: 'No matching skills',
			});
			return;
		}

		for (const skill of skills) {
			this.renderSkillRow(skill);
		}
	}

	private renderSkillRow(skill: VaultSkill): void {
		const row = this.listEl.createDiv({ cls: 'gc-skill-picker-row' });
		const main = row.createDiv({ cls: 'gc-skill-picker-row-main' });
		const titleRow = main.createDiv({ cls: 'gc-skill-picker-row-title' });
		titleRow.createSpan({ cls: 'gc-skill-picker-row-name', text: skill.name });
		if (skillAllowsEdits(skill)) {
			titleRow.createSpan({
				cls: 'gc-skill-edit-badge',
				text: 'Edits notes',
			});
		}
		main.createSpan({
			cls: 'gc-skill-picker-row-token',
			text: `/${skill.id}/`,
		});
		if (skill.description) {
			main.createSpan({
				cls: 'gc-skill-picker-row-desc',
				text: skill.description.slice(0, 120),
			});
		}

		const actions = row.createDiv({ cls: 'gc-skill-picker-row-actions' });
		const selectBtn = actions.createEl('button', {
			cls: 'gc-btn gc-btn-small mod-cta',
			text: 'Select',
			attr: { type: 'button' },
		});
		selectBtn.addEventListener('mousedown', (event) => {
			event.preventDefault();
			this.pick(skill);
		});

		const previewBtn = actions.createEl('button', {
			cls: 'gc-btn gc-btn-small',
			text: 'Preview',
			attr: { type: 'button' },
		});
		previewBtn.addEventListener('mousedown', (event) => {
			event.preventDefault();
			new SkillPreviewModal(this.plugin.app, skill).open();
		});

		row.addEventListener('mousedown', (event) => {
			if (event.target instanceof HTMLButtonElement) {
				return;
			}
			event.preventDefault();
			this.pick(skill);
		});
	}

	private filterSkills(): VaultSkill[] {
		if (!this.query) {
			return this.plugin.skills;
		}
		return this.plugin.skills.filter(
			(skill) =>
				skill.id.toLowerCase().includes(this.query) ||
				skill.name.toLowerCase().includes(this.query) ||
				skill.description.toLowerCase().includes(this.query),
		);
	}

	private pick(skill: VaultSkill | null): void {
		this.hide();
		this.onSelect(skill);
	}
}
