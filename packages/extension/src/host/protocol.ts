/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#protocol
 * @task: TASK-017
 * @validated: null
 * ---
 *
 * Message protocol between extension host and webview.
 * Keep in sync with src/webview/protocol.ts (or import from shared location).
 */

import type { Database, DBRecord, DBView, Field, ViewType } from 'sogo-db-core';

// ── Host → Webview ─────────────────────────────────────────────

export interface DatabaseSnapshot {
	type: 'snapshot';
	database: Database;
	activeViewId: string;
	/** Records after sort/filter applied for active view */
	processedRecords: DBRecord[];
	/** All databases for relation resolution */
	allDatabases: Array<{ id: string; name: string }>;
	/** Full database catalog for advanced relation/schema/record UI */
	databaseCatalog: Array<{ id: string; name: string; schema: Field[]; records: DBRecord[] }>;
	/** Pre-resolved map of record ID → display title for relation fields */
	relationTitles: Record<string, string>;
	/** Best-effort local sync/write status */
	syncStatus: SyncStatus;
}

export interface ThemeUpdate {
	type: 'theme';
	kind: 'light' | 'dark' | 'high-contrast';
}

export interface SyncStatus {
	kind: 'local' | 'syncing' | 'synced' | 'failed';
	message?: string;
	updatedAt: string;
}

export interface OpenRecordUiMessage {
	type: 'open-record-ui';
	recordId: string;
}

export type HostMessage = DatabaseSnapshot | ThemeUpdate | OpenRecordUiMessage;

// ── Webview → Host ─────────────────────────────────────────────

export interface UpdateRecordCommand {
	type: 'update-record';
	recordId: string;
	fieldId: string;
	value: string | number | boolean | string[] | null;
}

export interface CreateRecordCommand {
	type: 'create-record';
	values?: Record<string, string | number | boolean | string[] | null>;
}

export interface DeleteRecordCommand {
	type: 'delete-record';
	recordId: string;
}

export interface DuplicateRecordCommand {
	type: 'duplicate-record';
	recordId: string;
}

export interface MoveRecordCommand {
	type: 'move-record';
	recordId: string;
	fieldId: string;
	value: string;
}

export interface UpdateRecordInDatabaseCommand {
	type: 'update-record-in-database';
	databaseId: string;
	recordId: string;
	fieldId: string;
	value: string | number | boolean | string[] | null;
}

export interface CreateRelatedRecordCommand {
	type: 'create-related-record';
	sourceDatabaseId: string;
	sourceRecordId: string;
	relationFieldId: string;
	targetDatabaseId: string;
	title: string;
}

export interface UpdateRelationLinksCommand {
	type: 'update-relation-links';
	databaseId: string;
	recordId: string;
	relationFieldId: string;
	recordIds: string[];
}

export interface UpdateHeaderFieldsCommand {
	type: 'update-header-fields';
	databaseId: string;
	fieldIds: string[];
}

export interface SwitchViewCommand {
	type: 'switch-view';
	viewId: string;
}

export interface CreateViewCommand {
	type: 'create-view';
	name: string;
	viewType: ViewType;
}

export interface UpdateViewCommand {
	type: 'update-view';
	viewId: string;
	changes: Partial<Pick<DBView, 'name' | 'sort' | 'filter' | 'hiddenFields' | 'fieldOrder' | 'groupBy' | 'columnWidths' | 'cardCoverField' | 'cardFields'>>;
}

export interface DeleteViewCommand {
	type: 'delete-view';
	viewId: string;
}

export interface UpdateSchemaCommand {
	type: 'update-schema';
	schema: Field[];
}

export interface OpenRecordCommand {
	type: 'open-record';
	recordId: string;
	databaseId?: string;
}

export interface ReadyCommand {
	type: 'ready';
}

export type WebviewCommand =
	| UpdateRecordCommand
	| CreateRecordCommand
	| DeleteRecordCommand
	| DuplicateRecordCommand
	| MoveRecordCommand
	| UpdateRecordInDatabaseCommand
	| CreateRelatedRecordCommand
	| UpdateRelationLinksCommand
	| UpdateHeaderFieldsCommand
	| SwitchViewCommand
	| CreateViewCommand
	| UpdateViewCommand
	| DeleteViewCommand
	| UpdateSchemaCommand
	| OpenRecordCommand
	| ReadyCommand;
