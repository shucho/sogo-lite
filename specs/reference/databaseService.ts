/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Database, DatabaseScope, DBRecord, Field, STATUS_OPTIONS } from '../common/database.js';
import { IDatabaseSyncService } from '../common/databaseSync.js';
import { IPathService } from '../../../services/path/common/pathService.js';

export const IDatabaseService = createDecorator<IDatabaseService>('databaseService');

export interface IDatabaseService {
	readonly _serviceBrand: undefined;
	scanWorkspace(): Promise<Array<{ db: Database; uri: URI }>>;
	scanAll(): Promise<Array<{ db: Database; uri: URI; scope: DatabaseScope }>>;
	getGlobalPaths(): URI[];
	readDatabase(uri: URI): Promise<Database>;
	saveDatabase(db: Database, uri: URI): Promise<void>;
	migrateSchema(db: Database, newSchema: Field[]): void;
	createDatabase(name: string, folderUri: URI, scope?: DatabaseScope): Promise<{ db: Database; uri: URI }>;
	deleteDatabase(uri: URI): Promise<void>;
	duplicateDatabase(db: Database, uri: URI, folderUri: URI): Promise<{ db: Database; uri: URI }>;
	exportCsv(db: Database): string;
	importCsvRecords(db: Database, csvText: string, fieldMap: Record<string, string>): DBRecord[];
}

class DatabaseService extends Disposable implements IDatabaseService {
	declare readonly _serviceBrand: undefined;

