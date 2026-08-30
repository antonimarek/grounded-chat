import type { VaultSkill } from '../skills/types';
import {
	filterSkillsForSlash,
	slashInsert,
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
		for (let i = 0; i < this.items.length; i++) {
			const skill = this.items[i];
			if (!skill) {
				continue;
			}
			const row = this.wrapEl.createDiv({
				cls: `gc-slash-item${i === this.activeIndex ? ' is-active' : ''}`,
			});
			row.createSpan({ cls: 'gc-slash-token', text: `/${skill.id}/` });
			row.createSpan({ cls: 'gc-slash-name', text: skill.name });
			if (skill.description) {
				row.createSpan({
					cls: 'gc-slash-desc',
					text: skill.description.slice(0, 120),
				});
			}
			row.addEventListener('mousedown', (event) => {
				event.preventDefault();
				this.pick(skill);
			});
		}
	}
}

export function applySkillSlashPick(
	inputEl: HTMLTextAreaElement,
	skill: VaultSkill,
): void {
	inputEl.value = slashInsert(skill);
	inputEl.focus();
	const pos = inputEl.value.length;
	inputEl.setSelectionRange(pos, pos);
}
