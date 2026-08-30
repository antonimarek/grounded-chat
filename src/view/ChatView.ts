import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type GroundedChatPlugin from '../main';
import type { RetrievedChunk } from '../index/types';
import { OpenRouterError, streamChat, type ChatMessage } from '../openrouter/client';
import { buildSystemPrompt } from '../prompt/builder';
import { retrieve } from '../retrieve/retriever';

export const VIEW_TYPE_GROUNDED_CHAT = 'grounded-chat';

interface ThreadMessage {
	role: 'user' | 'assistant';
	content: string;
}

export class ChatView extends ItemView {
	plugin: GroundedChatPlugin;
	private thread: ThreadMessage[] = [];
	private abort: AbortController | null = null;
	private streaming = false;
	private unsubIndex: (() => void) | null = null;

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
			this.bannerEl.setText(
				`Indexing notes… ${status.files} files, ${status.chunks} chunks.`,
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
		this.appendBubble('user', text);

		const evidence = retrieve(
			this.app,
			this.plugin.vaultIndex.lexical,
			text,
			{
				topK: this.plugin.settings.topK,
				activePath: this.plugin.activeNotePath(),
			},
		);
		const systemPrompt = buildSystemPrompt(evidence);

		const assistantEl = this.appendBubble('assistant', '');
		const bodyEl = assistantEl.querySelector('.gc-bubble-body') as HTMLElement;
		this.renderEvidence(assistantEl, evidence);
		this.setBusy(true);
		this.abort = new AbortController();

		let assembled = '';
		const history: ChatMessage[] = this.thread.map((message) => ({
			role: message.role,
			content: message.content,
		}));

		try {
			await streamChat({
				apiKey: this.plugin.settings.openRouterApiKey,
				baseUrl: this.plugin.settings.baseUrl,
				model: this.plugin.settings.chatModel,
				systemPrompt,
				messages: history,
				signal: this.abort.signal,
				onDelta: (delta) => {
					assembled += delta;
					bodyEl.setText(assembled);
					this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
				},
			});
			if (!assembled) {
				bodyEl.setText('(No text in response)');
			}
			this.thread.push({ role: 'assistant', content: assembled });
		} catch (error) {
			if ((error as Error).name === 'AbortError') {
				if (assembled) {
					this.thread.push({ role: 'assistant', content: assembled });
				} else {
					bodyEl.setText('(Stopped)');
				}
			} else if (error instanceof OpenRouterError) {
				bodyEl.setText(`Error ${error.status}: ${error.message}`);
			} else {
				bodyEl.setText(
					error instanceof Error ? error.message : 'Request failed',
				);
			}
		} finally {
			this.setBusy(false);
			this.abort = null;
		}
	}

	private appendBubble(
		role: 'user' | 'assistant',
		content: string,
	): HTMLElement {
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
		row.createDiv({ cls: 'gc-bubble-body' }).setText(content);
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
		return row;
	}

	private renderEvidence(row: HTMLElement, evidence: RetrievedChunk[]): void {
		const wrap = row.createDiv({ cls: 'gc-evidence' });
		wrap.createDiv({
			cls: 'gc-evidence-label',
			text: evidence.length > 0 ? 'Evidence' : 'No matching notes',
		});
		if (evidence.length === 0) {
			return;
		}
		for (const chunk of evidence) {
			const link = wrap.createEl('a', {
				cls: 'gc-evidence-link internal-link',
				text: `${chunk.title} › ${chunk.heading}`,
			});
			link.href = '#';
			link.addEventListener('click', (event) => {
				event.preventDefault();
				void this.app.workspace.openLinkText(chunk.path, '/', false);
			});
		}
	}
}
