import type { AnswerMode } from './planner';

export type EpistemicStatus = 'grounded' | 'partial' | 'uncertain';

export function computeEpistemicStatus(params: {
	mode: AnswerMode;
	evidenceCount: number;
	answerText: string;
}): EpistemicStatus | null {
	if (params.mode === 'conversation') {
		return null;
	}
	if (params.evidenceCount === 0) {
		return 'uncertain';
	}
	if (/\bUNCERTAIN\b/i.test(params.answerText)) {
		return 'partial';
	}
	return 'grounded';
}

export function statusLabel(status: EpistemicStatus): string {
	switch (status) {
		case 'grounded':
			return 'GROUNDED';
		case 'partial':
			return 'PARTIAL';
		case 'uncertain':
			return 'UNCERTAIN';
	}
}
