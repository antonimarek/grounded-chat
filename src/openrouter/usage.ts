export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export function emptyUsage(): TokenUsage {
	return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function mergeUsage(
	left: TokenUsage | null | undefined,
	right: TokenUsage | null | undefined,
): TokenUsage | null {
	if (!left && !right) {
		return null;
	}
	const base = left ?? emptyUsage();
	const add = right ?? emptyUsage();
	return {
		promptTokens: base.promptTokens + add.promptTokens,
		completionTokens: base.completionTokens + add.completionTokens,
		totalTokens: base.totalTokens + add.totalTokens,
	};
}

export function formatTokenCount(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	if (count >= 1_000) {
		return `${(count / 1_000).toFixed(1)}k`;
	}
	return String(count);
}

export function formatUsageSummary(usage: TokenUsage): string {
	return `↓${formatTokenCount(usage.promptTokens)} ↑${formatTokenCount(usage.completionTokens)}`;
}

export function parseUsage(raw: unknown): TokenUsage | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const usage = raw as {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	const promptTokens = usage.prompt_tokens ?? 0;
	const completionTokens = usage.completion_tokens ?? 0;
	const totalTokens =
		usage.total_tokens ?? promptTokens + completionTokens;
	if (promptTokens + completionTokens + totalTokens === 0) {
		return null;
	}
	return { promptTokens, completionTokens, totalTokens };
}