	private static readonly GLOBAL_DATABASES_DIR = 'globalDatabases';

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IDatabaseSyncService private readonly databaseSyncService: IDatabaseSyncService,
		@IPathService private readonly pathService: IPathService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
	}

	getGlobalPaths(): URI[] {
		const home = this.pathService.userHome({ preferLocal: true });
		// Use '.sogo' (without -dev suffix) so dev and production share global databases.
		const builtIn = URI.joinPath(home, '.sogo', DatabaseService.GLOBAL_DATABASES_DIR);
		const extra: URI[] = [];
		const configured = this.configurationService.getValue<string[]>('database.globalPaths') ?? [];
		for (const raw of configured) {
			if (!raw) {
				continue;
			}
			// Resolve ~ to user home
			const resolved = raw.startsWith('~/')
				? URI.joinPath(home, raw.slice(2))
				: URI.file(raw);
			extra.push(resolved);
		}
		return [builtIn, ...extra];
	}

	async scanWorkspace(): Promise<Array<{ db: Database; uri: URI }>> {
		const folders = this.contextService.getWorkspace().folders;
		const results: Array<{ db: Database; uri: URI }> = [];
		for (const folder of folders) {
			await this._scanFolder(folder.uri, results, 3);
		}
		return results;
	}

	async scanAll(): Promise<Array<{ db: Database; uri: URI; scope: DatabaseScope }>> {
		const seenIds = new Set<string>();
		const results: Array<{ db: Database; uri: URI; scope: DatabaseScope }> = [];

		// Scan global paths first (2 levels deep)
		for (const globalPath of this.getGlobalPaths()) {
			const globalResults: Array<{ db: Database; uri: URI }> = [];
			await this._scanFolder(globalPath, globalResults, 2);
			for (const entry of globalResults) {
				if (!seenIds.has(entry.db.id)) {
					seenIds.add(entry.db.id);
					results.push({ ...entry, scope: 'global' });
				}
			}
		}

		// Scan workspace folders (3 levels deep)
		const workspaceResults = await this.scanWorkspace();
		for (const entry of workspaceResults) {
			if (!seenIds.has(entry.db.id)) {
				seenIds.add(entry.db.id);
				results.push({ ...entry, scope: 'workspace' });
			}
		}

		return results;
	}

	private async _scanFolder(folderUri: URI, results: Array<{ db: Database; uri: URI }>, depth: number): Promise<void> {
		if (depth <= 0) { return; }
		try {
			const stat = await this.fileService.resolve(folderUri);
			if (!stat.children) { return; }
			for (const child of stat.children) {
				if (!child.isDirectory && child.name.endsWith('.db.json')) {
					try {
						const db = await this.readDatabase(child.resource);
						results.push({ db, uri: child.resource });
					} catch { /* skip malformed */ }
				} else if (child.isDirectory && depth > 1) {
					await this._scanFolder(child.resource, results, depth - 1);
				}
			}
		} catch { /* skip inaccessible */ }
	}

	async readDatabase(uri: URI): Promise<Database> {
		const content = await this.fileService.readFile(uri);
		const db = JSON.parse(content.value.toString()) as Database;
		db.schema ??= [];
		db.views ??= [];
		db.records ??= [];
		// Ensure all views have required arrays
		for (const view of db.views) {
			view.sort ??= [];
			view.filter ??= [];
			view.hiddenFields ??= [];
			if (view.type === 'kanban' && /^board$/i.test(view.name)) {
				view.name = 'Kanban';
			}
		}
		return db;
	}

	async saveDatabase(db: Database, uri: URI): Promise<void> {
		await this._writeDatabase(db, uri);
		await this._syncRelationBacklinks(db);
	}

	migrateSchema(db: Database, newSchema: Field[]): void {
		const oldSchema = db.schema ?? [];
		const oldFieldById = new Map(oldSchema.map(field => [field.id, field]));
		const newFieldById = new Map(newSchema.map(field => [field.id, field]));
		const newFieldIds = new Set(newSchema.map(field => field.id));

		for (const record of db.records) {
			for (const oldField of oldSchema) {
				if (!newFieldIds.has(oldField.id)) {
					delete record[oldField.id];
				}
			}

			for (const newField of newSchema) {
				const oldField = oldFieldById.get(newField.id);
				const previousValue = record[newField.id];
				if (oldField && oldField.type === newField.type && previousValue !== undefined) {
					continue;
				}
				record[newField.id] = coerceValueForField(newField, previousValue);
			}
		}

		const fallbackGroupBy = newSchema.find(field => field.type === 'status' || field.type === 'select')?.id;
		for (const view of db.views) {
			view.sort = (view.sort ?? []).filter(sort => newFieldById.has(sort.fieldId));
			view.filter = (view.filter ?? []).filter(filter => newFieldById.has(filter.fieldId));
			view.hiddenFields = (view.hiddenFields ?? []).filter(fieldId => newFieldById.has(fieldId));
			if (view.fieldOrder) {
				const order = view.fieldOrder.filter(fieldId => newFieldById.has(fieldId));
				for (const field of newSchema) {
					if (!order.includes(field.id)) {
						order.push(field.id);
					}
				}
				view.fieldOrder = order;
			}
			if (view.columnWidths) {
				const kept: Record<string, number> = {};
				for (const [fieldId, width] of Object.entries(view.columnWidths)) {
					if (newFieldById.has(fieldId)) {
						kept[fieldId] = width;
					}
				}
				view.columnWidths = kept;
			}
			if ((view.type === 'kanban' || view.type === 'gallery') && (!view.groupBy || !newFieldById.has(view.groupBy))) {
				view.groupBy = fallbackGroupBy;
			}
		}

		db.schema = newSchema.map(field => ({ ...field, options: field.options ? [...field.options] : undefined }));
	}

	async createDatabase(name: string, folderUri: URI, scope?: DatabaseScope): Promise<{ db: Database; uri: URI }> {
		const targetFolder = scope === 'global' ? this.getGlobalPaths()[0] : folderUri;
		const db = isTasksDatabaseName(name) ? createTaskDatabaseTemplate(name) : createDefaultDatabaseTemplate(name);
		const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
		const uri = URI.joinPath(targetFolder, `${safeName}.db.json`);
		// Ensure the target directory exists
		try {
			await this.fileService.createFolder(targetFolder);
		} catch { /* may already exist */ }
		await this.saveDatabase(db, uri);
		return { db, uri };
	}

	async deleteDatabase(uri: URI): Promise<void> {
		await this.fileService.del(uri);
	}

	async duplicateDatabase(db: Database, _uri: URI, folderUri: URI): Promise<{ db: Database; uri: URI }> {
		const newDb: Database = {
			...db,
			id: generateUuid(),
			name: `${db.name} (Copy)`,
			records: db.records.map(r => ({ ...r, id: generateUuid() })),
			views: db.views.map(v => ({ ...v, id: generateUuid() })),
		};
		const safeName = newDb.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
		const newUri = URI.joinPath(folderUri, `${safeName}.db.json`);
		await this.saveDatabase(newDb, newUri);
		return { db: newDb, uri: newUri };
	}

	exportCsv(db: Database): string {
		const schema = db.schema;
		// Header row: field names
		const headers = ['id', ...schema.map(f => f.name)];
		const rows: string[] = [headers.map(csvEscape).join(',')];
		for (const record of db.records) {
			const cells = [
				csvEscape(record.id),
				...schema.map(f => {
					const val = record[f.id];
					if (val === null || val === undefined) { return ''; }
					if (Array.isArray(val)) { return csvEscape(val.join(';')); }
					return csvEscape(String(val));
				}),
			];
			rows.push(cells.join(','));
		}
		return rows.join('\r\n');
	}

	importCsvRecords(db: Database, csvText: string, fieldMap: Record<string, string>): DBRecord[] {
		const lines = csvText.split(/\r?\n/).filter(l => l.trim());
		if (lines.length < 2) { return []; }
		const headers = parseCsvRow(lines[0]);
		const records: DBRecord[] = [];
		const now = new Date().toISOString();
		for (let i = 1; i < lines.length; i++) {
			const cells = parseCsvRow(lines[i]);
			const record: DBRecord = { id: generateUuid(), _createdAt: now };
			for (let j = 0; j < headers.length; j++) {
				const csvHeader = headers[j];
				const fieldId = fieldMap[csvHeader];
				if (!fieldId) { continue; }
				const field = db.schema.find(f => f.id === fieldId);
				if (!field) { continue; }
				const raw = cells[j] ?? '';
				if (field.type === 'number') {
					record[fieldId] = raw === '' ? null : Number(raw);
				} else if (field.type === 'checkbox') {
					record[fieldId] = raw.toLowerCase() === 'true' || raw === '1';
				} else if (field.type === 'multiselect') {
					record[fieldId] = raw ? raw.split(';').map(s => s.trim()) : [];
				} else {
					record[fieldId] = raw || null;
				}
			}
			records.push(record);
		}
		return records;
	}

	private async _writeDatabase(db: Database, uri: URI): Promise<void> {
		await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(db, null, '\t')));
		void this.databaseSyncService.enqueueSync(uri, db).catch(() => { /* best-effort sync */ });
	}

	private async _syncRelationBacklinks(sourceDb: Database): Promise<void> {
		const relationFields = sourceDb.schema.filter(field =>
			field.type === 'relation' &&
			field.relation?.targetDatabaseId &&
			field.relation?.targetRelationFieldId
		);
		if (!relationFields.length) {
			return;
		}

		const scanned = await this.scanAll();
		const dbById = new Map<string, Database>();
		const uriById = new Map<string, URI>();
		for (const entry of scanned) {
			dbById.set(entry.db.id, entry.db);
			uriById.set(entry.db.id, entry.uri);
		}
		dbById.set(sourceDb.id, sourceDb);

		const sourceRecordIds = new Set(sourceDb.records.map(record => record.id));
		const changedDbIds = new Set<string>();

		for (const relationField of relationFields) {
			const targetDbId = relationField.relation!.targetDatabaseId!;
			const targetRelationFieldId = relationField.relation!.targetRelationFieldId!;
			const targetDb = dbById.get(targetDbId);
			if (!targetDb) {
				continue;
			}
			const targetField = targetDb.schema.find(field => field.id === targetRelationFieldId && field.type === 'relation');
			if (!targetField) {
				continue;
			}

			const inboundByTargetRecordId = new Map<string, Set<string>>();
			for (const sourceRecord of sourceDb.records) {
				const linked = sourceRecord[relationField.id];
				if (!Array.isArray(linked)) {
					continue;
				}
				for (const linkedId of linked.map(id => String(id))) {
					if (!inboundByTargetRecordId.has(linkedId)) {
						inboundByTargetRecordId.set(linkedId, new Set<string>());
					}
					inboundByTargetRecordId.get(linkedId)!.add(sourceRecord.id);
				}
			}

			for (const targetRecord of targetDb.records) {
				const expectedInbound = inboundByTargetRecordId.get(targetRecord.id) ?? new Set<string>();
				const currentLinks = new Set<string>(Array.isArray(targetRecord[targetField.id]) ? (targetRecord[targetField.id] as string[]).map(id => String(id)) : []);
				let changed = false;

				for (const sourceId of sourceRecordIds) {
					const shouldContain = expectedInbound.has(sourceId);
					const hasLink = currentLinks.has(sourceId);
					if (shouldContain && !hasLink) {
						currentLinks.add(sourceId);
						changed = true;
					}
					if (!shouldContain && hasLink) {
						currentLinks.delete(sourceId);
						changed = true;
					}
				}

				if (changed) {
					targetRecord[targetField.id] = [...currentLinks];
					changedDbIds.add(targetDb.id);
				}
			}
		}

		for (const changedDbId of changedDbIds) {
			const changedDb = dbById.get(changedDbId);
			const changedUri = uriById.get(changedDbId);
			if (!changedDb || !changedUri) {
				continue;
			}
			await this._writeDatabase(changedDb, changedUri);
		}
	}
}

