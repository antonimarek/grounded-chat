export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface StreamChatParams {
	apiKey: string;
	baseUrl: string;
	model: string;
	messages: ChatMessage[];
	signal: AbortSignal;
	onDelta: (text: string) => void;
}

const DEFAULT_SYSTEM =
	'You are a vault assistant. Retrieval is not enabled yet. Say so if the user asks about their notes. Be brief. Do not invent citations.';

export class OpenRouterError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'OpenRouterError';
		this.status = status;
	}
}

export async function streamChat(params: StreamChatParams): Promise<void> {
	const base = params.baseUrl.replace(/\/$/, '');
	const url = `${base}/chat/completions`;
	const messages: ChatMessage[] = [
		{ role: 'system', content: DEFAULT_SYSTEM },
		...params.messages,
	];

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${params.apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://github.com/antonimarek/grounded-chat',
			'X-Title': 'Grounded Chat',
		},
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
