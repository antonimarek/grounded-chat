import type { App } from 'obsidian';
import {
	mentionInsert,
	mentionQueryAtCaret,
	mentionRefFromCandidate,
	rankMentionCandidates,
	type MentionCandidate,
	type MentionRef,
} from '../chat/mention';

export class MentionMenu {
	private wrapEl: HTMLElement;
	private items: MentionCandidate[] = [];
	private activeIndex = 0;
	private visible = false;
	private atIndex = 0;

	constructor(
		private anchorEl: HTMLElement,
		private onPick: (candidate: MentionCandidate, ref: MentionRef) => void,
	) {
		this.wrapEl = anchorEl.createDiv({
			cls: 'gc-slash-menu gc-mention-menu gc-slash-menu-hidden',
		});
	}

	syncInput(
		inputEl: HTMLTextAreaElement,
		app: App,
		activePath: string | null,
		recentPaths: string[],
	): boolean {
		const caret = inputEl.selectionStart ?? inputEl.value.length;
		const query = mentionQueryAtCaret(inputEl.value, caret);
		if (!query) {
			this.hide();
			return false;
		}

		this.atIndex = query.atIndex;
		this.items = rankMentionCandidates(app, query, activePath, recentPaths);
		if (this.items.length === 0) {
			this.hide();
			return false;
		}

		this.activeIndex = 0;
		this.render();
		this.show();
		return true;
	}

	getAtIndex(): number {
		return this.atIndex;
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

	private pick(candidate: MentionCandidate): void {
		this.hide();
		this.onPick(candidate, mentionRefFromCandidate(candidate));
	}

	private render(): void {
		this.wrapEl.empty();

		const header = this.wrapEl.createDiv({ cls: 'gc-slash-menu-header' });
		header.createSpan({ cls: 'gc-slash-menu-title', text: 'Mention note' });
		header.createSpan({
			cls: 'gc-slash-menu-hint',
			text: '↑↓ · Enter · Esc',
		});

		const list = this.wrapEl.createDiv({ cls: 'gc-slash-menu-list' });
		for (let i = 0; i < this.items.length; i++) {
			const candidate = this.items[i];
			if (!candidate) {
				continue;
			}
			const row = list.createDiv({
				cls: `gc-slash-item${i === this.activeIndex ? ' is-active' : ''}`,
			});
			const icon = row.createDiv({ cls: 'gc-slash-item-icon' });
			icon.setText(candidate.kind === 'note' ? '@' : '#');

			const body = row.createDiv({ cls: 'gc-slash-item-body' });
			if (candidate.kind === 'note') {
				body.createDiv({
					cls: 'gc-slash-name',
					text: candidate.title,
				});
				if (candidate.subtitle) {
					body.createDiv({
						cls: 'gc-slash-meta',
						text: candidate.subtitle,
					});
				}
			} else {
				body.createDiv({
					cls: 'gc-slash-name',
					text: candidate.heading,
				});
				body.createDiv({
					cls: 'gc-slash-meta',
					text: candidate.noteTitle,
				});
			}

			row.addEventListener('mousedown', (event) => {
				event.preventDefault();
				this.pick(candidate);
			});
		}
	}
}

export function applyMentionMenuPick(
	inputEl: HTMLTextAreaElement,
	atIndex: number,
	candidate: MentionCandidate,
): void {
	const caret = inputEl.selectionStart ?? inputEl.value.length;
	const insert = mentionInsert(candidate);
	const before = inputEl.value.slice(0, atIndex);
	const after = inputEl.value.slice(caret);
	const text = `${before}${insert} `;
	inputEl.value = text + after;
	const pos = text.length;
	inputEl.focus();
	inputEl.setSelectionRange(pos, pos);
}
