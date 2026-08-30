import { HoverPopover, ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type GroundedChatPlugin from '../main';
import type { RetrievedChunk } from '../index/types';
import {
	computeEpistemicStatus,
	statusLabel,
	type EpistemicStatus,
} from '../chat/epistemic';
import { planAnswer, type AnswerMode } from '../chat/planner';
import { openSavedAnswer, saveAnswerToVault } from '../chat/save-answer';
import {
	slimEvidence,
	type AssistantTurn,
	type EvidenceRef,
	type ThreadMessage,
} from '../chat/types';
import { OpenRouterError, streamChat, type ChatMessage } from '../openrouter/client';
import { buildConversationPrompt, buildSystemPrompt } from '../prompt/builder';
import { wireInternalLinks } from './link-handler';
import {
	renderBubbleMarkdown,
	setBubblePlainText,
} from './markdown-bubble';

export const VIEW_TYPE_GROUNDED_CHAT = 'grounded-chat';

export class ChatView extends ItemView {
	plugin: GroundedChatPlugin;
	hoverPopover: HoverPopover | null = null;
	private thread: ThreadMessage[] = [];
	private lastAssistantTurn: AssistantTurn | null = null;
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

	isEmpty(): boolean {
		return this.thread.length === 0;
	}

	hasLastAnswer(): boolean {
		return this.lastAssistantTurn !== null;
	}

	async saveLastAnswer(): Promise<void> {
		if (!this.lastAssistantTurn) {
			return;
		}
		await this.saveTurn(this.lastAssistantTurn);
	}

	async clearChat(): Promise<void> {
		this.stop();
		this.thread = [];
		this.lastAssistantTurn = null;
		this.messagesEl.empty();
		this.renderEmpty();
		await this.plugin.persistChatThread([]);
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

		if (this.plugin.settings.persistChat && this.plugin.chatThread.length > 0) {
			this.thread = [...this.plugin.chatThread];
			await this.restoreThread();
		}
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
		if (this.thread.length === 0) {
			this.emptyEl.removeClass('gc-empty-hidden');
		} else {
			this.emptyEl.addClass('gc-empty-hidden');
		}
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

	private async restoreThread(): Promise<void> {
		for (const message of this.thread) {
			if (message.role === 'user') {
				const row = this.appendBubble('user');
				const body = row.querySelector('.gc-bubble-body') as HTMLElement;
				await this.renderBubbleBody(body, message.content);
				continue;
			}

			const row = this.appendAssistantBubble(message.status ?? null);
			if (message.mode) {
				await this.renderEvidence(
					row,
					message.evidence ?? [],
					message.mode,
					message.searchQuery,
				);
			}
			const body = row.querySelector('.gc-bubble-body') as HTMLElement;
			await this.renderBubbleBody(body, message.content);
			this.attachSaveButton(row, message);
		}
		this.rebuildLastAssistantTurn();
		this.renderEmpty();
	}

	private rebuildLastAssistantTurn(): void {
		this.lastAssistantTurn = null;
		for (let i = this.thread.length - 1; i >= 0; i--) {
			const message = this.thread[i];
			if (message?.role !== 'assistant') {
				continue;
			}
			const userQuestion = this.findUserQuestionBefore(i);
			if (!userQuestion || !message.mode) {
				break;
			}
			this.lastAssistantTurn = {
				userQuestion,
				content: message.content,
				mode: message.mode,
				status: message.status ?? null,
				searchQuery: message.searchQuery,
				evidence: message.evidence ?? [],
			};
			break;
		}
	}

	private findUserQuestionBefore(assistantIndex: number): string | null {
		for (let i = assistantIndex - 1; i >= 0; i--) {
			const message = this.thread[i];
			if (message?.role === 'user') {
				return message.content;
			}
		}
		return null;
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
		await this.plugin.persistChatThread(this.thread);

		const history: ChatMessage[] = this.thread.map((message) => ({
			role: message.role,
			content: message.content,
		}));

		const assistantRow = this.appendAssistantBubble(null);
		const bodyEl = assistantRow.querySelector('.gc-bubble-body') as HTMLElement;
		setBubblePlainText(bodyEl, 'Thinking…');
		this.setBusy(true);
		this.abort = new AbortController();

		let assembled = '';
		let planMode: AnswerMode = 'conversation';
		let planEvidence: RetrievedChunk[] = [];
		let planSearchQuery: string | undefined;

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
				onStatus: (message) => setBubblePlainText(bodyEl, message),
			});

			planMode = plan.mode;
			planEvidence = plan.evidence;
			planSearchQuery = plan.searchQuery;

			await this.renderEvidence(
				assistantRow,
				plan.evidence,
				plan.mode,
				plan.searchQuery,
			);

			if (plan.directAnswer) {
				assembled = plan.directAnswer;
				await this.finishAssistantMessage(
					assistantRow,
					bodyEl,
					text,
					assembled,
					plan.mode,
					plan.evidence,
					plan.searchQuery,
				);
				return;
			}

			const systemPrompt =
				plan.mode === 'vault'
					? buildSystemPrompt(plan.evidence)
					: buildConversationPrompt();

			setBubblePlainText(bodyEl, plan.mode === 'vault' ? 'Answering…' : '');

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
			await this.finishAssistantMessage(
				assistantRow,
				bodyEl,
				text,
				assembled,
				planMode,
				planEvidence,
				planSearchQuery,
			);
		} catch (error) {
			this.clearStreamRenderTimer();
			if ((error as Error).name === 'AbortError') {
				if (assembled) {
					await this.finishAssistantMessage(
						assistantRow,
						bodyEl,
						text,
						assembled,
						planMode,
						planEvidence,
						planSearchQuery,
					);
				} else {
					setBubblePlainText(bodyEl, '(Stopped)');
					assistantRow.remove();
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

	private async finishAssistantMessage(
		row: HTMLElement,
		bodyEl: HTMLElement,
		userQuestion: string,
		content: string,
		mode: AnswerMode,
		evidence: RetrievedChunk[],
		searchQuery?: string,
	): Promise<void> {
		this.clearStreamRenderTimer();
		if (content.trim()) {
			await this.renderBubbleBody(bodyEl, content);
		} else {
			setBubblePlainText(bodyEl, '(No text in response)');
		}

		const status = computeEpistemicStatus({
			mode,
			evidenceCount: evidence.length,
			answerText: content,
		});
		this.renderStatusBadge(row, status);

		const slim = slimEvidence(evidence);
		const message: ThreadMessage = {
			role: 'assistant',
			content,
			status: status ?? undefined,
			mode,
			searchQuery,
			evidence: slim,
		};
		this.thread.push(message);
		this.lastAssistantTurn = {
			userQuestion,
			content,
			mode,
			status,
			searchQuery,
			evidence: slim,
		};
		this.attachSaveButton(row, message);
		await this.plugin.persistChatThread(this.thread);
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

	private appendAssistantBubble(status: EpistemicStatus | null): HTMLElement {
		const row = this.appendBubble('assistant');
		this.renderStatusBadge(row, status);
		return row;
	}

	private renderStatusBadge(
		row: HTMLElement,
		status: EpistemicStatus | null,
	): void {
		const meta = row.querySelector('.gc-meta');
		if (!meta) {
			return;
		}
		meta.querySelector('.gc-status-badge')?.remove();
		if (!status) {
			return;
		}
		meta.createSpan({
			cls: `gc-status-badge gc-status-${status}`,
			text: statusLabel(status),
		});
	}

	private attachSaveButton(row: HTMLElement, message: ThreadMessage): void {
		if (message.role !== 'assistant' || !message.content.trim()) {
			return;
		}
		const meta = row.querySelector('.gc-meta');
		if (!meta || meta.querySelector('.gc-save-btn')) {
			return;
		}
		const btn = meta.createEl('button', {
			cls: 'gc-save-btn clickable-icon',
			attr: { 'aria-label': 'Save to note' },
		});
		setIcon(btn, 'download');
		btn.addEventListener('click', () => {
			const userQuestion = this.findUserQuestionForRow(row);
			if (!userQuestion) {
				new Notice('Could not find the question for this answer.');
				return;
			}
			void this.saveTurn({
				userQuestion,
				content: message.content,
				mode: message.mode ?? 'conversation',
				status: message.status ?? null,
				searchQuery: message.searchQuery,
				evidence: message.evidence ?? [],
			});
		});
	}

	private findUserQuestionForRow(row: HTMLElement): string | null {
		const rows = Array.from(this.messagesEl.querySelectorAll('.gc-row'));
		const index = rows.indexOf(row);
		if (index <= 0) {
			return null;
		}
		for (let i = index - 1; i >= 0; i--) {
			const prior = rows[i];
			if (prior?.classList.contains('gc-row-user')) {
				return prior.querySelector('.gc-bubble-body')?.textContent?.trim() ?? null;
			}
		}
		return null;
	}

	private async saveTurn(turn: AssistantTurn): Promise<void> {
		try {
			const file = await saveAnswerToVault(
				this.app,
				this.plugin.settings.saveAnswerFolder,
				turn,
			);
			await openSavedAnswer(this.app, file);
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : 'Could not save answer.',
			);
		}
	}

	private async renderEvidence(
		row: HTMLElement,
		evidence: EvidenceRef[] | RetrievedChunk[],
		mode: 'vault' | 'conversation',
		searchQuery?: string,
	): Promise<void> {
		row.querySelector('.gc-evidence')?.remove();
		const wrap = row.createDiv({ cls: 'gc-evidence' });
		let label = 'From conversation';
		if (mode === 'vault') {
			if (evidence.length > 0) {
				label = searchQuery
					? `Evidence (${evidence.length}) · search: ${searchQuery}`
					: `Evidence (${evidence.length})`;
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
			const chunkLabel =
				chunk.heading === chunk.title
					? chunk.title
					: `${chunk.title} › ${chunk.heading}`;
			return `- [[${chunk.title}|${chunkLabel}]]`;
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
