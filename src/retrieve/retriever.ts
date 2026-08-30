import type { App } from 'obsidian';
import type { LexicalIndex } from '../index/lexical';
import type { RetrievedChunk } from '../index/types';
import { buildSearchQueries } from './query';

const NEIGHBOR_CHUNK_CAP = 2;
const MAX_CHUNKS_PER_NOTE = 2;

export function retrieve(
	app: App,
	lexical: LexicalIndex,
	query: string,
	options: { topK: number; activePath: string | null },
): RetrievedChunk[] {
	const scored = new Map<string, RetrievedChunk>();
	const queries = buildSearchQueries(query);
	const poolSize = Math.max(options.topK * 5, 20);

	for (let i = 0; i < queries.length; i++) {
		const q = queries[i];
		if (!q) {
			continue;
		}
		const isPrimary = i === 0;
		const combineWith = isPrimary && q.split(/\s+/).length > 1 ? 'OR' : 'AND';
		const hits = lexical.query(q, poolSize, combineWith);

		for (const hit of hits) {
			const activeBoost = hit.path === options.activePath ? 1.35 : 1;
			const queryBoost = isPrimary ? 1 : 0.75;
			const nextScore = hit.score * activeBoost * queryBoost;
			const existing = scored.get(hit.id);
			if (existing) {
				existing.score = Math.max(existing.score, nextScore) + 0.12;
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

	const seedPaths = new Set(
		[...scored.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, 8)
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
						current.score += 0.15;
					}
					continue;
				}
				scored.set(chunk.id, {
					id: chunk.id,
					path: chunk.path,
					title: chunk.title,
					heading: chunk.heading,
					text: chunk.text,
					score: 0.35,
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
