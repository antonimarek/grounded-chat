import type { App } from 'obsidian';
import type { AttachedNote } from './attached-note';
import {
	relatedSearchQuery,
	wantsRelatedNoteSearch,
} from './attached-note';
import type { LexicalIndex } from '../index/lexical';
import type { RetrievedChunk } from '../index/types';
import {
	completeChat,
	OpenRouterError,
	type ChatMessage,
} from '../openrouter/client';
import type { TokenUsage } from '../openrouter/usage';
import {
	parseSearchQuery,
	ROUTER_SYSTEM,
	SEARCH_VAULT_TOOL,
} from '../openrouter/tools';
import { retrieve } from '../retrieve/retriever';

export type AnswerMode = 'vault' | 'conversation' | 'attached';

export interface PlanResult {
	mode: AnswerMode;
	evidence: RetrievedChunk[];
	searchQuery?: string;
	directAnswer?: string;
	usage: TokenUsage | null;
}

export interface PlanParams {
	app: App;
	lexical: LexicalIndex;
	apiKey: string;
	baseUrl: string;
	model: string;
	userMessage: string;
	history: ChatMessage[];
	topK: number;
	activePath: string | null;
	signal: AbortSignal;
	skillHint?: string;
	attachedNote?: AttachedNote | null;
	onStatus?: (message: string) => void;
}

export async function planAnswer(params: PlanParams): Promise<PlanResult> {
	if (params.attachedNote) {
		return planWithAttachedNote(params);
	}

	const history = params.history.filter(
		(message) => message.role === 'user' || message.role === 'assistant',
	);
	const context = conversationContext(history);
	const routerSystem = params.skillHint
		? `${ROUTER_SYSTEM} ${params.skillHint}`
		: ROUTER_SYSTEM;

	params.onStatus?.('Routing…');

	try {
		const route = await completeChat({
			apiKey: params.apiKey,
			baseUrl: params.baseUrl,
			model: params.model,
			systemPrompt: routerSystem,
			messages: history,
			signal: params.signal,
			tools: [SEARCH_VAULT_TOOL],
			toolChoice: 'auto',
		});

		const searchCall = route.toolCalls.find(
			(call) => call.name === 'search_vault',
		);
		if (searchCall) {
			const query = parseSearchQuery(searchCall.arguments);
			if (query) {
				params.onStatus?.('Searching vault…');
				const evidence = retrieve(params.app, params.lexical, query, {
					topK: params.topK,
					activePath: params.activePath,
					context,
				});
				return {
					mode: 'vault',
					evidence,
					searchQuery: query,
					usage: route.usage,
				};
			}
		}

		if (route.content) {
			return {
				mode: 'conversation',
				evidence: [],
				directAnswer: route.content,
				usage: route.usage,
			};
		}

		return { mode: 'conversation', evidence: [], usage: route.usage };
	} catch (error) {
		if ((error as OpenRouterError).name === 'OpenRouterError') {
			return fallbackPlan(params, context);
		}
		throw error;
	}
}

async function planWithAttachedNote(params: PlanParams): Promise<PlanResult> {
	const note = params.attachedNote;
	if (!note) {
		return { mode: 'attached', evidence: [], usage: null };
	}

	if (wantsRelatedNoteSearch(params.userMessage)) {
		const query = relatedSearchQuery(note);
		params.onStatus?.('Searching related notes…');
		const evidence = retrieve(params.app, params.lexical, query, {
			topK: params.topK,
			activePath: note.path,
		});
		return {
			mode: 'attached',
			evidence,
			searchQuery: query,
			usage: null,
		};
	}

	params.onStatus?.('Using attached note…');
	return { mode: 'attached', evidence: [], usage: null };
}

function fallbackPlan(params: PlanParams, context: string): PlanResult {
	if (isLikelyFollowUp(params.userMessage, params.history)) {
		return { mode: 'conversation', evidence: [], usage: null };
	}

	params.onStatus?.('Searching vault…');
	const evidence = retrieve(
		params.app,
		params.lexical,
		params.userMessage,
		{
			topK: params.topK,
			activePath: params.activePath,
			context,
		},
	);
	return {
		mode: 'vault',
		evidence,
		searchQuery: params.userMessage,
		usage: null,
	};
}

function conversationContext(history: ChatMessage[]): string {
	return history
		.filter((message) => message.role === 'user')
		.slice(-3)
		.map((message) => message.content)
		.join(' ');
}

function isLikelyFollowUp(
	userMessage: string,
	history: ChatMessage[],
): boolean {
	const prior = history.filter(
		(message) => message.role === 'user' || message.role === 'assistant',
	);
	if (prior.length <= 1) {
		return false;
	}

	const text = userMessage.toLowerCase().trim();
	const patterns = [
		/^o co pyta/,
		/^co pyta/,
		/^what did i ask/,
		/^repeat/,
		/^summarize/,
		/^thanks/,
		/^thank you/,
		/^dzieki/,
		/^dzięki/,
		/^wyjasnij/,
		/^wyjaśnij/,
		/^a co z tym/,
		/^explain that/,
		/^what was that/,
		/^(tak|nie|ok|okay|yes|no)$/,
	];

	return patterns.some((pattern) => pattern.test(text));
}
