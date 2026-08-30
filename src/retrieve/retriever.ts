import type { App } from 'obsidian';
import type { LexicalIndex } from '../index/lexical';
import type { RetrievedChunk } from '../index/types';

const NEIGHBOR_CHUNK_CAP = 2;

export function retrieve(
	app: App,
	lexical: LexicalIndex,
	query: string,
	options: { topK: number; activePath: string | null },
): RetrievedChunk[] {
	const lexicalHits = lexical.query(query, Math.max(options.topK * 3, 12));
	const scored = new Map<string, RetrievedChunk>();

	for (const hit of lexicalHits) {
		const boost = hit.path === options.activePath ? 1.35 : 1;
		scored.set(hit.id, {
			id: hit.id,
			path: hit.path,
			title: hit.title,
			heading: hit.heading,
			text: hit.text,
			score: hit.score * boost,
		});
	}

	const seedPaths = new Set(lexicalHits.map((hit) => hit.path));
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
					score: 0.4,
				});
			}
		}
	}

	return [...scored.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, options.topK);
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
