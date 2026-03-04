/**
 * ---
 * @anchor: .patterns/npm-package
 * @spec: specs/vscode-extension.md#protocol
 * @task: TASK-037
 * @validated: null
 * ---
 *
 * Tests for the message protocol types and message construction.
 */

import { describe, it, expect } from 'vitest';
import type {
	DatabaseSnapshot,
	ThemeUpdate,
	UpdateRecordCommand,
	CreateRecordCommand,
	DeleteRecordCommand,
	DuplicateRecordCommand,
	MoveRecordCommand,
	UpdateRecordInDatabaseCommand,
	CreateRelatedRecordCommand,
	UpdateRelationLinksCommand,
	UpdateHeaderFieldsCommand,
	SwitchViewCommand,
	CreateViewCommand,
	UpdateViewCommand,
	DeleteViewCommand,
	UpdateSchemaCommand,
	WebviewCommand,
} from '../host/protocol.js';

describe('protocol types', () => {
	it('DatabaseSnapshot has correct shape', () => {
		const msg: DatabaseSnapshot = {
			type: 'snapshot',
			database: {
				id: 'db-1',
				name: 'Test',
				schema: [],
				views: [],
				records: [],
			},
			activeViewId: 'view-1',
			processedRecords: [],
			allDatabases: [{ id: 'db-1', name: 'Test' }],
			databaseCatalog: [{
				id: 'db-1',
				name: 'Test',
				schema: [],
				records: [],
			}],
			syncStatus: { kind: 'local', updatedAt: '2026-01-01T00:00:00.000Z' },
		};
		expect(msg.type).toBe('snapshot');
		expect(msg.database.id).toBe('db-1');
	});

	it('ThemeUpdate has correct shape', () => {
		const msg: ThemeUpdate = { type: 'theme', kind: 'dark' };
		expect(msg.type).toBe('theme');
		expect(msg.kind).toBe('dark');
	});

	it('UpdateRecordCommand has correct shape', () => {
		const msg: UpdateRecordCommand = {
			type: 'update-record',
			recordId: 'rec-1',
			fieldId: 'field-1',
			value: 'hello',
		};
		expect(msg.type).toBe('update-record');
	});

	it('CreateRecordCommand supports optional values', () => {
		const msg: CreateRecordCommand = { type: 'create-record' };
		expect(msg.values).toBeUndefined();

		const msg2: CreateRecordCommand = {
			type: 'create-record',
			values: { 'field-1': 'value' },
		};
		expect(msg2.values).toBeDefined();
	});

	it('DeleteRecordCommand has correct shape', () => {
		const msg: DeleteRecordCommand = {
			type: 'delete-record',
			recordId: 'rec-1',
		};
		expect(msg.type).toBe('delete-record');
	});

	it('DuplicateRecordCommand has correct shape', () => {
		const msg: DuplicateRecordCommand = {
			type: 'duplicate-record',
			recordId: 'rec-1',
		};
		expect(msg.type).toBe('duplicate-record');
	});

	it('MoveRecordCommand has correct shape', () => {
		const msg: MoveRecordCommand = {
			type: 'move-record',
			recordId: 'rec-1',
			fieldId: 'status-field',
			value: 'Done',
		};
		expect(msg.type).toBe('move-record');
	});

	it('UpdateRecordInDatabaseCommand has correct shape', () => {
		const msg: UpdateRecordInDatabaseCommand = {
			type: 'update-record-in-database',
			databaseId: 'db-2',
			recordId: 'rec-1',
			fieldId: 'field-1',
			value: 'updated',
		};
		expect(msg.type).toBe('update-record-in-database');
	});

	it('CreateRelatedRecordCommand has correct shape', () => {
		const msg: CreateRelatedRecordCommand = {
			type: 'create-related-record',
			sourceDatabaseId: 'db-1',
			sourceRecordId: 'r-source',
			relationFieldId: 'f-rel',
			targetDatabaseId: 'db-2',
			title: 'New related item',
		};
		expect(msg.type).toBe('create-related-record');
	});

	it('UpdateRelationLinksCommand has correct shape', () => {
		const msg: UpdateRelationLinksCommand = {
			type: 'update-relation-links',
			databaseId: 'db-1',
			recordId: 'r-source',
			relationFieldId: 'f-rel',
			recordIds: ['r1', 'r2'],
		};
		expect(msg.type).toBe('update-relation-links');
	});

	it('UpdateHeaderFieldsCommand has correct shape', () => {
		const msg: UpdateHeaderFieldsCommand = {
			type: 'update-header-fields',
			databaseId: 'db-1',
			fieldIds: ['f1', 'f2'],
		};
		expect(msg.type).toBe('update-header-fields');
	});

	it('SwitchViewCommand has correct shape', () => {
		const msg: SwitchViewCommand = {
			type: 'switch-view',
			viewId: 'view-2',
		};
		expect(msg.type).toBe('switch-view');
	});

	it('CreateViewCommand has correct shape', () => {
		const msg: CreateViewCommand = {
			type: 'create-view',
			name: 'Board',
			viewType: 'kanban',
		};
		expect(msg.type).toBe('create-view');
		expect(msg.viewType).toBe('kanban');
	});

	it('UpdateViewCommand has correct shape', () => {
		const msg: UpdateViewCommand = {
			type: 'update-view',
			viewId: 'view-1',
			changes: {
				sort: [{ fieldId: 'f1', direction: 'asc' }],
				hiddenFields: ['f2'],
			},
		};
		expect(msg.type).toBe('update-view');
	});

	it('DeleteViewCommand has correct shape', () => {
		const msg: DeleteViewCommand = {
			type: 'delete-view',
			viewId: 'view-1',
		};
		expect(msg.type).toBe('delete-view');
	});

	it('UpdateSchemaCommand has correct shape', () => {
		const msg: UpdateSchemaCommand = {
			type: 'update-schema',
			schema: [
				{ id: 'f1', name: 'Title', type: 'text' },
				{ id: 'f2', name: 'Status', type: 'status' },
			],
		};
		expect(msg.schema).toHaveLength(2);
	});

	it('WebviewCommand union includes all types', () => {
		const commands: WebviewCommand[] = [
			{ type: 'update-record', recordId: 'r', fieldId: 'f', value: 'v' },
			{ type: 'create-record' },
			{ type: 'delete-record', recordId: 'r' },
			{ type: 'duplicate-record', recordId: 'r' },
			{ type: 'move-record', recordId: 'r', fieldId: 'f', value: 'v' },
			{ type: 'update-record-in-database', databaseId: 'db', recordId: 'r', fieldId: 'f', value: 'v' },
			{ type: 'create-related-record', sourceDatabaseId: 's', sourceRecordId: 'r', relationFieldId: 'f', targetDatabaseId: 't', title: 'x' },
			{ type: 'update-relation-links', databaseId: 'db', recordId: 'r', relationFieldId: 'f', recordIds: [] },
			{ type: 'update-header-fields', databaseId: 'db', fieldIds: ['f'] },
			{ type: 'switch-view', viewId: 'v' },
			{ type: 'create-view', name: 'n', viewType: 'table' },
			{ type: 'update-view', viewId: 'v', changes: {} },
			{ type: 'delete-view', viewId: 'v' },
			{ type: 'update-schema', schema: [] },
			{ type: 'open-record', recordId: 'r' },
			{ type: 'ready' },
		];
		expect(commands).toHaveLength(16);
	});
});

describe('constants', () => {
	it('exports expected values', async () => {
		const { EXTENSION_ID, EDITOR_VIEW_TYPE, TREE_VIEW_ID, COMMANDS, CONFIG } = await import(
			'../host/constants.js'
		);
		expect(EXTENSION_ID).toBe('sogo-db');
		expect(EDITOR_VIEW_TYPE).toBe('sogo-db.databaseEditor');
		expect(TREE_VIEW_ID).toBe('sogo-db.databaseList');
		expect(COMMANDS.createDatabase).toBe('sogo-db.createDatabase');
		expect(CONFIG.globalPaths).toBe('sogo-db.globalPaths');
	});
});
