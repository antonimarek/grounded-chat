import type { App, Component, HoverParent } from 'obsidian';

function linkTextFromAnchor(link: HTMLAnchorElement): string {
	return (
		link.getAttribute('data-href') ??
		link.getAttribute('href') ??
		link.textContent ??
		''
	);
}

export function wireInternalLinks(
	app: App,
	component: Component & HoverParent,
	root: HTMLElement,
	getSourcePath: () => string,
): void {
	component.registerDomEvent(root, 'click', (event) => {
		const link = (event.target as HTMLElement).closest('a.internal-link');
		if (!(link instanceof HTMLAnchorElement)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const linktext = linkTextFromAnchor(link);
		if (!linktext) {
			return;
		}
		void app.workspace.openLinkText(linktext, getSourcePath(), false);
	});

	component.registerDomEvent(root, 'mouseover', (event) => {
		const link = (event.target as HTMLElement).closest('a.internal-link');
		if (!(link instanceof HTMLAnchorElement)) {
			return;
		}
		const linktext = linkTextFromAnchor(link);
		if (!linktext) {
			return;
		}
		triggerHoverLink(app, component, event, link, linktext);
	});
}

function triggerHoverLink(
	app: App,
	parent: HoverParent,
	event: MouseEvent,
	targetEl: HTMLAnchorElement,
	linktext: string,
): void {
	const workspace = app.workspace as unknown as {
		trigger?: (name: string, payload: unknown) => void;
	};
	workspace.trigger?.('hover-link', {
		event,
		source: 'preview',
		hoverParent: parent,
		targetEl,
		linktext,
	});
}
