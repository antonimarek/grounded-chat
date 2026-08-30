import type { FileRecord, NoteChunk } from './types';

function asError(reason: unknown): Error {
	return reason instanceof Error ? reason : new Error(String(reason));
}

export class ChunkStore {
	private db: IDBDatabase | null = null;

	constructor(private dbName: string) {}

	async open(): Promise<void> {
		this.db = await new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains('chunks')) {
					const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
					chunks.createIndex('path', 'path', { unique: false });
				}
				if (!db.objectStoreNames.contains('files')) {
					db.createObjectStore('files', { keyPath: 'path' });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(asError(request.error));
		});
	}

	async getAllChunks(): Promise<NoteChunk[]> {
		return this.all<NoteChunk>('chunks');
	}

	async getFile(path: string): Promise<FileRecord | undefined> {
		const db = this.requireDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction('files', 'readonly');
			const req = tx.objectStore('files').get(path);
			req.onsuccess = () => resolve(req.result as FileRecord | undefined);
			req.onerror = () => reject(asError(req.error));
		});
	}

	async getAllFiles(): Promise<FileRecord[]> {
		return this.all<FileRecord>('files');
	}

	async replaceFile(
		path: string,
		file: FileRecord,
		chunks: NoteChunk[],
	): Promise<void> {
		await this.deleteChunksForPath(path);
		const db = this.requireDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(['chunks', 'files'], 'readwrite');
			const chunkStore = tx.objectStore('chunks');
			for (const chunk of chunks) {
				chunkStore.put(chunk);
			}
			tx.objectStore('files').put(file);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(asError(tx.error));
		});
	}

	async deletePath(path: string): Promise<void> {
		await this.deleteChunksForPath(path);
		const db = this.requireDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('files', 'readwrite');
			tx.objectStore('files').delete(path);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(asError(tx.error));
		});
	}

	private deleteChunksForPath(path: string): Promise<void> {
		const db = this.requireDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction('chunks', 'readwrite');
			const index = tx.objectStore('chunks').index('path');
			const req = index.openCursor(IDBKeyRange.only(path));
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					cursor.delete();
					cursor.continue();
				}
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(asError(tx.error));
		});
	}

	private all<T>(store: string): Promise<T[]> {
		const db = this.requireDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(store, 'readonly');
			const req = tx.objectStore(store).getAll();
			req.onsuccess = () => resolve(req.result as T[]);
			req.onerror = () => reject(asError(req.error));
		});
	}

	private requireDb(): IDBDatabase {
		if (!this.db) {
			throw new Error('Index store is not open');
		}
		return this.db;
	}
}