function csvEscape(val: string): string {
	if (val.includes(',') || val.includes('"') || val.includes('\n')) {
		return `"${val.replace(/"/g, '""')}"`;
	}
	return val;
}

function parseCsvRow(line: string): string[] {
	const cells: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
			else { inQuotes = !inQuotes; }
		} else if (ch === ',' && !inQuotes) {
			cells.push(cur); cur = '';
		} else {
			cur += ch;
		}
	}
	cells.push(cur);
	return cells;
}

function coerceValueForField(field: Field, value: unknown): string | number | boolean | string[] | null {
	if (value === undefined || value === null || value === '') {
		if (field.type === 'multiselect') {
			return [];
		}
		if (field.type === 'relation') {
			return [];
		}
		if (field.type === 'rollup' || field.type === 'formula') {
			return null;
		}
		if (field.type === 'createdAt' || field.type === 'lastEditedAt') {
			return new Date().toISOString();
		}
		return null;
	}

	switch (field.type) {
		case 'number': {
			const num = typeof value === 'number' ? value : Number(value);
			return Number.isFinite(num) ? num : null;
		}
		case 'checkbox':
			if (typeof value === 'boolean') {
				return value;
			}
			if (typeof value === 'number') {
				return value !== 0;
			}
			if (typeof value === 'string') {
				const normalized = value.trim().toLowerCase();
				return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
			}
			return false;
		case 'multiselect':
			if (Array.isArray(value)) {
				return value.map(item => String(item)).filter(Boolean);
			}
			if (typeof value === 'string') {
				return value.split(/[;,]/).map(item => item.trim()).filter(Boolean);
			}
			return [];
		case 'relation':
			if (Array.isArray(value)) {
				return value.map(item => String(item)).filter(Boolean);
			}
			if (typeof value === 'string') {
				return value.split(/[;,]/).map(item => item.trim()).filter(Boolean);
			}
			return [];
		case 'rollup':
		case 'formula':
			return null;
		case 'select':
		case 'status': {
			const normalized = Array.isArray(value) ? (value[0] ?? null) : value;
			const candidate = (normalized === null || normalized === undefined) ? null : String(normalized);
			if (!candidate) {
				return null;
			}
			if (field.options?.length && !field.options.includes(candidate)) {
				return null;
			}
			return candidate;
		}
		case 'createdAt':
		case 'lastEditedAt':
		case 'text':
		case 'date':
		case 'url':
		case 'email':
		case 'phone':
			return String(value);
	}
}

