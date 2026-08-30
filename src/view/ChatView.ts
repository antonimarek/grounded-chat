import { HoverPopover, ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type GroundedChatPlugin from '../main';
import type { RetrievedChunk } from '../index/types';
import {
	computeEpistemicStatus,
	statusLabel,
	type EpistemicStatus,
} from '../chat/epistemic';
import {
	attachedNotePromptSection,
	loadAttachedNote,
	resolveNoteMentionPath,
	shouldIsolateAttachedTurn,
} from '../chat/attached-note';
import {
	estimateNoteSize,
	formatNoteSizeHint,
	mentionChipLabel,
	mentionRefKey,
	mentionRefsEqual,
	removeWikilinkFromText,
	syncMentionsFromText,
	type MentionRef,
} from '../chat/mention';
import {
	applyNoteProposal,
	computeProposalDiffStats,
	hasProposalBlock,
	parseNoteProposal,
	shouldRequestProposal,
	stripProposalBlock,
} from '../chat/note-proposal';
import { planAnswer, type AnswerMode } from '../chat/planner';
import { openSavedAnswer, saveAnswerToVault } from '../chat/save-answer';
import {
	slimEvidence,
	type AssistantTurn,
	type EvidenceRef,
	type NoteProposal,
	type ThreadMessage,
} from '../chat/types';
import { OpenRouterError, streamChat, type ChatMessage } from '../openrouter/client';
import {
	formatTokenCount,
	formatUsageSummary,
	emptyUsage,
	mergeUsage,
	type TokenUsage,
} from '../openrouter/usage';
import {
	buildAttachedNoteEditPrompt,
	buildAttachedNotePrompt,
	buildConversationPrompt,
	buildSystemPrompt,
} from '../prompt/builder';
import {
	findSkill,
	skillPromptSection,
} from '../skills/loader';
import { parseSkillSlash, stripSkillSlashPrefix, ambiguousSkillMatches } from '../skills/slash';
import type { VaultSkill } from '../skills/types';
import { skillAllowsEdits } from '../skills/types';
import { wireInternalLinks } from './link-handler';
import {
	applyMentionMenuPick,
	MentionMenu,
} from './mention-menu';
import {
	SkillSlashMenu,
} from './skill-slash-menu';
import { SkillPicker } from './skill-picker';
import { SkillPreviewModal } from './skill-preview-modal';
import {
	renderBubbleMarkdown,
	setBubblePlainText,
} from './markdown-bubble';
import type { AttachedNote } from '../chat/attached-note';
import { stripFrontmatter } from '../index/chunker';
import { evidenceListLine } from '../vault/links';

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
	private skillPicker: SkillPicker | null = null;
	private usageFooterEl!: HTMLElement;
	private newChatBtn!: HTMLButtonElement;
	private skillSlashMenu: SkillSlashMenu | null = null;
	private mentionMenu: MentionMenu | null = null;
	private contextChipsEl!: HTMLElement;
	private composerMentions: MentionRef[] = [];

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

	hasLastProposal(): boolean {
		return Boolean(
			this.lastAssistantTurn?.proposal && !this.lastAssistantTurn.proposal.applied,
		);
	}

	async applyLastProposal(): Promise<void> {
		for (let i = this.thread.length - 1; i >= 0; i--) {
			const message = this.thread[i];
			if (
				message?.role === 'assistant' &&
				message.proposal &&
				!message.proposal.applied
			) {
				await this.applyProposalByIndex(i);
				return;
			}
		}
		new Notice('No pending note proposal.');
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
		this.composerMentions = [];
		await this.deactivateSkill();
		void this.renderContextChips();
		this.messagesEl.empty();
		this.renderEmpty();
		this.refreshNewChatUi();
		this.plugin.sessionUsage = emptyUsage();
		this.refreshUsageDisplay();
		await this.plugin.persistChatThread([]);
	}

	refreshSkillsUi(): void {
		const current = this.plugin.settings.activeSkillId;
		if (current && !findSkill(this.plugin.skills, current)) {
			this.plugin.settings.activeSkillId = '';
			void this.plugin.saveSettings();
		}
		this.skillPicker?.refresh();
		void this.renderContextChips();
	}

	refreshUsageDisplay(): void {
		if (!this.usageFooterEl) {
			return;
		}
		if (!this.plugin.settings.showTokenUsage) {
			this.usageFooterEl.setText('');
			this.usageFooterEl.addClass('gc-usage-hidden');
			return;
		}
		this.usageFooterEl.removeClass('gc-usage-hidden');
		const usage = this.plugin.sessionUsage;
		if (usage.totalTokens <= 0) {
			this.usageFooterEl.setText('Session tokens: —');
			return;
		}
		this.usageFooterEl.setText(
			`Session tokens: ↓${formatTokenCount(usage.promptTokens)} ↑${formatTokenCount(usage.completionTokens)} (${formatTokenCount(usage.totalTokens)} total)`,
		);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('gc-root');

		const header = this.contentEl.createDiv({ cls: 'gc-header' });
		this.bannerEl = header.createDiv({ cls: 'gc-banner' });
		const headerActions = header.createDiv({ cls: 'gc-header-actions' });
		this.newChatBtn = headerActions.createEl('button', {
			cls: 'gc-btn gc-btn-small gc-new-chat-btn',
			text: 'New chat',
			attr: {
				title: 'Clear the thread and start over',
			},
		});
		this.newChatBtn.addEventListener('click', () => void this.clearChat());
		this.updateBanner();
		this.unsubIndex = this.plugin.vaultIndex.onChange(() => {
			this.updateBanner();
		});

		this.emptyEl = this.contentEl.createDiv({ cls: 'gc-empty' });
		this.renderEmpty();

		this.messagesEl = this.contentEl.createDiv({ cls: 'gc-messages' });
		wireInternalLinks(this.app, this, this.messagesEl, () => this.sourcePath());

		const contextBar = this.contentEl.createDiv({ cls: 'gc-context-bar' });

		const skillGroup = contextBar.createDiv({ cls: 'gc-context-group' });
		skillGroup.createSpan({ cls: 'gc-context-label', text: 'Skill' });
		this.skillPicker = new SkillPicker(skillGroup, this.plugin, (skill) => {
			if (skill) {
				void this.activateSkill(skill);
			} else {
				void this.deactivateSkill();
			}
		});
		this.skillPicker.refresh();
		void this.plugin.refreshSkills();

		const composer = this.contentEl.createDiv({ cls: 'gc-composer' });
		this.contextChipsEl = composer.createDiv({ cls: 'gc-context-chips' });
		void this.renderContextChips();

		const inputWrap = composer.createDiv({ cls: 'gc-input-wrap' });
		this.inputEl = inputWrap.createEl('textarea', {
			cls: 'gc-input',
			attr: {
				rows: '3',
				placeholder: 'Ask a question, type /skill/, or @mention a note',
			},
		});
		this.mentionMenu = new MentionMenu(inputWrap, (candidate, ref) => {
			const atIndex = this.mentionMenu?.getAtIndex() ?? 0;
			applyMentionMenuPick(this.inputEl, atIndex, candidate);
			this.addComposerMention(ref);
		});
		this.skillSlashMenu = new SkillSlashMenu(inputWrap, (skill) => {
			void this.onSkillSlashPick(skill);
		});
		this.inputEl.addEventListener('input', () => {
			void this.onComposerInput();
		});
		this.inputEl.addEventListener('keydown', (event) => {
			if (this.mentionMenu?.handleKeyDown(event)) {
				return;
			}
			if (this.skillSlashMenu?.handleKeyDown(event)) {
				return;
			}
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this.mentionMenu?.hide();
				this.skillSlashMenu?.hide();
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

		this.usageFooterEl = this.contentEl.createDiv({ cls: 'gc-usage-footer' });
		this.refreshUsageDisplay();

		if (this.plugin.settings.persistChat && this.plugin.chatThread.length > 0) {
			this.thread = [...this.plugin.chatThread];
			await this.restoreThread();
		}
		this.refreshNewChatUi();
	}

	async onClose(): Promise<void> {
		this.clearStreamRenderTimer();
		this.stop();
		this.skillPicker?.destroy();
		this.skillPicker = null;
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
		this.refreshNewChatUi();
	}

	private refreshNewChatUi(): void {
		if (!this.newChatBtn) {
			return;
		}
		const hasThread = this.thread.length > 0;
		this.newChatBtn.disabled = !hasThread && !this.streaming;
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
		for (let index = 0; index < this.thread.length; index++) {
			const message = this.thread[index];
			if (!message) {
				continue;
			}
			if (message.role === 'user') {
				const row = this.appendBubble('user', message.skillId);
				row.dataset.gcThreadIndex = String(index);
				const body = row.querySelector('.gc-bubble-body') as HTMLElement;
				await this.renderBubbleBody(body, message.content);
				continue;
			}

			const row = this.appendAssistantBubble(message.status ?? null);
			row.dataset.gcThreadIndex = String(index);
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
			if (message.proposal && !message.proposal.applied) {
				await this.renderProposalCard(row, index);
			} else if (message.proposal?.applied) {
				this.renderAppliedProposalBadge(row);
			}
			if (message.usage) {
				this.renderTokenBadge(row, message.usage, message.skillId);
			}
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
				skillId: message.skillId,
				usage: message.usage,
				proposal: message.proposal,
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
		const raw = this.inputEl.value.trim();
		if (!raw) {
			return;
		}
		this.renderEmpty();
		if (!this.plugin.settings.openRouterApiKey) {
			return;
		}

		const parsed = parseSkillSlash(raw, this.plugin.skills);
		if (!parsed.skill && raw.startsWith('/')) {
			const tokenMatch = /^\/([^\s/]+)/.exec(raw);
			const token = tokenMatch?.[1];
			if (token) {
				const matches = ambiguousSkillMatches(token, this.plugin.skills);
				if (matches.length > 1) {
					new Notice(
						`Ambiguous skill: ${matches.map((skill) => skill.name).join(', ')}`,
					);
					return;
				}
			}
		}

		if (parsed.skill && !parsed.message) {
			await this.activateSkill(parsed.skill);
			this.inputEl.value = '';
			this.skillSlashMenu?.hide();
			this.mentionMenu?.hide();
			this.updateComposerPlaceholder();
			new Notice('Skill active. @mention a note to continue.');
			return;
		}

		let text = parsed.skill ? parsed.message : raw;
		if (!text && !parsed.skill) {
			return;
		}

		if (parsed.skill) {
			await this.activateSkill(parsed.skill);
		}

		const mentionFromText = resolveNoteMentionPath(this.app, text);
		const attachedPath =
			this.composerMentions[0]?.path ?? mentionFromText.path;

		if (!text && !attachedPath) {
			new Notice('Add a message or @mention a note.');
			return;
		}

		if (mentionFromText.linktext && !mentionFromText.path) {
			new Notice(`Could not resolve note: ${mentionFromText.linktext}`);
		}

		this.inputEl.value = '';
		this.composerMentions = [];
		void this.renderContextChips();
		this.skillSlashMenu?.hide();
		this.mentionMenu?.hide();

		const activeSkill = parsed.skill ?? this.getActiveSkill();
		this.thread.push({
			role: 'user',
			content: text,
			skillId: activeSkill?.id,
		});
		const userRow = this.appendBubble('user', activeSkill?.id);
		const userBody = userRow.querySelector('.gc-bubble-body') as HTMLElement;
		await this.renderBubbleBody(userBody, text);
		this.refreshNewChatUi();
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
		let turnUsage: TokenUsage | null = null;

		const attachedNote = attachedPath
			? await loadAttachedNote(this.app, attachedPath)
			: null;
		if (attachedNote) {
			this.renderAttachedBadge(userRow, attachedNote.title);
		}
		const attachedSection = attachedNote
			? attachedNotePromptSection(attachedNote)
			: undefined;
		const skillInstructions = activeSkill
			? skillPromptSection(activeSkill)
			: undefined;
		const skillHint =
			attachedNote || !activeSkill
				? undefined
				: `Active skill "${activeSkill.name}" may require vault search for related links or note content.`;
		const requestProposal = shouldRequestProposal({
			attachedNote,
			skill: activeSkill,
			userMessage: text,
		});
		const streamHistory: ChatMessage[] =
			attachedNote && shouldIsolateAttachedTurn(text)
				? [{ role: 'user', content: text }]
				: history;

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
				activePath: attachedNote?.path ?? this.plugin.activeNotePath(),
				signal: this.abort.signal,
				skillHint,
				attachedNote,
				onStatus: (message) => setBubblePlainText(bodyEl, message),
			});

			planMode = plan.mode;
			planEvidence = plan.evidence;
			planSearchQuery = plan.searchQuery;
			turnUsage = plan.usage;

			await this.renderEvidence(
				assistantRow,
				plan.evidence,
				plan.mode,
				plan.searchQuery,
				attachedNote,
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
					turnUsage,
					activeSkill?.id,
					{ attachedNote, requestProposal },
				);
				return;
			}

			const systemPrompt =
				plan.mode === 'vault'
					? buildSystemPrompt(
							plan.evidence,
							skillInstructions,
							attachedSection,
						)
					: plan.mode === 'attached'
						? requestProposal
							? buildAttachedNoteEditPrompt(
									skillInstructions,
									attachedSection,
									attachedNote?.path,
								)
							: buildAttachedNotePrompt(
									skillInstructions,
									attachedSection,
								)
						: buildConversationPrompt(skillInstructions, attachedSection);

			setBubblePlainText(
				bodyEl,
				plan.mode === 'vault' || plan.mode === 'attached' ? 'Answering…' : '',
			);

			const stream = await streamChat({
				apiKey: this.plugin.settings.openRouterApiKey,
				baseUrl: this.plugin.settings.baseUrl,
				model: this.plugin.settings.chatModel,
				systemPrompt,
				messages: streamHistory,
				signal: this.abort.signal,
				onDelta: (delta) => {
					assembled += delta;
					this.scheduleBubbleRender(bodyEl, assembled);
				},
			});
			this.clearStreamRenderTimer();
			turnUsage = mergeUsage(turnUsage, stream.usage);
			await this.finishAssistantMessage(
				assistantRow,
				bodyEl,
				text,
				assembled,
				planMode,
				planEvidence,
				planSearchQuery,
				turnUsage,
				activeSkill?.id,
				{ attachedNote, requestProposal },
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
						turnUsage,
						activeSkill?.id,
						{ attachedNote, requestProposal },
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
		usage?: TokenUsage | null,
		skillId?: string,
		options?: {
			attachedNote?: AttachedNote | null;
			requestProposal?: boolean;
		},
	): Promise<void> {
		this.clearStreamRenderTimer();

		let displayContent = content;
		let proposal: NoteProposal | undefined;

		if (options?.requestProposal && options.attachedNote) {
			const parsed = await parseNoteProposal(
				this.app,
				content,
				options.attachedNote.path,
			);
			if (parsed) {
				proposal = parsed.proposal;
				displayContent = parsed.displayContent;
			} else if (hasProposalBlock(content)) {
				displayContent = stripProposalBlock(content);
				new Notice(
					'Edit proposal block found but could not be parsed. Try asking again.',
				);
			}
		}

		if (displayContent.trim()) {
			await this.renderBubbleBody(bodyEl, displayContent);
		} else {
			setBubblePlainText(bodyEl, '(No text in response)');
		}

		const status = computeEpistemicStatus({
			mode,
			evidenceCount: evidence.length,
			answerText: displayContent,
		});
		this.renderStatusBadge(row, status);
		this.renderTokenBadge(row, usage ?? null, skillId);

		const slim = slimEvidence(evidence);
		const message: ThreadMessage = {
			role: 'assistant',
			content: displayContent,
			status: status ?? undefined,
			mode,
			searchQuery,
			evidence: slim,
			skillId,
			usage: usage ?? undefined,
			proposal,
		};
		this.thread.push(message);
		const messageIndex = this.thread.length - 1;
		row.dataset.gcThreadIndex = String(messageIndex);

		this.lastAssistantTurn = {
			userQuestion,
			content: displayContent,
			mode,
			status,
			searchQuery,
			evidence: slim,
			skillId,
			usage: usage ?? undefined,
			proposal,
		};
		if (proposal && !proposal.applied) {
			await this.renderProposalCard(row, messageIndex);
		}
		this.attachSaveButton(row, message);
		this.plugin.addSessionUsage(usage);
		await this.plugin.persistChatThread(this.thread);
	}

	private getActiveSkill(): VaultSkill | null {
		return findSkill(this.plugin.skills, this.plugin.settings.activeSkillId);
	}

	private async activateSkill(skill: VaultSkill): Promise<void> {
		this.plugin.settings.activeSkillId = skill.id;
		await this.plugin.saveSettings();
		this.skillPicker?.refresh();
		this.updateComposerPlaceholder();
		void this.renderContextChips();
	}

	private async deactivateSkill(): Promise<void> {
		this.plugin.settings.activeSkillId = '';
		await this.plugin.saveSettings();
		this.skillPicker?.refresh();
		this.updateComposerPlaceholder();
		void this.renderContextChips();
	}

	private async onSkillSlashPick(skill: VaultSkill): Promise<void> {
		this.inputEl.value = stripSkillSlashPrefix(this.inputEl.value);
		await this.activateSkill(skill);
		this.skillSlashMenu?.hide();
		this.inputEl.focus();
		const pos = this.inputEl.value.length;
		this.inputEl.setSelectionRange(pos, pos);
	}

	private async onComposerInput(): Promise<void> {
		const mentionActive = this.mentionMenu?.syncInput(
			this.inputEl,
			this.app,
			this.plugin.activeNotePath(),
			this.plugin.recentMarkdownPaths(),
		);
		if (!mentionActive) {
			this.skillSlashMenu?.syncInput(
				this.inputEl.value,
				this.plugin.skills,
			);
		} else {
			this.skillSlashMenu?.hide();
		}
		await this.syncComposerMentionsFromText();
	}

	private addComposerMention(ref: MentionRef): void {
		if (this.composerMentions.some((existing) => mentionRefsEqual(existing, ref))) {
			void this.renderContextChips();
			return;
		}
		this.composerMentions.push(ref);
		void this.renderContextChips();
	}

	private removeComposerMention(ref: MentionRef): void {
		this.composerMentions = this.composerMentions.filter(
			(existing) => !mentionRefsEqual(existing, ref),
		);
		this.inputEl.value = removeWikilinkFromText(
			this.inputEl.value,
			ref.linktext,
		);
		void this.renderContextChips();
	}

	private async syncComposerMentionsFromText(): Promise<void> {
		const synced = await syncMentionsFromText(this.app, this.inputEl.value);
		const keys = new Set(synced.map((ref) => mentionRefKey(ref)));
		const kept = this.composerMentions.filter((ref) =>
			keys.has(mentionRefKey(ref)),
		);
		for (const ref of synced) {
			if (!kept.some((existing) => mentionRefsEqual(existing, ref))) {
				kept.push(ref);
			}
		}
		this.composerMentions = kept;
		await this.renderContextChips();
	}

	private async renderContextChips(): Promise<void> {
		if (!this.contextChipsEl) {
			return;
		}
		this.contextChipsEl.empty();

		const activeSkill = this.getActiveSkill();
		const hasMentions = this.composerMentions.length > 0;
		const hasSkill = Boolean(activeSkill);

		if (!hasMentions && !hasSkill) {
			this.contextChipsEl.addClass('gc-context-chips-hidden');
			return;
		}

		this.contextChipsEl.removeClass('gc-context-chips-hidden');
		this.contextChipsEl.createSpan({
			cls: 'gc-context-chips-label',
			text: 'Context',
		});
		const row = this.contextChipsEl.createDiv({ cls: 'gc-context-chips-row' });

		if (activeSkill) {
			const chip = row.createDiv({
				cls: 'gc-context-chip gc-context-chip-skill',
			});
			chip.createSpan({
				cls: 'gc-context-chip-label',
				text: activeSkill.name,
			});
			const editHint = skillAllowsEdits(activeSkill)
				? ' · Can propose note edits when a note is attached'
				: '';
			chip.title = activeSkill.description
				? `${activeSkill.description}${editHint}`
				: activeSkill.name;
			chip.addEventListener('dblclick', () => {
				new SkillPreviewModal(this.app, activeSkill).open();
			});
			const removeBtn = chip.createEl('button', {
				cls: 'gc-context-chip-remove',
				text: '×',
				attr: { 'aria-label': `Remove ${activeSkill.name}` },
			});
			removeBtn.addEventListener('click', () => {
				void this.deactivateSkill();
			});
		}

		for (const ref of this.composerMentions) {
			const chip = row.createDiv({ cls: 'gc-context-chip' });
			chip.createSpan({
				cls: 'gc-context-chip-label',
				text: mentionChipLabel(ref),
			});
			const removeBtn = chip.createEl('button', {
				cls: 'gc-context-chip-remove',
				text: '×',
				attr: { 'aria-label': `Remove ${mentionChipLabel(ref)}` },
			});
			removeBtn.addEventListener('click', () => {
				this.removeComposerMention(ref);
			});
		}

		if (activeSkill && skillAllowsEdits(activeSkill) && hasMentions) {
			this.contextChipsEl.createSpan({
				cls: 'gc-context-hint',
				text: 'This skill may propose edits. You approve before anything writes to the vault.',
			});
		}

		const primary = this.composerMentions[0];
		if (!primary) {
			return;
		}
		const size = await estimateNoteSize(this.app, primary.path);
		const hint = formatNoteSizeHint(size);
		if (hint) {
			this.contextChipsEl.createSpan({
				cls: 'gc-context-hint',
				text: `Grounded to: ${primary.title} · ${hint}`,
			});
		} else {
			this.contextChipsEl.createSpan({
				cls: 'gc-context-hint',
				text: `Grounded to: ${mentionChipLabel(primary)}`,
			});
		}
	}

	private updateComposerPlaceholder(): void {
		if (!this.inputEl) {
			return;
		}
		const skill = this.getActiveSkill();
		const active = this.plugin.activeNotePath();
		if (skill && active && !this.inputEl.value.trim()) {
			const title = this.noteTitle(active);
			this.inputEl.placeholder = `@${title} to ground this skill`;
			return;
		}
		this.inputEl.placeholder =
			'Ask a question, type /skill/, or @mention a note';
	}

	private renderAttachedBadge(row: HTMLElement, title: string): void {
		const meta = row.querySelector('.gc-meta');
		if (!meta) {
			return;
		}
		meta.createSpan({
			cls: 'gc-attached-badge',
			text: title,
			attr: { title: 'Attached note for this message' },
		});
	}

	private noteTitle(path: string): string {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file?.name.replace(/\.md$/i, '') ?? path;
	}

	private renderTokenBadge(
		row: HTMLElement,
		usage: TokenUsage | null,
		skillId?: string,
	): void {
		const meta = row.querySelector('.gc-meta');
		if (!meta) {
			return;
		}
		meta.querySelector('.gc-skill-badge')?.remove();
		meta.querySelector('.gc-usage-badge')?.remove();

		if (skillId) {
			const skill = findSkill(this.plugin.skills, skillId);
			if (skill) {
				meta.createSpan({
					cls: 'gc-skill-badge',
					text: skill.name,
					attr: { title: skill.description || skill.name },
				});
			}
		}

		if (!this.plugin.settings.showTokenUsage || !usage) {
			return;
		}
		if (usage.totalTokens <= 0 && usage.promptTokens <= 0 && usage.completionTokens <= 0) {
			return;
		}
		meta.createSpan({
			cls: 'gc-usage-badge',
			text: formatUsageSummary(usage),
			attr: { title: 'Prompt ↓ · completion ↑ tokens for this reply' },
		});
	}

	private appendBubble(role: 'user' | 'assistant', skillId?: string): HTMLElement {
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
		if (skillId) {
			const skill = findSkill(this.plugin.skills, skillId);
			if (skill) {
				meta.createSpan({
					cls: 'gc-skill-badge',
					text: skill.name,
					attr: { title: skill.description || skill.name },
				});
			}
		}
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

	private async renderProposalCard(
		row: HTMLElement,
		messageIndex: number,
	): Promise<void> {
		const message = this.thread[messageIndex];
		const proposal = message?.proposal;
		if (message?.role !== 'assistant' || !proposal || proposal.applied) {
			return;
		}

		row.querySelector('.gc-proposal')?.remove();
		const card = row.createDiv({ cls: 'gc-proposal' });

		const skill = message.skillId
			? findSkill(this.plugin.skills, message.skillId)
			: null;
		const viaSkill =
			skill && skillAllowsEdits(skill) ? ` · via ${skill.name}` : '';
		card.createDiv({
			cls: 'gc-proposal-label',
			text: `Proposed edit · ${this.noteTitle(proposal.path)}${viaSkill}`,
		});

		const beforeBody = await this.readNoteBody(proposal.path);
		const stats = computeProposalDiffStats(beforeBody, proposal.content);
		card.createDiv({
			cls: 'gc-proposal-stats',
			text: `+${stats.added} / −${stats.removed} lines`,
		});

		const preview = card.createDiv({
			cls: 'gc-proposal-preview gc-proposal-preview-hidden',
		});
		preview.createDiv({ cls: 'gc-proposal-preview-label', text: 'Before' });
		preview.createEl('pre', {
			cls: 'gc-proposal-preview-text',
			text: beforeBody.slice(0, 4000),
		});
		preview.createDiv({ cls: 'gc-proposal-preview-label', text: 'After' });
		preview.createEl('pre', {
			cls: 'gc-proposal-preview-text',
			text: proposal.content.slice(0, 4000),
		});

		const actions = card.createDiv({ cls: 'gc-proposal-actions' });
		const previewBtn = actions.createEl('button', {
			cls: 'gc-btn gc-btn-small',
			text: 'Show preview',
		});
		const applyBtn = actions.createEl('button', {
			cls: 'gc-btn gc-btn-small mod-cta',
			text: 'Apply to note',
		});
		const copyBtn = actions.createEl('button', {
			cls: 'gc-btn gc-btn-small',
			text: 'Copy body',
		});
		const dismissBtn = actions.createEl('button', {
			cls: 'gc-btn gc-btn-small',
			text: 'Dismiss',
		});

		previewBtn.addEventListener('click', () => {
			const hidden = preview.hasClass('gc-proposal-preview-hidden');
			preview.toggleClass('gc-proposal-preview-hidden', !hidden);
			previewBtn.setText(hidden ? 'Hide preview' : 'Show preview');
		});
		applyBtn.addEventListener('click', () =>
			void this.applyProposalByIndex(messageIndex, row),
		);
		copyBtn.addEventListener('click', () => {
			void navigator.clipboard.writeText(proposal.content);
			new Notice('Copied proposed body.');
		});
		dismissBtn.addEventListener('click', () => card.remove());
	}

	private renderAppliedProposalBadge(row: HTMLElement): void {
		row.querySelector('.gc-proposal')?.remove();
		const card = row.createDiv({
			cls: 'gc-proposal gc-proposal-applied',
		});
		card.createDiv({
			cls: 'gc-proposal-label',
			text: 'Applied to note',
		});
	}

	private async applyProposalByIndex(
		messageIndex: number,
		row?: HTMLElement,
	): Promise<void> {
		const message = this.thread[messageIndex];
		const proposal = message?.proposal;
		if (message?.role !== 'assistant' || !proposal || proposal.applied) {
			return;
		}

		try {
			const file = await applyNoteProposal(this.app, proposal);
			const appliedProposal: NoteProposal = { ...proposal, applied: true };
			this.thread[messageIndex] = {
				...message,
				proposal: appliedProposal,
			};
			if (this.lastAssistantTurn?.proposal?.path === proposal.path) {
				this.lastAssistantTurn = {
					...this.lastAssistantTurn,
					proposal: appliedProposal,
				};
			}
			await this.plugin.persistChatThread(this.thread);

			const targetRow =
				row ??
				this.findRowForThreadIndex(messageIndex);
			if (targetRow) {
				this.renderAppliedProposalBadge(targetRow);
			}
			new Notice(`Applied to ${file.basename}`);
			await this.app.workspace.getLeaf(false)?.openFile(file);
		} catch (error) {
			new Notice(
				error instanceof Error ? error.message : 'Could not apply proposal.',
			);
		}
	}

	private findRowForThreadIndex(messageIndex: number): HTMLElement | null {
		const rows = Array.from(
			this.messagesEl.querySelectorAll<HTMLElement>('.gc-row'),
		);
		return (
			rows.find((row) => row.dataset.gcThreadIndex === String(messageIndex)) ??
			null
		);
	}

	private async readNoteBody(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return '';
		}
		const raw = await this.app.vault.cachedRead(file);
		return stripFrontmatter(raw);
	}

	private async renderEvidence(
		row: HTMLElement,
		evidence: EvidenceRef[] | RetrievedChunk[],
		mode: AnswerMode,
		searchQuery?: string,
		attachedNote?: AttachedNote | null,
	): Promise<void> {
		row.querySelector('.gc-evidence')?.remove();
		const wrap = row.createDiv({ cls: 'gc-evidence' });

		if (attachedNote) {
			wrap.createDiv({
				cls: 'gc-evidence-label',
				text: 'Attached note',
			});
			const attachedList = wrap.createDiv({
				cls: 'gc-evidence-list markdown-rendered',
			});
			await renderBubbleMarkdown(
				this.app,
				attachedList,
				evidenceListLine({
					path: attachedNote.path,
					title: attachedNote.title,
					heading: attachedNote.title,
				}),
				this.sourcePath(),
				this,
			);
		}

		if (mode === 'attached') {
			if (evidence.length > 0) {
				wrap.createDiv({
					cls: 'gc-evidence-label',
					text: searchQuery
						? `Related notes (${evidence.length}) · ${searchQuery}`
						: `Related notes (${evidence.length})`,
				});
				const listEl = wrap.createDiv({
					cls: 'gc-evidence-list markdown-rendered',
				});
				const lines = evidence.map((chunk) => evidenceListLine(chunk));
				await renderBubbleMarkdown(
					this.app,
					listEl,
					lines.join('\n'),
					this.sourcePath(),
					this,
				);
			}
			return;
		}

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
		const lines = evidence.map((chunk) => evidenceListLine(chunk));
		await renderBubbleMarkdown(
			this.app,
			listEl,
			lines.join('\n'),
			this.sourcePath(),
			this,
		);
	}
}
