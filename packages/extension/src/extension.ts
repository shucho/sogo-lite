/**
 * ---
 * @anchor: .patterns/npm-package
 * @spec: specs/vscode-extension.md#activation
 * @task: TASK-017
 * @validated: null
 * ---
 *
 * Extension entry point — wires up DatabaseManager, Sidebar, FileWatcher, Editor, Commands.
 */

import * as vscode from 'vscode';
import { DatabaseManager } from './host/DatabaseManager.js';
import { DatabaseSidebarProvider } from './host/DatabaseSidebarProvider.js';
import { DatabaseFileWatcher } from './host/DatabaseFileWatcher.js';
import { DatabaseEditorProvider } from './host/DatabaseEditorProvider.js';
import { registerCommands } from './host/commands.js';

export function activate(context: vscode.ExtensionContext): void {
	const manager = new DatabaseManager(context);

	// Sidebar database view
	context.subscriptions.push(
		DatabaseSidebarProvider.register(context, manager),
	);

	// File watcher
	const watcher = new DatabaseFileWatcher(manager);
	watcher.start();
	context.subscriptions.push({ dispose: () => watcher.dispose() });

	// Custom editor for .db.json
	context.subscriptions.push(
		DatabaseEditorProvider.register(context, manager),
	);

	// Command palette
	registerCommands(context, manager);

	// Initial scan
	manager.scanAll();
}

export function deactivate(): void {
	// Disposables cleaned up via context.subscriptions
}
