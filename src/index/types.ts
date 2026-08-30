export interface NoteChunk {
	id: string;
	path: string;
	title: string;
	heading: string;
	text: string;
	hash: string;
}

export interface FileRecord {
	path: string;
	hash: string;
	mtime: number;
}

export interface RetrievedChunk {
	id: string;
	path: string;
	title: string;
	heading: string;
	text: string;
	score: number;
}

export interface IndexStatus {
	ready: boolean;
	indexing: boolean;
	files: number;
	chunks: number;
}
