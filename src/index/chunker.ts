import { hashText } from './hash';
import type { NoteChunk } from './types';

const MAX_CHARS = 1800;

export function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith('---')) {
		return markdown;
	}
	const end = markdown.indexOf('\n---', 3);
	if (end === -1) {
		return markdown;
	}
	const after = markdown.slice(end + 4);
	return after.startsWith('\n') ? after.slice(1) : after;
}

export function chunkMarkdown(
	path: string,
	title: string,
	markdown: string,
): NoteChunk[] {
	const body = stripFrontmatter(markdown);
	const sections: { heading: string; lines: string[] }[] = [
		{ heading: title, lines: [] },
	];
	let current = sections[0];
	const stack: string[] = [title];

	for (const line of body.split('\n')) {
		const match = /^(#{1,3})\s+(.+)$/.exec(line);
		if (match?.[1] && match[2]) {
			const level = match[1].length;
			stack.length = level;
			stack[level - 1] = match[2].trim();
			const heading = stack.filter((part) => part.length > 0).join(' › ');
			current = { heading, lines: [] };
			sections.push(current);
			continue;
		}
		if (current) {
			current.lines.push(line);
		}
	}

	const chunks: NoteChunk[] = [];
	for (const section of sections) {
		const text = section.lines.join('\n').trim();
		if (!text) {
			continue;
		}
		const parts = splitBySize(text, MAX_CHARS);
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (!part) {
				continue;
			}
			chunks.push({
				id: `${path}::${section.heading}::${i}`,
				path,
				title,
				heading: section.heading,
				text: part,
				hash: hashText(part),
			});
		}
	}
	return chunks;
}

function splitBySize(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) {
		return [text];
	}
	const paras = text.split(/\n{2,}/);
	const parts: string[] = [];
	let buf = '';
	for (const para of paras) {
		if (buf && buf.length + para.length + 2 > maxChars) {
			parts.push(buf.trim());
			buf = para;
		} else {
			buf = buf ? `${buf}\n\n${para}` : para;
		}
	}
	if (buf.trim()) {
		parts.push(buf.trim());
	}
	return parts.length > 0 ? parts : [text.slice(0, maxChars)];
}
