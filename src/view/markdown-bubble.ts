import { App, Component, MarkdownRenderer } from 'obsidian';

export async function renderBubbleMarkdown(
	app: App,
	el: HTMLElement,
	markdown: string,
	sourcePath: string,
	component: Component,
): Promise<void> {
	el.empty();
	el.addClass('markdown-rendered');
	if (!markdown.trim()) {
		return;
	}
	await MarkdownRenderer.render(app, markdown, el, sourcePath, component);
}

export function setBubblePlainText(el: HTMLElement, text: string): void {
	el.empty();
	el.removeClass('markdown-rendered');
	el.setText(text);
}
