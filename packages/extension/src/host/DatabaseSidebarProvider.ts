/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#tree-provider
 * @task: TASK-018
 * @validated: null
 * ---
 *
 * Sidebar WebviewViewProvider mirroring Sogo's database sidebar UI/UX.
 */

import * as vscode from 'vscode';
import { COMMANDS, EDITOR_VIEW_TYPE, TREE_VIEW_ID } from './constants.js';
import type { DatabaseEntry, DatabaseManager } from './DatabaseManager.js';

interface SidebarDatabaseItem {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly recordsCount: number;
	readonly viewsCount: number;
}

type SidebarDatabaseAction =
	| 'duplicate'
	| 'export-csv'
	| 'import-csv'
	| 'open-as-json'
	| 'delete';

type SidebarInboundMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'create-database'; name: string }
	| { type: 'rename-database'; path: string; name: string }
	| { type: 'open-file' }
	| { type: 'open-database'; path: string }
	| {
		type: 'database-action';
		action: SidebarDatabaseAction;
		path: string;
	};

interface SidebarSnapshotMessage {
	readonly type: 'snapshot';
	readonly selectedPath: string | null;
	readonly databases: SidebarDatabaseItem[];
}

export class DatabaseSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private selectedPath: string | null = null;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly manager: DatabaseManager,
	) {
		this.disposables.push(
			this.manager.onDidChange(() => {
				this.postSnapshot();
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				const filePath = editor?.document.uri.fsPath;
				if (!filePath || !filePath.endsWith('.db.json')) {
					return;
				}
				const entry = this.manager.getByPath(filePath);
				if (!entry || this.selectedPath === entry.path) {
					return;
				}
				this.selectedPath = entry.path;
				this.postSnapshot();
			}),
		);
	}

	static register(
		context: vscode.ExtensionContext,
		manager: DatabaseManager,
	): vscode.Disposable {
		const provider = new DatabaseSidebarProvider(context, manager);
		const registration = vscode.window.registerWebviewViewProvider(TREE_VIEW_ID, provider, {
			webviewOptions: {
				retainContextWhenHidden: true,
			},
		});
		return vscode.Disposable.from(provider, registration);
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		};
		webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

		this.disposables.push(
			webviewView.webview.onDidReceiveMessage((msg: SidebarInboundMessage) => {
				void this.handleWebviewMessage(msg);
			}),
		);

		this.disposables.push(
			webviewView.onDidDispose(() => {
				if (this.view === webviewView) {
					this.view = undefined;
				}
			}),
		);
	}

	private async handleWebviewMessage(msg: SidebarInboundMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				this.postSnapshot();
				return;
			case 'refresh':
				await this.manager.scanAll();
				return;
			case 'create-database':
				await this.handleCreateDatabase(msg.name);
				return;
			case 'rename-database':
				await this.manager.renameDatabase(msg.path, msg.name);
				return;
			case 'open-file':
				await this.handleOpenFile();
				return;
			case 'open-database':
				await this.openDatabase(msg.path);
				return;
			case 'database-action':
				await this.handleDatabaseAction(msg.action, msg.path);
				return;
		}
	}

	private async handleCreateDatabase(name: string): Promise<void> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showWarningMessage('Open a workspace folder to create a database.');
			return;
		}

		const trimmed = name.trim();
		if (!trimmed) {
			return;
		}

		const entry = await this.manager.createNewDatabase(trimmed, workspaceRoot);
		await this.openDatabase(entry.path);
	}

	private async handleOpenFile(): Promise<void> {
		const picks = await vscode.window.showOpenDialog({
			canSelectMany: false,
			openLabel: 'Open Database',
			filters: { Databases: ['json'] },
		});
		if (!picks || picks.length === 0) {
			return;
		}

		const filePath = picks[0].fsPath;
		if (!filePath.endsWith('.db.json')) {
			return;
		}

		const loaded = await this.manager.reloadFile(filePath);
		if (!loaded) {
			return;
		}
		await this.openDatabase(filePath);
	}

	private async openDatabase(path: string): Promise<void> {
		this.selectedPath = path;
		this.postSnapshot();
		await vscode.commands.executeCommand(
			'vscode.openWith',
			vscode.Uri.file(path),
			EDITOR_VIEW_TYPE,
		);
	}

	private async handleDatabaseAction(
		action: SidebarDatabaseAction,
		path: string,
	): Promise<void> {
		switch (action) {
			case 'duplicate':
				await this.manager.duplicateDatabase(path);
				return;
			case 'export-csv':
				await vscode.commands.executeCommand(COMMANDS.exportCsv, { entry: { path } });
				return;
			case 'import-csv':
				await vscode.commands.executeCommand(COMMANDS.importCsv, { entry: { path } });
				return;
			case 'open-as-json':
				await vscode.commands.executeCommand(COMMANDS.openAsJson, { entry: { path } });
				return;
			case 'delete':
				await this.manager.deleteDatabase(path);
				if (this.selectedPath === path) {
					this.selectedPath = null;
				}
				return;
		}
	}

	private postSnapshot(): void {
		if (!this.view) {
			return;
		}

		const sorted = [...this.manager.getAll()].sort((a, b) => a.db.name.localeCompare(b.db.name));
		if (this.selectedPath && !sorted.some((entry) => entry.path === this.selectedPath)) {
			this.selectedPath = null;
		}

		const msg: SidebarSnapshotMessage = {
			type: 'snapshot',
			selectedPath: this.selectedPath,
			databases: sorted.map((entry) => this.toSidebarItem(entry)),
		};
		void this.view.webview.postMessage(msg);
	}

	private toSidebarItem(entry: DatabaseEntry): SidebarDatabaseItem {
		return {
			id: entry.db.id,
			name: entry.db.name,
			path: entry.path,
			recordsCount: entry.db.records.length,
			viewsCount: entry.db.views.length,
		};
	}

	private getWebviewHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const csp = webview.cspSource;

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width,initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		:root {
			color-scheme: var(--vscode-color-scheme, normal);
			--db-sidebar-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
			--db-sidebar-fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
			--db-section-fg: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
			--db-border: var(--vscode-widget-border, var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.35)));
			--db-hover-bg: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.12));
			--db-active-bg: var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, rgba(128, 128, 128, 0.18)));
			--db-active-fg: var(--vscode-list-activeSelectionForeground, var(--vscode-list-inactiveSelectionForeground, var(--vscode-foreground)));
			--db-muted-fg: var(--vscode-descriptionForeground, var(--vscode-foreground));
			--db-input-bg: var(--vscode-input-background, transparent);
			--db-input-fg: var(--vscode-input-foreground, var(--vscode-foreground));
			--db-input-border: var(--vscode-input-border, var(--db-border));
			--db-btn-bg: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background, transparent));
			--db-btn-fg: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
			--db-btn-hover-bg: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.16)));
			--db-btn-primary-bg: var(--vscode-button-background, var(--vscode-focusBorder));
			--db-btn-primary-fg: var(--vscode-button-foreground, #fff);
			--db-btn-primary-hover-bg: var(--vscode-button-hoverBackground, var(--vscode-focusBorder));
			--db-menu-bg: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--db-sidebar-bg)));
			--db-menu-fg: var(--vscode-menu-foreground, var(--vscode-foreground));
			--db-menu-border: var(--vscode-menu-border, var(--db-border));
			--db-badge-bg: var(--vscode-badge-background, rgba(128, 128, 128, 0.3));
			--db-badge-fg: var(--vscode-badge-foreground, var(--vscode-foreground));
			--db-focus: var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, #007fd4));
			--db-scrollbar: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
			--db-scrollbar-hover: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
			--db-danger: var(--vscode-errorForeground, #f14c4c);
			--db-shadow: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.3));
		}
		html, body {
			height: 100%;
		}
		* {
			box-sizing: border-box;
		}
		body {
			margin: 0;
			font-family: var(--vscode-font-family, var(--vscode-editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif));
			font-size: var(--vscode-font-size, 13px);
			line-height: 1.4;
			color: var(--db-sidebar-fg);
			background: var(--db-sidebar-bg);
		}
		button,
		input {
			font: inherit;
		}
		::-webkit-scrollbar {
			width: 8px;
			height: 8px;
		}
		::-webkit-scrollbar-track {
			background: transparent;
		}
		::-webkit-scrollbar-thumb {
			background: var(--db-scrollbar);
			border-radius: 999px;
		}
		::-webkit-scrollbar-thumb:hover {
			background: var(--db-scrollbar-hover);
		}
		*:focus-visible {
			outline: 1px solid var(--db-focus);
			outline-offset: -1px;
		}
		.db-left {
			display: flex;
			flex-direction: column;
			height: 100%;
			background: var(--db-sidebar-bg);
			color: var(--db-sidebar-fg);
		}
		.db-left-header {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 10px;
			border-bottom: 1px solid var(--db-border);
		}
		.db-left-title {
			flex: 1;
			font-weight: 600;
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--db-section-fg);
		}
		.db-left-actions { display: flex; gap: 2px; }
		.db-icon-btn {
			width: 22px;
			height: 22px;
			border: none;
			background: transparent;
			color: var(--db-muted-fg);
			cursor: pointer;
			border-radius: 3px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 13px;
			line-height: 1;
			padding: 0;
		}
		.db-icon-btn:hover {
			background: var(--db-hover-bg);
			color: var(--db-sidebar-fg);
		}
		.db-icon {
			width: 14px;
			height: 14px;
			display: block;
			pointer-events: none;
		}
		.db-icon path,
		.db-icon polyline,
		.db-icon line,
		.db-icon rect {
			stroke: currentColor;
			fill: none;
			stroke-width: 1.8;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.db-list { flex: 1; overflow-y: auto; padding: 4px 0; }
		.db-list-empty {
			padding: 12px 10px;
			font-size: 12px;
			color: var(--db-muted-fg);
		}
		.db-list-item {
			position: relative;
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 5px 10px;
			cursor: pointer;
			border-radius: 0;
			transition: background-color 60ms ease, color 60ms ease;
		}
		.db-list-item:hover { background: var(--db-hover-bg); }
		.db-list-item--active {
			background: var(--db-active-bg);
			color: var(--db-active-fg);
		}
		.db-list-icon {
			font-size: 11px;
			color: var(--db-muted-fg);
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 14px;
			height: 14px;
		}
		.db-list-item--active .db-list-icon {
			color: var(--db-active-fg);
		}
		.db-list-name {
			flex: 1;
			min-width: 0;
			font-size: 13px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.db-list-count {
			font-size: 10px;
			padding: 1px 5px;
			border-radius: 8px;
			background: var(--db-badge-bg);
			color: var(--db-badge-fg);
		}
		.db-list-menu-btn {
			border: none;
			background: transparent;
			color: var(--db-muted-fg);
			padding: 0 4px;
			border-radius: 3px;
			cursor: pointer;
			font-size: 14px;
			opacity: 0;
			line-height: 1;
		}
		.db-list-item:hover .db-list-menu-btn,
		.db-list-menu-btn[data-open="true"] {
			opacity: 1;
		}
		.db-list-item--active .db-list-menu-btn {
			color: var(--db-active-fg);
		}
		.db-list-menu-btn:hover {
			background: var(--db-hover-bg);
			color: var(--db-sidebar-fg);
		}
		.db-list-rename-input {
			width: 100%;
		}
		.db-input {
			background: var(--db-input-bg);
			color: var(--db-input-fg);
			border: 1px solid var(--db-input-border);
			border-radius: 2px;
			padding: 3px 6px;
			font-size: 12px;
			font-family: inherit;
			outline: none;
			box-sizing: border-box;
		}
		.db-input:focus {
			border-color: var(--db-focus);
			outline: 1px solid var(--db-focus);
		}
		.db-new-form {
			padding: 10px;
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.db-new-form-btns {
			display: flex;
			gap: 6px;
		}
		.db-btn {
			padding: 3px 10px;
			border: 1px solid var(--vscode-button-border, var(--db-border));
			border-radius: 2px;
			background: var(--db-btn-bg);
			color: var(--db-btn-fg);
			cursor: pointer;
			font-size: 12px;
			font-family: inherit;
		}
		.db-btn:hover {
			background: var(--db-btn-hover-bg);
		}
		.db-btn-primary {
			background: var(--db-btn-primary-bg);
			color: var(--db-btn-primary-fg);
			border-color: transparent;
		}
		.db-btn-primary:hover {
			background: var(--db-btn-primary-hover-bg);
		}
		.db-context-menu {
			position: absolute;
			right: 8px;
			top: calc(100% + 1px);
			min-width: 170px;
			padding: 4px;
			z-index: 100;
			border-radius: 6px;
			border: 1px solid var(--db-menu-border);
			background: var(--db-menu-bg);
			box-shadow: 0 8px 24px var(--db-shadow);
		}
		.db-context-menu-item {
			display: block;
			width: 100%;
			text-align: left;
			border: none;
			border-radius: 4px;
			background: transparent;
			color: var(--db-menu-fg);
			padding: 6px 8px;
			cursor: pointer;
			font-size: 12px;
			font-family: inherit;
		}
		.db-context-menu-item:hover { background: var(--db-hover-bg); }
		.db-context-menu-item--danger { color: var(--db-danger); }
		body.vscode-high-contrast .db-list-item,
		body.vscode-high-contrast-light .db-list-item,
		body.vscode-high-contrast .db-context-menu,
		body.vscode-high-contrast-light .db-context-menu,
		body.vscode-high-contrast .db-input,
		body.vscode-high-contrast-light .db-input {
			outline-width: 1px;
			outline-style: solid;
			outline-color: transparent;
		}
	</style>
</head>
<body>
	<div class="db-left">
			<div class="db-left-header">
			<span class="db-left-title">Databases</span>
			<div class="db-left-actions">
				<button class="db-icon-btn" id="create-btn" type="button" aria-label="New database" title="New database">
					<svg class="db-icon" viewBox="0 0 16 16" aria-hidden="true">
						<line x1="8" y1="3" x2="8" y2="13"></line>
						<line x1="3" y1="8" x2="13" y2="8"></line>
					</svg>
				</button>
				<button class="db-icon-btn" id="open-btn" type="button" aria-label="Open database file" title="Open database file">
					<svg class="db-icon" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M4 2.5h5l3 3v8H4z"></path>
						<polyline points="9 2.5 9 5.5 12 5.5"></polyline>
					</svg>
				</button>
				<button class="db-icon-btn" id="refresh-btn" type="button" aria-label="Refresh databases" title="Refresh databases">
					<svg class="db-icon" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M13 5V2.8H10.8"></path>
						<path d="M13 8a5 5 0 1 1-1.5-3.6L13 5"></path>
					</svg>
				</button>
			</div>
		</div>
		<div class="db-list" id="db-list"></div>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const listEl = document.getElementById('db-list');
		const state = {
			selectedPath: null,
			menuPath: null,
			renamingPath: null,
			renameDraft: '',
			creating: false,
			createDraft: '',
			databases: [],
		};

		const MENU_ACTIONS = [
			{ id: 'open-in-editor', label: 'Open in Editor' },
			{ id: 'duplicate', label: 'Duplicate' },
			{ id: 'export-csv', label: 'Export CSV' },
			{ id: 'import-csv', label: 'Import CSV' },
			{ id: 'open-as-json', label: 'Open as JSON' },
			{ id: 'delete', label: 'Delete', danger: true },
		];

		document.getElementById('create-btn').addEventListener('click', () => {
			state.menuPath = null;
			state.renamingPath = null;
			state.creating = true;
			state.createDraft = '';
			render();
			focusCreateInput();
		});
		document.getElementById('open-btn').addEventListener('click', () => {
			vscode.postMessage({ type: 'open-file' });
		});
		document.getElementById('refresh-btn').addEventListener('click', () => {
			vscode.postMessage({ type: 'refresh' });
		});

		listEl.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}

			const actionBtn = target.closest('[data-action]');
			if (actionBtn instanceof HTMLElement) {
				const action = actionBtn.dataset.action;
				const path = actionBtn.dataset.path || '';
				if (!action) {
					return;
				}

				if (action === 'toggle-menu') {
					state.menuPath = state.menuPath === path ? null : path;
					render();
					return;
				}
				if (action === 'create-submit') {
					submitCreate();
					return;
				}
				if (action === 'create-cancel') {
					cancelCreate();
					return;
				}
				if (action === 'rename-cancel') {
					cancelRename();
					return;
				}
				if (action === 'rename-submit') {
					commitRename(path);
					return;
				}
				if (!path) {
					return;
				}
				if (action === 'open-in-editor') {
					state.menuPath = null;
					render();
					openDatabase(path);
					return;
				}
				if (action === 'delete') {
					const db = getDatabase(path);
					if (!db) {
						return;
					}
					const ok = confirm('Delete "' + db.name + '"? This cannot be undone.');
					if (!ok) {
						return;
					}
				}
				state.menuPath = null;
				render();
				vscode.postMessage({ type: 'database-action', action, path });
				return;
			}

			const row = target.closest('.db-list-item[data-path]');
			if (!(row instanceof HTMLElement)) {
				return;
			}
			const path = row.dataset.path;
			if (!path || state.renamingPath === path) {
				return;
			}
			if (target.closest('.db-list-rename-input')) {
				return;
			}
			openDatabase(path);
		});

		listEl.addEventListener('dblclick', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}
			const nameEl = target.closest('.db-list-name');
			if (!(nameEl instanceof HTMLElement)) {
				return;
			}
			const row = nameEl.closest('.db-list-item[data-path]');
			if (!(row instanceof HTMLElement) || !row.dataset.path) {
				return;
			}
			startRename(row.dataset.path);
		});

		listEl.addEventListener('input', (event) => {
			const target = event.target instanceof HTMLInputElement ? event.target : null;
			if (!target) {
				return;
			}
			if (target.classList.contains('db-create-input')) {
				state.createDraft = target.value;
				return;
			}
			if (target.classList.contains('db-list-rename-input')) {
				state.renameDraft = target.value;
			}
		});

		listEl.addEventListener('keydown', (event) => {
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}

			if (target instanceof HTMLInputElement && target.classList.contains('db-create-input')) {
				if (event.key === 'Enter') {
					event.preventDefault();
					submitCreate();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					cancelCreate();
				}
				return;
			}

			if (target instanceof HTMLInputElement && target.classList.contains('db-list-rename-input')) {
				const path = target.dataset.path || '';
				if (!path) {
					return;
				}
				if (event.key === 'Enter') {
					event.preventDefault();
					commitRename(path);
				} else if (event.key === 'Escape') {
					event.preventDefault();
					cancelRename();
				}
				return;
			}

			if (event.key !== 'Enter' && event.key !== ' ') {
				return;
			}
			if (!(target instanceof HTMLElement) || !target.matches('[data-path]')) {
				return;
			}
			const path = target.dataset.path;
			if (!path || state.renamingPath === path) {
				return;
			}
			event.preventDefault();
			openDatabase(path);
		});

		listEl.addEventListener('focusout', (event) => {
			const target = event.target instanceof HTMLInputElement ? event.target : null;
			if (!target || !target.classList.contains('db-list-rename-input')) {
				return;
			}
			const path = target.dataset.path || '';
			if (!path) {
				return;
			}
			commitRename(path);
		});

		document.addEventListener('click', (event) => {
			if (!state.menuPath) {
				return;
			}
			const target = event.target instanceof Element ? event.target : null;
			if (!target) {
				return;
			}
			if (target.closest('.db-context-menu') || target.closest('[data-action="toggle-menu"]')) {
				return;
			}
			state.menuPath = null;
			render();
		});

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (!msg || msg.type !== 'snapshot') {
				return;
			}
			state.selectedPath = msg.selectedPath;
			state.databases = Array.isArray(msg.databases) ? msg.databases : [];
			if (state.menuPath && !state.databases.some((db) => db.path === state.menuPath)) {
				state.menuPath = null;
			}
			if (state.renamingPath && !state.databases.some((db) => db.path === state.renamingPath)) {
				state.renamingPath = null;
				state.renameDraft = '';
			}
			render();
		});

		function getDatabase(path) {
			return state.databases.find((db) => db.path === path) || null;
		}

		function openDatabase(path) {
			vscode.postMessage({ type: 'open-database', path });
		}

		function focusCreateInput() {
			requestAnimationFrame(() => {
				const input = listEl.querySelector('.db-create-input');
				if (input instanceof HTMLInputElement) {
					input.focus();
				}
			});
		}

		function focusRenameInput() {
			requestAnimationFrame(() => {
				const input = listEl.querySelector('.db-list-rename-input[data-path="' + state.renamingPath + '"]');
				if (input instanceof HTMLInputElement) {
					input.focus();
					input.select();
				}
			});
		}

		function submitCreate() {
			const name = state.createDraft.trim();
			if (!name) {
				focusCreateInput();
				return;
			}
			state.creating = false;
			state.createDraft = '';
			render();
			vscode.postMessage({ type: 'create-database', name });
		}

		function cancelCreate() {
			state.creating = false;
			state.createDraft = '';
			render();
		}

		function startRename(path) {
			const db = getDatabase(path);
			if (!db) {
				return;
			}
			state.menuPath = null;
			state.creating = false;
			state.renamingPath = path;
			state.renameDraft = db.name;
			render();
			focusRenameInput();
		}

		function cancelRename() {
			state.renamingPath = null;
			state.renameDraft = '';
			render();
		}

		function commitRename(path) {
			if (state.renamingPath !== path) {
				return;
			}
			const db = getDatabase(path);
			const nextName = state.renameDraft.trim();
			const prevName = db ? db.name : '';
			state.renamingPath = null;
			state.renameDraft = '';
			render();
			if (!nextName || nextName === prevName) {
				return;
			}
			vscode.postMessage({ type: 'rename-database', path, name: nextName });
		}

		function render() {
			listEl.innerHTML = '';

			if (state.creating) {
				const form = document.createElement('div');
				form.className = 'db-new-form';

				const input = document.createElement('input');
				input.className = 'db-input db-create-input';
				input.placeholder = 'Database name';
				input.value = state.createDraft;
				form.appendChild(input);

				const btns = document.createElement('div');
				btns.className = 'db-new-form-btns';
				const createBtn = document.createElement('button');
				createBtn.className = 'db-btn db-btn-primary';
				createBtn.type = 'button';
				createBtn.textContent = 'Create';
				createBtn.dataset.action = 'create-submit';
				btns.appendChild(createBtn);

				const cancelBtn = document.createElement('button');
				cancelBtn.className = 'db-btn';
				cancelBtn.type = 'button';
				cancelBtn.textContent = 'Cancel';
				cancelBtn.dataset.action = 'create-cancel';
				btns.appendChild(cancelBtn);

				form.appendChild(btns);
				listEl.appendChild(form);
				return;
			}

			if (state.databases.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'db-list-empty';
				empty.textContent = 'No .db.json files found';
				listEl.appendChild(empty);
				return;
			}

			for (const db of state.databases) {
				const row = document.createElement('div');
				row.className = 'db-list-item';
				if (db.path === state.selectedPath) {
					row.classList.add('db-list-item--active');
				}
				row.dataset.path = db.path;
				row.tabIndex = 0;
				row.setAttribute('role', 'button');
				row.title = db.path + '\\n' + db.recordsCount + ' records, ' + db.viewsCount + ' views';

				const icon = document.createElement('span');
				icon.className = 'db-list-icon';
				icon.textContent = '●';
				row.appendChild(icon);

				if (state.renamingPath === db.path) {
					const renameInput = document.createElement('input');
					renameInput.className = 'db-input db-list-rename-input';
					renameInput.value = state.renameDraft;
					renameInput.dataset.path = db.path;
					row.appendChild(renameInput);

					const saveBtn = document.createElement('button');
					saveBtn.className = 'db-list-menu-btn';
					saveBtn.type = 'button';
					saveBtn.dataset.action = 'rename-submit';
					saveBtn.dataset.path = db.path;
					saveBtn.textContent = '✓';
					saveBtn.style.opacity = '1';
					row.appendChild(saveBtn);
				} else {
					const name = document.createElement('span');
					name.className = 'db-list-name';
					name.textContent = db.name;
					row.appendChild(name);

					const count = document.createElement('span');
					count.className = 'db-list-count';
					count.textContent = String(db.recordsCount);
					row.appendChild(count);

					const menuBtn = document.createElement('button');
					menuBtn.className = 'db-list-menu-btn';
					menuBtn.type = 'button';
					menuBtn.title = 'More actions';
					menuBtn.textContent = '⋯';
					menuBtn.dataset.action = 'toggle-menu';
					menuBtn.dataset.path = db.path;
					menuBtn.setAttribute('aria-label', 'More actions');
					if (state.menuPath === db.path) {
						menuBtn.dataset.open = 'true';
					}
					row.appendChild(menuBtn);
				}

				if (state.menuPath === db.path) {
					const menu = document.createElement('div');
					menu.className = 'db-context-menu';

					for (const action of MENU_ACTIONS) {
						const actionBtn = document.createElement('button');
						actionBtn.className = 'db-context-menu-item';
						if (action.danger) {
							actionBtn.classList.add('db-context-menu-item--danger');
						}
						actionBtn.type = 'button';
						actionBtn.textContent = action.label;
						actionBtn.dataset.action = action.id;
						actionBtn.dataset.path = db.path;
						menu.appendChild(actionBtn);
					}

					row.appendChild(menu);
				}

				listEl.appendChild(row);
			}
		}

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables.length = 0;
		this.view = undefined;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}
