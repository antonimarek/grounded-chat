import type { EpistemicStatus } from './epistemic';
import type { AnswerMode } from './planner';
import type { TokenUsage } from '../openrouter/usage';

export interface EvidenceRef {
	path: string;
	title: string;
	heading: string;
}

export interface ThreadMessage {
	role: 'user' | 'assistant';
	content: string;
	status?: EpistemicStatus;
	mode?: AnswerMode;
	searchQuery?: string;
	evidence?: EvidenceRef[];
	skillId?: string;
	usage?: TokenUsage;
}

export interface AssistantTurn {
	userQuestion: string;
	content: string;
	mode: AnswerMode;
	status: EpistemicStatus | null;
	searchQuery?: string;
	evidence: EvidenceRef[];
	skillId?: string;
	usage?: TokenUsage;
}

export function slimEvidence(
	chunks: Array<{ path: string; title: string; heading: string }>,
): EvidenceRef[] {
	return chunks.map((chunk) => ({
		path: chunk.path,
		title: chunk.title,
		heading: chunk.heading,
	}));
}
