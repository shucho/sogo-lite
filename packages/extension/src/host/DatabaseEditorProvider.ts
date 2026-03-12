/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#editor-provider
 * @task: TASK-020
 * @validated: null
 * ---
 *
 * CustomEditorProvider for .db.json files.
 * Creates webview, sends snapshots, handles commands from webview.
 */

import * as vscode from 'vscode';
import { getRecordTitle } from 'sogo-db-core';
import { EDITOR_VIEW_TYPE } from './constants.js';
import type { DatabaseManager, DatabaseEntry } from './DatabaseManager.js';
import type { DatabaseSnapshot, HostMessage, WebviewCommand, ThemeUpdate } from './protocol.js';

export class DatabaseEditorProvider implements vscode.CustomTextEditorProvider {
	private readonly webviews = new Map<string, vscode.WebviewPanel>();
	private readonly pendingRecordOpenByPath = new Map<string, string>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly manager: DatabaseManager,
	) {}

	static register(
		context: vscode.ExtensionContext,
		manager: DatabaseManager,
	): vscode.Disposable {
		const provider = new DatabaseEditorProvider(context, manager);
		return vscode.window.registerCustomEditorProvider(EDITOR_VIEW_TYPE, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		});
	}

	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
	): Promise<void> {
		const filePath = document.uri.fsPath;

		// Ensure database is loaded
		let entry = this.manager.getByPath(filePath);
		if (!entry) {
			entry = await this.manager.reloadFile(filePath);
		}
		if (!entry) {
			panel.webview.html = this.getErrorHtml('Failed to load database');
			return;
		}

		this.webviews.set(filePath, panel);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
			],
		};

		panel.webview.html = this.getWebviewHtml(panel.webview);

		// Active view state per editor
		let activeViewId = entry.db.views[0]?.id ?? '';

		// Send snapshot when database changes
		const changeDisposable = this.manager.onDidChange((changed) => {
			if (!changed || changed.path === filePath) {
				const current = this.manager.getByPath(filePath);
				if (current) {
					this.sendSnapshot(panel.webview, current, activeViewId);
				}
			}
		});

		// Listen for webview messages
		const messageDisposable = panel.webview.onDidReceiveMessage(
			(msg: WebviewCommand) => {
				const current = this.manager.getByPath(filePath);
				if (!current) return;

				switch (msg.type) {
					case 'ready':
						this.sendSnapshot(panel.webview, current, activeViewId);
						this.sendTheme(panel.webview);
						this.flushPendingRecordOpen(filePath);
						break;
					case 'update-record':
						this.manager.updateRecord(current.db.id, msg.recordId, msg.fieldId, msg.value);
						break;
					case 'create-record':
						this.manager.createRecord(current.db.id, msg.values);
						break;
					case 'delete-record':
						this.manager.deleteRecord(current.db.id, msg.recordId);
						break;
					case 'duplicate-record':
						this.manager.duplicateRecord(current.db.id, msg.recordId);
						break;
					case 'move-record':
						this.manager.updateRecord(current.db.id, msg.recordId, msg.fieldId, msg.value);
						break;
					case 'update-record-in-database':
						this.manager.updateRecord(msg.databaseId, msg.recordId, msg.fieldId, msg.value);
						break;
					case 'create-related-record':
						this.manager.createRelatedRecord(
							msg.sourceDatabaseId,
							msg.sourceRecordId,
							msg.relationFieldId,
							msg.targetDatabaseId,
							msg.title,
						);
						break;
					case 'update-relation-links':
						this.manager.updateRecord(msg.databaseId, msg.recordId, msg.relationFieldId, msg.recordIds);
						break;
					case 'update-header-fields':
						this.manager.updateHeaderFields(msg.databaseId, msg.fieldIds);
						break;
					case 'switch-view':
						activeViewId = msg.viewId;
						this.sendSnapshot(panel.webview, current, activeViewId);
						break;
					case 'create-view':
						this.manager.createView(current.db.id, msg.name, msg.viewType).then((v) => {
							if (v) {
								activeViewId = v.id;
								const updated = this.manager.getByPath(filePath);
								if (updated) this.sendSnapshot(panel.webview, updated, activeViewId);
							}
						});
						break;
					case 'update-view':
						this.manager.updateView(current.db.id, msg.viewId, msg.changes);
						break;
					case 'delete-view': {
						const wasActive = msg.viewId === activeViewId;
						this.manager.deleteView(current.db.id, msg.viewId).then(() => {
							if (wasActive) {
								const updated = this.manager.getByPath(filePath);
								if (updated) {
									activeViewId = updated.db.views[0]?.id ?? '';
									this.sendSnapshot(panel.webview, updated, activeViewId);
								}
							}
						});
						break;
					}
					case 'update-schema':
						this.manager.updateSchema(current.db.id, msg.schema);
						break;
					case 'open-record':
						this.openRecord(msg.databaseId ?? current.db.id, msg.recordId, filePath);
						break;
				}
			},
		);

		// Listen for theme changes
		const themeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
			this.sendTheme(panel.webview);
		});

		panel.onDidDispose(() => {
			this.webviews.delete(filePath);
			changeDisposable.dispose();
			messageDisposable.dispose();
			themeDisposable.dispose();
		});
	}

	private sendSnapshot(
		webview: vscode.Webview,
		entry: DatabaseEntry,
		activeViewId: string,
	): void {
		const processedRecords = this.manager.getProcessedRecords(entry.db.id, activeViewId);
		const allEntries = this.manager.getAll();
		const allDatabases = allEntries.map((e) => ({
			id: e.db.id,
			name: e.db.name,
		}));
		const databaseCatalog = allEntries.map((e) => ({
			id: e.db.id,
			name: e.db.name,
			schema: e.db.schema,
			records: e.db.records,
		}));

		// Build relation title lookup: collect all referenced record IDs
		// across relation fields, then resolve each to its display title
		const relationTitles: Record<string, string> = {};
		const relationFields = entry.db.schema.filter((f) => f.type === 'relation');
		if (relationFields.length > 0) {
			const referencedIds = new Set<string>();
			for (const record of entry.db.records) {
				for (const field of relationFields) {
					const val = record[field.id];
					if (Array.isArray(val)) {
						for (const id of val) referencedIds.add(id);
					}
				}
			}
			// Resolve each ID by searching all databases
			for (const id of referencedIds) {
				for (const other of allEntries) {
					const found = other.db.records.find((r) => r.id === id);
					if (found) {
						relationTitles[id] = getRecordTitle(found, other.db.schema);
						break;
					}
				}
			}
		}

		const msg: DatabaseSnapshot = {
			type: 'snapshot',
			database: entry.db,
			activeViewId,
			processedRecords,
			allDatabases,
			databaseCatalog,
			relationTitles,
			syncStatus: this.manager.getSyncStatus(entry.db.id),
		};
		webview.postMessage(msg);
	}

	private openRecord(databaseId: string, recordId: string, fromPath: string): void {
		const target = this.manager.getById(databaseId);
		if (!target) return;

		// Same editor: open record directly in current webview.
		if (target.path === fromPath) {
			const panel = this.webviews.get(fromPath);
			if (!panel) return;
			panel.reveal(panel.viewColumn, false);
			panel.webview.postMessage({ type: 'open-record-ui', recordId } satisfies HostMessage);
			return;
		}

		// Already-open editor for target DB.
		const existing = this.webviews.get(target.path);
		if (existing) {
			existing.reveal(existing.viewColumn, false);
			existing.webview.postMessage({ type: 'open-record-ui', recordId } satisfies HostMessage);
			return;
		}

		// Open target DB editor, then replay once webview is ready.
		this.pendingRecordOpenByPath.set(target.path, recordId);
		void vscode.commands.executeCommand(
			'vscode.openWith',
			vscode.Uri.file(target.path),
			EDITOR_VIEW_TYPE,
		);
	}

	private flushPendingRecordOpen(filePath: string): void {
		const recordId = this.pendingRecordOpenByPath.get(filePath);
		if (!recordId) return;
		const panel = this.webviews.get(filePath);
		if (!panel) return;
		panel.webview.postMessage({ type: 'open-record-ui', recordId } satisfies HostMessage);
		this.pendingRecordOpenByPath.delete(filePath);
	}

	private sendTheme(webview: vscode.Webview): void {
		const kind = vscode.window.activeColorTheme.kind;
		const themeKind =
			kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
				? 'light'
				: kind === vscode.ColorThemeKind.HighContrast
					? 'high-contrast'
					: 'dark';
		const msg: ThemeUpdate = { type: 'theme', kind: themeKind };
		webview.postMessage(msg);
	}

	private getWebviewHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'),
		);
		const nonce = getNonce();

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${styleUri}">
	<title>Sogo DB</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private getErrorHtml(message: string): string {
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body><h2>Error</h2><p>${message}</p></body>
</html>`;
	}
}

function getNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}
