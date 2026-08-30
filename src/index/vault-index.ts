import { App, Component, TAbstractFile, TFile, debounce } from 'obsidian';
import type { GroundedChatSettings } from '../settings';
import { chunkMarkdown } from './chunker';
import {
	emptyExcludeRules,
	isPathExcluded,
	parseExcludeRules,
	type ExcludeRules,
} from './excludes';
import { hashText } from './hash';
import { LexicalIndex } from './lexical';
import { ChunkStore } from './store';
import type { IndexStatus } from './types';

const PROGRESS_EVERY = 10;

export class VaultIndex extends Component {
	readonly lexical = new LexicalIndex();
	status: IndexStatus = {
		ready: false,
		indexing: false,
		files: 0,
		chunks: 0,
		syncDone: 0,
		syncTotal: 0,
	};

	private store: ChunkStore;
	private listeners = new Set<() => void>();
	private excludeCacheKey = '';
	private excludeRules: ExcludeRules = emptyExcludeRules();
	private syncRunning = false;
	private syncQueued = false;

	constructor(
		private app: App,
		private getSettings: () => GroundedChatSettings,
	) {
		super();
		this.store = new ChunkStore(
			`grounded-chat-${this.app.vault.getName() || 'vault'}`,
		);
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async start(): Promise<void> {
		await this.store.open();
		const cached = await this.store.getAllChunks();
		this.lexical.load(cached);
		this.refreshCounts();
		this.status.ready = cached.length > 0;
		this.notify();

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					this.debouncedFile(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile) {
					this.debouncedFile(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				void this.removeFile(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				void this.renameFile(file, oldPath);
			}),
		);

		void this.syncVault(false).catch((error) => {
			console.error('Grounded Chat: index sync failed', error);
		});
	}

	async rebuild(): Promise<void> {
		await this.syncVault(true);
	}

	private debouncedFile = debounce((file: TFile) => {
		if (this.syncRunning) {
			return;
		}
		void this.upsertFile(file, false, false);
	}, 400);

	private async syncVault(force = false): Promise<void> {
		if (this.syncRunning) {
			this.syncQueued = true;
			return;
		}
		this.syncRunning = true;
		this.status.indexing = true;
		this.status.syncDone = 0;
		this.notify();

		try {
			const files = this.app.vault
				.getMarkdownFiles()
				.filter((file) => this.include(file.path));
			this.status.syncTotal = files.length;
			this.refreshCounts();
			this.notify();

			const known = new Set(
				(await this.store.getAllFiles()).map((record) => record.path),
			);

			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (!file) {
					continue;
				}
				known.delete(file.path);
				await this.upsertFile(file, force, true);
				this.status.syncDone = i + 1;
				if (i > 0 && i % PROGRESS_EVERY === 0) {
					this.refreshCounts();
					this.notify();
					await this.yieldToUi();
				}
			}

			for (const stale of known) {
				this.lexical.removePath(stale);
				await this.store.deletePath(stale);
			}

			this.status.ready = true;
		} catch (error) {
			console.error('Grounded Chat: index sync failed', error);
			throw error;
		} finally {
			this.syncRunning = false;
			this.status.indexing = false;
			this.status.syncDone = this.status.syncTotal;
			this.refreshCounts();
			this.notify();
			if (this.syncQueued) {
				this.syncQueued = false;
				void this.syncVault(force).catch((err) => {
					console.error('Grounded Chat: queued sync failed', err);
				});
			}
		}
	}

	private async upsertFile(
		file: TFile,
		force = false,
		quiet = false,
	): Promise<void> {
		if (file.extension !== 'md' || !this.include(file.path)) {
			return;
		}

		if (!force) {
			const previous = await this.store.getFile(file.path);
			if (previous && previous.mtime === file.stat.mtime) {
				return;
			}
		}

		const markdown = await this.app.vault.cachedRead(file);
		const hash = hashText(`${file.stat.mtime}:${markdown}`);
		if (!force) {
			const previous = await this.store.getFile(file.path);
			if (previous?.hash === hash) {
				return;
			}
		}

		const title = file.basename;
		const chunks = chunkMarkdown(file.path, title, markdown);
		await this.store.replaceFile(
			file.path,
			{ path: file.path, hash, mtime: file.stat.mtime },
			chunks,
		);
		this.lexical.replacePath(file.path, chunks);
		if (!quiet) {
			this.refreshCounts();
			this.notify();
		}
	}

	private async removeFile(file: TAbstractFile): Promise<void> {
		this.lexical.removePath(file.path);
		await this.store.deletePath(file.path);
		this.refreshCounts();
		this.notify();
	}

	private async renameFile(
		file: TAbstractFile,
		oldPath: string,
	): Promise<void> {
		this.lexical.removePath(oldPath);
		await this.store.deletePath(oldPath);
		if (file instanceof TFile) {
			await this.upsertFile(file, true, false);
		}
	}

	private include(path: string): boolean {
		const raw = this.getSettings().excludeFolders;
		if (raw !== this.excludeCacheKey) {
			this.excludeCacheKey = raw;
			this.excludeRules = parseExcludeRules(raw);
		}
		return !isPathExcluded(path, this.excludeRules);
	}

	private refreshCounts(): void {
		this.status.chunks = this.lexical.size;
		this.status.files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.include(file.path)).length;
	}

	private yieldToUi(): Promise<void> {
		return new Promise((resolve) => {
			window.setTimeout(resolve, 0);
		});
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