registerSingleton(IDatabaseService, DatabaseService, InstantiationType.Delayed);

function isTasksDatabaseName(name: string): boolean {
	return /\btask(s)?\b/i.test(name.trim());
}

function createDefaultDatabaseTemplate(name: string): Database {
	const titleId = generateUuid();
	const statusId = generateUuid();
	return {
		id: generateUuid(),
		name,
		schema: [
			{ id: titleId, name: 'Title', type: 'text' },
			{ id: statusId, name: 'Status', type: 'status', options: [...STATUS_OPTIONS] },
		],
		views: [
			{
				id: generateUuid(),
				name: 'All Items',
				type: 'table',
				sort: [],
				filter: [],
				hiddenFields: [],
			},
			{
				id: generateUuid(),
				name: 'Kanban',
				type: 'kanban',
				groupBy: statusId,
				sort: [],
				filter: [],
				hiddenFields: [],
			},
		],
		records: [],
	};
}

function createTaskDatabaseTemplate(name: string): Database {
	const titleId = generateUuid();
	const statusId = generateUuid();
	const priorityId = generateUuid();
	const dueDateId = generateUuid();
	const effortId = generateUuid();
	const blockedId = generateUuid();
	const projectsId = generateUuid();
	return {
		id: generateUuid(),
		name,
		schema: [
			{ id: titleId, name: 'Title', type: 'text' },
			{ id: statusId, name: 'Status', type: 'status', options: [...STATUS_OPTIONS] },
			{ id: priorityId, name: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] },
			{ id: dueDateId, name: 'Due Date', type: 'date' },
			{ id: effortId, name: 'Effort', type: 'number' },
			{ id: blockedId, name: 'Blocked', type: 'checkbox' },
			{ id: projectsId, name: 'Project', type: 'relation', relation: {} },
		],
		views: [
			{
				id: generateUuid(),
				name: 'All Tasks',
				type: 'table',
				sort: [{ fieldId: dueDateId, direction: 'asc' }],
				filter: [],
				hiddenFields: [],
			},
			{
				id: generateUuid(),
				name: 'By Status',
				type: 'kanban',
				groupBy: statusId,
				sort: [],
				filter: [],
				hiddenFields: [],
			},
			{
				id: generateUuid(),
				name: 'Calendar',
				type: 'calendar',
				groupBy: dueDateId,
				sort: [],
				filter: [],
				hiddenFields: [],
			},
		],
		records: [],
	};
}
