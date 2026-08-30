import { App, Component, TAbstractFile, TFile, debounce } from 'obsidian';
import type { GroundedChatSettings } from '../settings';
import { chunkMarkdown } from './chunker';
import { hashText } from './hash';
import { LexicalIndex } from './lexical';
import { ChunkStore } from './store';
import type { IndexStatus } from './types';

export class VaultIndex extends Component {
	readonly lexical = new LexicalIndex();
	status: IndexStatus = {
		ready: false,
		indexing: false,
		files: 0,
		chunks: 0,
	};

	private store: ChunkStore;
	private listeners = new Set<() => void>();

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

		await this.syncVault();
	}

	async rebuild(): Promise<void> {
		await this.syncVault(true);
	}

	private debouncedFile = debounce((file: TFile) => {
		void this.upsertFile(file);
	}, 400);

	private async syncVault(force = false): Promise<void> {
		this.status.indexing = true;
		this.notify();
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.include(file.path));
		const known = new Set(
			(await this.store.getAllFiles()).map((record) => record.path),
		);

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file) {
				continue;
			}
			known.delete(file.path);
			await this.upsertFile(file, force);
			if (i > 0 && i % 25 === 0) {
				await new Promise((resolve) => {
					window.setTimeout(resolve, 0);
				});
			}
		}
		for (const stale of known) {
			this.lexical.removePath(stale);
			await this.store.deletePath(stale);
		}
		this.status.indexing = false;
		this.status.ready = true;
		this.refreshCounts();
		this.notify();
	}

	private async upsertFile(file: TFile, force = false): Promise<void> {
		if (file.extension !== 'md' || !this.include(file.path)) {
			return;
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
		this.refreshCounts();
		this.notify();
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
			await this.upsertFile(file, true);
		}
	}

	private include(path: string): boolean {
		const raw = this.getSettings().excludeFolders;
		const prefixes = raw
			.split('\n')
			.map((line) => line.trim().replace(/\/$/, ''))
			.filter((line) => line.length > 0);
		return !prefixes.some(
			(prefix) => path === prefix || path.startsWith(`${prefix}/`),
		);
	}

	private refreshCounts(): void {
		this.status.chunks = this.lexical.size;
		this.status.files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.include(file.path)).length;
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
