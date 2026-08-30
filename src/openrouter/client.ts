export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
}

export interface StreamChatParams {
	apiKey: string;
	baseUrl: string;
	model: string;
	systemPrompt: string;
	messages: ChatMessage[];
	signal: AbortSignal;
	onDelta: (text: string) => void;
}

export interface CompleteChatParams {
	apiKey: string;
	baseUrl: string;
	model: string;
	systemPrompt: string;
	messages: ChatMessage[];
	signal: AbortSignal;
	tools?: unknown[];
	toolChoice?: 'auto' | 'none';
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface CompleteChatResult {
	content: string;
	toolCalls: ToolCall[];
}

export class OpenRouterError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'OpenRouterError';
		this.status = status;
	}
}

export async function completeChat(
	params: CompleteChatParams,
): Promise<CompleteChatResult> {
	const base = params.baseUrl.replace(/\/$/, '');
	const url = `${base}/chat/completions`;
	const messages = [
		{ role: 'system', content: params.systemPrompt },
		...params.messages.filter((message) => message.role !== 'system'),
	];

	const body: Record<string, unknown> = {
		model: params.model,
		messages,
		stream: false,
		temperature: 0.1,
	};
	if (params.tools && params.tools.length > 0) {
		body.tools = params.tools;
		body.tool_choice = params.toolChoice ?? 'auto';
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(params.apiKey),
		body: JSON.stringify(body),
		signal: params.signal,
	});

	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new OpenRouterError(detail, response.status);
	}

	const json = (await response.json()) as {
		choices?: Array<{
			message?: {
				content?: string | null;
				tool_calls?: Array<{
					id: string;
					function?: { name?: string; arguments?: string };
				}>;
			};
		}>;
	};

	const message = json.choices?.[0]?.message;
	const toolCalls: ToolCall[] = [];
	for (const call of message?.tool_calls ?? []) {
		if (!call.function?.name) {
			continue;
		}
		toolCalls.push({
			id: call.id,
			name: call.function.name,
			arguments: call.function.arguments ?? '{}',
		});
	}

	return {
		content: message?.content?.trim() ?? '',
		toolCalls,
	};
}

export async function streamChat(params: StreamChatParams): Promise<void> {
	const base = params.baseUrl.replace(/\/$/, '');
	const url = `${base}/chat/completions`;
	const messages: ChatMessage[] = [
		{ role: 'system', content: params.systemPrompt },
		...params.messages.filter((message) => message.role !== 'system'),
	];

	const response = await fetch(url, {
		method: 'POST',
		headers: buildHeaders(params.apiKey),
		body: JSON.stringify({
			model: params.model,
			messages,
			stream: true,
			temperature: 0.2,
		}),
		signal: params.signal,
	});

	if (!response.ok) {
		const detail = await readErrorBody(response);
		throw new OpenRouterError(detail, response.status);
	}

	if (!response.body) {
		throw new OpenRouterError('Empty response body', response.status);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			const delta = parseSseLine(line);
			if (delta) {
				params.onDelta(delta);
			}
		}
	}
}

function buildHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'HTTP-Referer': 'https://github.com/antonimarek/grounded-chat',
		'X-Title': 'Grounded Chat',
	};
}

function parseSseLine(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('data:')) {
		return null;
	}
	const data = trimmed.slice(5).trim();
	if (data === '[DONE]') {
		return null;
	}
	try {
		const json = JSON.parse(data) as {
			choices?: Array<{ delta?: { content?: string } }>;
		};
		return json.choices?.[0]?.delta?.content ?? null;
	} catch {
		return null;
	}
}

async function readErrorBody(response: Response): Promise<string> {
	const text = await response.text();
	try {
		const json = JSON.parse(text) as {
			error?: { message?: string };
			message?: string;
		};
		return json.error?.message ?? json.message ?? text.slice(0, 400);
	} catch {
		return text.slice(0, 400) || `HTTP ${response.status}`;
	}
}
