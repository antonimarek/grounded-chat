import type { App } from 'obsidian';
import type { LexicalIndex } from '../index/lexical';
import type { RetrievedChunk } from '../index/types';
import {
	completeChat,
	OpenRouterError,
	type ChatMessage,
} from '../openrouter/client';
import {
	parseSearchQuery,
	ROUTER_SYSTEM,
	SEARCH_VAULT_TOOL,
} from '../openrouter/tools';
import { retrieve } from '../retrieve/retriever';

export type AnswerMode = 'vault' | 'conversation';

export interface PlanResult {
	mode: AnswerMode;
	evidence: RetrievedChunk[];
	searchQuery?: string;
	directAnswer?: string;
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
}

export async function planAnswer(params: PlanParams): Promise<PlanResult> {
	const history = params.history.filter(
		(message) => message.role === 'user' || message.role === 'assistant',
	);

	try {
		const route = await completeChat({
			apiKey: params.apiKey,
			baseUrl: params.baseUrl,
			model: params.model,
			systemPrompt: ROUTER_SYSTEM,
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
				const evidence = retrieve(params.app, params.lexical, query, {
					topK: params.topK,
					activePath: params.activePath,
				});
				return { mode: 'vault', evidence, searchQuery: query };
			}
		}

		if (route.content) {
			return {
				mode: 'conversation',
				evidence: [],
				directAnswer: route.content,
			};
		}

		return { mode: 'conversation', evidence: [] };
	} catch (error) {
		if ((error as OpenRouterError).name === 'OpenRouterError') {
			return fallbackPlan(params);
		}
		throw error;
	}
}

function fallbackPlan(params: PlanParams): PlanResult {
	if (isLikelyFollowUp(params.userMessage, params.history)) {
		return { mode: 'conversation', evidence: [] };
	}

	const evidence = retrieve(
		params.app,
		params.lexical,
		params.userMessage,
		{
			topK: params.topK,
			activePath: params.activePath,
		},
	);
	return { mode: 'vault', evidence, searchQuery: params.userMessage };
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
		/^(tak|nie|ok|okay)$/,
	];

	return patterns.some((pattern) => pattern.test(text));
}
