export function wikilinkTarget(path: string): string {
	return path.replace(/\.md$/i, '');
}

export function evidenceLinkLabel(chunk: {
	title: string;
	heading: string;
}): string {
	if (chunk.heading === chunk.title) {
		return chunk.title;
	}
	return `${chunk.title} › ${chunk.heading}`;
}

export function evidenceLinkMarkdown(chunk: {
	path: string;
	title: string;
	heading: string;
}): string {
	return `[[${wikilinkTarget(chunk.path)}|${evidenceLinkLabel(chunk)}]]`;
}

export function evidenceListLine(chunk: {
	path: string;
	title: string;
	heading: string;
}): string {
	return `- ${evidenceLinkMarkdown(chunk)}`;
}

export function titleHasOddWhitespace(title: string): boolean {
	return title !== title.trim();
}
