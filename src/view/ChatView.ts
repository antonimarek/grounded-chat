import { HoverPopover, ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type GroundedChatPlugin from '../main';
import type { RetrievedChunk } from '../index/types';
import { planAnswer } from '../chat/planner';
import { OpenRouterError, streamChat, type ChatMessage } from '../openrouter/client';
import { buildConversationPrompt, buildSystemPrompt } from '../prompt/builder';
import { wireInternalLinks } from './link-handler';
import {
	renderBubbleMarkdown,
	setBubblePlainText,
} from './markdown-bubble';

export const VIEW_TYPE_GROUNDED_CHAT = 'grounded-chat';

interface ThreadMessage {
	role: 'user' | 'assistant';
	content: string;
}

export class ChatView extends ItemView {
	plugin: GroundedChatPlugin;
	hoverPopover: HoverPopover | null = null;
	private thread: ThreadMessage[] = [];
	private abort: AbortController | null = null;
	private streaming = false;
	private unsubIndex: (() => void) | null = null;
	private streamRenderTimer: number | null = null;

	private bannerEl!: HTMLElement;
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private emptyEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: GroundedChatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_GROUNDED_CHAT;
	}

	getDisplayText(): string {
		return 'Chat';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('gc-root');

		this.bannerEl = this.contentEl.createDiv({ cls: 'gc-banner' });
		this.updateBanner();
		this.unsubIndex = this.plugin.vaultIndex.onChange(() => {
			this.updateBanner();
		});

		this.emptyEl = this.contentEl.createDiv({ cls: 'gc-empty' });
		this.renderEmpty();

		this.messagesEl = this.contentEl.createDiv({ cls: 'gc-messages' });
		wireInternalLinks(this.app, this, this.messagesEl, () => this.sourcePath());

		const composer = this.contentEl.createDiv({ cls: 'gc-composer' });
		this.inputEl = composer.createEl('textarea', {
			cls: 'gc-input',
			attr: {
				rows: '3',
				placeholder: 'Ask a question',
			},
		});
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.send();
			}
		});

		const actions = composer.createDiv({ cls: 'gc-actions' });
		this.sendBtn = actions.createEl('button', {
			cls: 'gc-btn mod-cta',
			text: 'Send',
		});
		this.sendBtn.addEventListener('click', () => void this.send());

		this.stopBtn = actions.createEl('button', {
			cls: 'gc-btn',
			text: 'Stop',
		});
		this.stopBtn.hidden = true;
		this.stopBtn.addEventListener('click', () => this.stop());
	}

	async onClose(): Promise<void> {
		this.clearStreamRenderTimer();
		this.stop();
		this.unsubIndex?.();
		this.unsubIndex = null;
	}

	private updateBanner(): void {
		const status = this.plugin.vaultIndex.status;
		if (this.bannerEl === undefined) {
			return;
		}
		if (status.indexing) {
			const progress =
				status.syncTotal > 0
					? `${status.syncDone}/${status.syncTotal} files`
					: `${status.files} files`;
			this.bannerEl.setText(
				`Indexing notes… ${progress}, ${status.chunks} chunks.`,
			);
			return;
		}
		if (!status.ready) {
			this.bannerEl.setText('Preparing local note index.');
			return;
		}
		this.bannerEl.setText(
			`Answers use retrieved notes. ${status.files} files, ${status.chunks} chunks.`,
		);
	}

	private renderEmpty(): void {
		this.emptyEl.empty();
		const key = this.plugin.settings.openRouterApiKey;
		if (!key) {
			this.emptyEl.removeClass('gc-empty-hidden');
			this.emptyEl.createEl('p', {
				text: 'Set an API key in settings to start.',
			});
			const btn = this.emptyEl.createEl('button', {
				cls: 'mod-cta',
				text: 'Open settings',
			});
			btn.addEventListener('click', () => {
				const setting = (
					this.app as unknown as {
						setting?: {
							open: () => void;
							openTabById: (id: string) => void;
						};
					}
				).setting;
				setting?.open();
				setting?.openTabById(this.plugin.manifest.id);
			});
			return;
		}
		this.emptyEl.addClass('gc-empty-hidden');
	}

	private stop(): void {
		this.abort?.abort();
		this.abort = null;
		this.streaming = false;
		this.setBusy(false);
	}

	private setBusy(busy: boolean): void {
		this.streaming = busy;
		this.sendBtn.disabled = busy;
		this.inputEl.disabled = busy;
		this.stopBtn.hidden = !busy;
	}

	private sourcePath(): string {
		return this.plugin.activeNotePath() ?? '';
	}

	private clearStreamRenderTimer(): void {
		if (this.streamRenderTimer !== null) {
			window.clearTimeout(this.streamRenderTimer);
			this.streamRenderTimer = null;
		}
	}

	private scheduleBubbleRender(bodyEl: HTMLElement, markdown: string): void {
		this.clearStreamRenderTimer();
		this.streamRenderTimer = window.setTimeout(() => {
			this.streamRenderTimer = null;
			void this.renderBubbleBody(bodyEl, markdown);
		}, 120);
	}

	private async renderBubbleBody(
		bodyEl: HTMLElement,
		markdown: string,
	): Promise<void> {
		await renderBubbleMarkdown(
			this.app,
			bodyEl,
			markdown,
			this.sourcePath(),
			this,
		);
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private async send(): Promise<void> {
		if (this.streaming) {
			return;
		}
		const text = this.inputEl.value.trim();
		if (!text) {
			return;
		}
		this.renderEmpty();
		if (!this.plugin.settings.openRouterApiKey) {
			return;
		}

		this.inputEl.value = '';
		this.thread.push({ role: 'user', content: text });
		const userRow = this.appendBubble('user');
		const userBody = userRow.querySelector('.gc-bubble-body') as HTMLElement;
		await this.renderBubbleBody(userBody, text);

		const history: ChatMessage[] = this.thread.map((message) => ({
			role: message.role,
			content: message.content,
		}));

		const assistantRow = this.appendBubble('assistant');
		const bodyEl = assistantRow.querySelector('.gc-bubble-body') as HTMLElement;
		setBubblePlainText(bodyEl, 'Thinking…');
		this.setBusy(true);
		this.abort = new AbortController();

		let assembled = '';

		try {
			const plan = await planAnswer({
				app: this.app,
				lexical: this.plugin.vaultIndex.lexical,
				apiKey: this.plugin.settings.openRouterApiKey,
				baseUrl: this.plugin.settings.baseUrl,
				model: this.plugin.settings.chatModel,
				userMessage: text,
				history,
				topK: this.plugin.settings.topK,
				activePath: this.plugin.activeNotePath(),
				signal: this.abort.signal,
			});

			await this.renderEvidence(
				assistantRow,
				plan.evidence,
				plan.mode,
				plan.searchQuery,
			);

			if (plan.directAnswer) {
				assembled = plan.directAnswer;
				await this.renderBubbleBody(bodyEl, assembled);
				this.thread.push({ role: 'assistant', content: assembled });
				return;
			}

			const systemPrompt =
				plan.mode === 'vault'
					? buildSystemPrompt(plan.evidence)
					: buildConversationPrompt();

			setBubblePlainText(bodyEl, '');

			await streamChat({
				apiKey: this.plugin.settings.openRouterApiKey,
				baseUrl: this.plugin.settings.baseUrl,
				model: this.plugin.settings.chatModel,
				systemPrompt,
				messages: history,
				signal: this.abort.signal,
				onDelta: (delta) => {
					assembled += delta;
					this.scheduleBubbleRender(bodyEl, assembled);
				},
			});
			this.clearStreamRenderTimer();
			if (!assembled) {
				setBubblePlainText(bodyEl, '(No text in response)');
			} else {
				await this.renderBubbleBody(bodyEl, assembled);
			}
			this.thread.push({ role: 'assistant', content: assembled });
		} catch (error) {
			this.clearStreamRenderTimer();
			if ((error as Error).name === 'AbortError') {
				if (assembled) {
					this.thread.push({ role: 'assistant', content: assembled });
					await this.renderBubbleBody(bodyEl, assembled);
				} else {
					setBubblePlainText(bodyEl, '(Stopped)');
				}
			} else if (error instanceof OpenRouterError) {
				setBubblePlainText(bodyEl, `Error ${error.status}: ${error.message}`);
			} else {
				setBubblePlainText(
					bodyEl,
					error instanceof Error ? error.message : 'Request failed',
				);
			}
		} finally {
			this.setBusy(false);
			this.abort = null;
		}
	}

	private appendBubble(role: 'user' | 'assistant'): HTMLElement {
		this.emptyEl.addClass('gc-empty-hidden');
		const row = this.messagesEl.createDiv({
			cls: `gc-row gc-row-${role}`,
		});
		const meta = row.createDiv({ cls: 'gc-meta' });
		const icon = meta.createSpan({ cls: 'gc-meta-icon' });
		setIcon(icon, role === 'user' ? 'user' : 'bot');
		meta.createSpan({
			cls: 'gc-meta-label',
			text: role === 'user' ? 'You' : 'Model',
		});
		row.createDiv({ cls: 'gc-bubble-body' });
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		return row;
	}

	private async renderEvidence(
		row: HTMLElement,
		evidence: RetrievedChunk[],
		mode: 'vault' | 'conversation',
		searchQuery?: string,
	): Promise<void> {
		const wrap = row.createDiv({ cls: 'gc-evidence' });
		let label = 'From conversation';
		if (mode === 'vault') {
			if (evidence.length > 0) {
				label = searchQuery
					? `Evidence · search: ${searchQuery}`
					: 'Evidence';
			} else {
				label = 'No matching notes';
			}
		}
		wrap.createDiv({
			cls: 'gc-evidence-label',
			text: label,
		});
		if (mode !== 'vault' || evidence.length === 0) {
			return;
		}
		const listEl = wrap.createDiv({ cls: 'gc-evidence-list markdown-rendered' });
		const lines = evidence.map((chunk) => {
			const label =
				chunk.heading === chunk.title
					? chunk.title
					: `${chunk.title} › ${chunk.heading}`;
			return `- [[${chunk.title}|${label}]]`;
		});
		await renderBubbleMarkdown(
			this.app,
			listEl,
			lines.join('\n'),
			this.sourcePath(),
			this,
		);
	}
}
