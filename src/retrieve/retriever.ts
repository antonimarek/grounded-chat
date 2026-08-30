import type { App } from 'obsidian';
import type { LexicalIndex } from '../index/lexical';
import type { RetrievedChunk } from '../index/types';
import { normalizeTerm } from '../index/normalize';
import { allSearchTerms, buildSearchQueries } from './query';

const NEIGHBOR_CHUNK_CAP = 2;
const MAX_CHUNKS_PER_NOTE = 2;

export interface RetrieveOptions {
	topK: number;
	activePath: string | null;
	context?: string;
}

export function retrieve(
	app: App,
	lexical: LexicalIndex,
	query: string,
	options: RetrieveOptions,
): RetrievedChunk[] {
	const scored = new Map<string, RetrievedChunk>();
	const queries = buildSearchQueries(query, options.context);
	const terms = allSearchTerms(query, options.context);
	const poolSize = Math.max(options.topK * 5, 24);

	for (let i = 0; i < queries.length; i++) {
		const q = queries[i];
		if (!q) {
			continue;
		}
		const isPrimary = i === 0;
		const wordCount = q.split(/\s+/).filter(Boolean).length;
		const combineWith = wordCount > 1 ? 'OR' : 'AND';
		const hits = lexical.query(q, poolSize, combineWith);

		for (const hit of hits) {
			const activeBoost = hit.path === options.activePath ? 1.4 : 1;
			const queryBoost = isPrimary ? 1 : 0.7;
			const titleBoost = terms.some((term) =>
				titleMatchesTerm(hit.title, term),
			)
				? 1.5
				: 1;
			const nextScore = hit.score * activeBoost * queryBoost * titleBoost;
			const existing = scored.get(hit.id);
			if (existing) {
				existing.score = Math.max(existing.score, nextScore) + 0.15;
			} else {
				scored.set(hit.id, {
					id: hit.id,
					path: hit.path,
					title: hit.title,
					heading: hit.heading,
					text: hit.text,
					score: nextScore,
				});
			}
		}
	}

	boostTitleMatches(app, lexical, terms, scored);

	const seedPaths = new Set(
		[...scored.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, 10)
			.map((hit) => hit.path),
	);
	if (options.activePath) {
		seedPaths.add(options.activePath);
	}

	for (const path of seedPaths) {
		for (const neighbor of oneHop(app, path)) {
			const extra = lexical.chunksForPath(neighbor).slice(0, NEIGHBOR_CHUNK_CAP);
			for (const chunk of extra) {
				if (scored.has(chunk.id)) {
					const current = scored.get(chunk.id);
					if (current) {
						current.score += 0.2;
					}
					continue;
				}
				scored.set(chunk.id, {
					id: chunk.id,
					path: chunk.path,
					title: chunk.title,
					heading: chunk.heading,
					text: chunk.text,
					score: 0.4,
				});
			}
		}
	}

	return diversifyByPath(
		[...scored.values()].sort((a, b) => b.score - a.score),
		options.topK,
		MAX_CHUNKS_PER_NOTE,
	);
}

function titleMatchesTerm(title: string, term: string): boolean {
	const normalizedTitle = normalizeTerm(title);
	if (!normalizedTitle || !term) {
		return false;
	}
	return (
		normalizedTitle.includes(term) ||
		(term.length >= 4 && term.includes(normalizedTitle))
	);
}

function boostTitleMatches(
	app: App,
	lexical: LexicalIndex,
	terms: string[],
	scored: Map<string, RetrievedChunk>,
): void {
	if (terms.length === 0) {
		return;
	}

	for (const file of app.vault.getMarkdownFiles()) {
		const matched = terms.filter((term) =>
			titleMatchesTerm(file.basename, term),
		);
		if (matched.length === 0) {
			continue;
		}

		const chunks = lexical.chunksForPath(file.path);
		const titleBoost = 4 + matched.length * 0.75;
		for (const chunk of chunks.slice(0, MAX_CHUNKS_PER_NOTE)) {
			const existing = scored.get(chunk.id);
			if (existing) {
				existing.score += titleBoost;
				continue;
			}
			scored.set(chunk.id, {
				id: chunk.id,
				path: chunk.path,
				title: chunk.title,
				heading: chunk.heading,
				text: chunk.text,
				score: titleBoost,
			});
		}
	}
}

function diversifyByPath(
	sorted: RetrievedChunk[],
	topK: number,
	maxPerPath: number,
): RetrievedChunk[] {
	const perPath = new Map<string, number>();
	const out: RetrievedChunk[] = [];

	for (const chunk of sorted) {
		const count = perPath.get(chunk.path) ?? 0;
		if (count >= maxPerPath) {
			continue;
		}
		perPath.set(chunk.path, count + 1);
		out.push(chunk);
		if (out.length >= topK) {
			break;
		}
	}

	return out;
}

function oneHop(app: App, path: string): string[] {
	const out = new Set<string>();
	const forwards = app.metadataCache.resolvedLinks[path];
	if (forwards) {
		for (const dest of Object.keys(forwards)) {
			out.add(dest);
		}
	}
	for (const [src, dests] of Object.entries(app.metadataCache.resolvedLinks)) {
		if (dests[path]) {
			out.add(src);
		}
	}
	out.delete(path);
	return [...out];
}
