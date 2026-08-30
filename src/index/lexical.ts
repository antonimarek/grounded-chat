import MiniSearch from 'minisearch';
import type { NoteChunk } from './types';

export class LexicalIndex {
	private searcher: MiniSearch<NoteChunk>;
	private byPath = new Map<string, NoteChunk[]>();

	constructor() {
		this.searcher = this.create();
	}

	load(chunks: NoteChunk[]): void {
		this.searcher = this.create();
		this.byPath.clear();
		if (chunks.length > 0) {
			this.searcher.addAll(chunks);
			for (const chunk of chunks) {
				this.addToPath(chunk);
			}
		}
	}

	replacePath(path: string, chunks: NoteChunk[]): void {
		this.removePath(path);
		if (chunks.length > 0) {
			this.searcher.addAll(chunks);
			for (const chunk of chunks) {
				this.addToPath(chunk);
			}
		}
	}

	removePath(path: string): void {
		const existing = this.byPath.get(path) ?? [];
		for (const chunk of existing) {
			if (this.searcher.has(chunk.id)) {
				this.searcher.discard(chunk.id);
			}
		}
		this.byPath.delete(path);
	}

	query(
		query: string,
		limit: number,
		combineWith: 'AND' | 'OR' = 'AND',
	): Array<NoteChunk & { score: number }> {
		if (!query.trim()) {
			return [];
		}
		const hits = this.searcher.search(query, {
			prefix: true,
			fuzzy: 0.25,
			boost: { title: 4, heading: 2.5, text: 1 },
			combineWith,
		});
		return hits.slice(0, limit).map((hit) => {
			const stored = hit as typeof hit & {
				path?: string;
				title?: string;
				heading?: string;
				text?: string;
				hash?: string;
			};
			return {
				id: String(hit.id),
				path: stored.path ?? '',
				title: stored.title ?? '',
				heading: stored.heading ?? '',
				text: stored.text ?? '',
				hash: stored.hash ?? '',
				score: hit.score,
			};
		});
	}

	chunksForPath(path: string): NoteChunk[] {
		return this.byPath.get(path) ?? [];
	}

	get size(): number {
		return this.searcher.documentCount;
	}

	private addToPath(chunk: NoteChunk): void {
		const list = this.byPath.get(chunk.path) ?? [];
		list.push(chunk);
		this.byPath.set(chunk.path, list);
	}

	private create(): MiniSearch<NoteChunk> {
		return new MiniSearch({
			fields: ['title', 'heading', 'text'],
			storeFields: ['path', 'title', 'heading', 'text', 'hash'],
			idField: 'id',
		});
	}
}
