import type { VaultSkill } from '../skills/types';
import { skillAllowsEdits } from '../skills/types';
import {
	filterSkillsForSlash,
	slashQueryFromInput,
} from '../skills/slash';

export class SkillSlashMenu {
	private wrapEl: HTMLElement;
	private items: VaultSkill[] = [];
	private activeIndex = 0;
	private visible = false;

	constructor(
		private anchorEl: HTMLElement,
		private onPick: (skill: VaultSkill) => void,
	) {
		this.wrapEl = anchorEl.createDiv({ cls: 'gc-slash-menu gc-slash-menu-hidden' });
	}

	syncInput(value: string, skills: VaultSkill[]): boolean {
		const query = slashQueryFromInput(value);
		if (query === null) {
			this.hide();
			return false;
		}

		this.items = filterSkillsForSlash(query, skills);
		if (this.items.length === 0) {
			this.hide();
			return false;
		}

		this.activeIndex = 0;
		this.render();
		this.show();
		return true;
	}

	handleKeyDown(event: KeyboardEvent): boolean {
		if (!this.visible || this.items.length === 0) {
			return false;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			this.activeIndex = (this.activeIndex + 1) % this.items.length;
			this.render();
			return true;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			this.activeIndex =
				(this.activeIndex - 1 + this.items.length) % this.items.length;
			this.render();
			return true;
		}

		if (event.key === 'Enter' || event.key === 'Tab') {
			const picked = this.items[this.activeIndex];
			if (picked) {
				event.preventDefault();
				this.pick(picked);
				return true;
			}
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			this.hide();
			return true;
		}

		return false;
	}

	hide(): void {
		this.visible = false;
		this.wrapEl.empty();
		this.wrapEl.addClass('gc-slash-menu-hidden');
	}

	private show(): void {
		this.visible = true;
		this.wrapEl.removeClass('gc-slash-menu-hidden');
	}

	private pick(skill: VaultSkill): void {
		this.hide();
		this.onPick(skill);
	}

	private render(): void {
		this.wrapEl.empty();

		const header = this.wrapEl.createDiv({ cls: 'gc-slash-menu-header' });
		header.createSpan({ cls: 'gc-slash-menu-title', text: 'Select skill' });
		header.createSpan({
			cls: 'gc-slash-menu-hint',
			text: '↑↓ · Enter · Esc',
		});

		const list = this.wrapEl.createDiv({ cls: 'gc-slash-menu-list' });
		for (let i = 0; i < this.items.length; i++) {
			const skill = this.items[i];
			if (!skill) {
				continue;
			}
			const row = list.createDiv({
				cls: `gc-slash-item${i === this.activeIndex ? ' is-active' : ''}`,
			});

			const icon = row.createDiv({ cls: 'gc-slash-item-icon gc-slash-item-icon-skill' });
			icon.setText('/');

			const body = row.createDiv({ cls: 'gc-slash-item-body' });
			const titleRow = body.createDiv({ cls: 'gc-slash-item-title-row' });
			titleRow.createDiv({ cls: 'gc-slash-name', text: skill.name });
			if (skillAllowsEdits(skill)) {
				titleRow.createSpan({
					cls: 'gc-skill-edit-badge',
					text: 'Edits notes',
				});
			}

			const metaParts = [`/${skill.id}/`];
			if (skill.description) {
				metaParts.push(skill.description.slice(0, 80));
			}
			body.createDiv({
				cls: 'gc-slash-meta',
				text: metaParts.join(' · '),
			});

			row.addEventListener('mousedown', (event) => {
				event.preventDefault();
				this.pick(skill);
			});
		}
	}
}
