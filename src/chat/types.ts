import type { EpistemicStatus } from './epistemic';
import type { AnswerMode } from './planner';
import type { TokenUsage } from '../openrouter/usage';

export interface NoteProposal {
	type: 'replace_body';
	path: string;
	content: string;
	baseBodyHash: string;
	applied?: boolean;
}

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
	proposal?: NoteProposal;
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
	proposal?: NoteProposal;
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
