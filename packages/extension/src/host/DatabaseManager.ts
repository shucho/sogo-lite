/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#database-manager
 * @task: TASK-017
 * @validated: null
 * ---
 *
 * Central state manager: scan, cache, CRUD for .db.json files.
 * All file I/O goes through core library. Extension host is the single owner.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import {
	scanAll,
	readDatabaseFile,
	writeDatabaseFile,
	getGlobalDatabasePath,
	applySorts,
	applyFilters,
	migrateSchema,
	createDatabase,
	type Database,
	type DBRecord,
	type DBView,
	type Field,
	type DatabaseResolver,
} from 'sogo-db-core';
import { CONFIG } from './constants.js';

export interface DatabaseEntry {
	db: Database;
	path: string;
	scope: 'global' | 'workspace';
}

export class DatabaseManager {
	private cache = new Map<string, DatabaseEntry>();
	private readonly _onDidChange = new vscode.EventEmitter<DatabaseEntry | undefined>();
	readonly onDidChange = this._onDidChange.event;

	/** Paths we're currently writing — suppress watcher for these */
	private writingPaths = new Set<string>();

	constructor(private readonly context: vscode.ExtensionContext) {}

	// ── Scanning ───────────────────────────────────────────────

	async scanAll(): Promise<DatabaseEntry[]> {
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const config = vscode.workspace.getConfiguration();
		const scanDepth = config.get<number>(CONFIG.scanDepth, 3);

		const results = await scanAll(workspacePath ?? '', undefined, scanDepth);

		this.cache.clear();
		for (const entry of results) {
			this.cache.set(entry.db.id, entry);
		}

		this._onDidChange.fire(undefined);
		return results;
	}

	// ── Read ───────────────────────────────────────────────────

	getAll(): DatabaseEntry[] {
		return [...this.cache.values()];
	}

	getById(id: string): DatabaseEntry | undefined {
		return this.cache.get(id);
	}

	getByPath(filePath: string): DatabaseEntry | undefined {
		for (const entry of this.cache.values()) {
			if (entry.path === filePath) return entry;
		}
		return undefined;
	}

	/** Resolver callback for cross-database relations */
	getResolver(): DatabaseResolver {
		return (id: string) => this.cache.get(id)?.db;
	}

	// ── CRUD ───────────────────────────────────────────────────

	async reloadFile(filePath: string): Promise<DatabaseEntry | undefined> {
		if (this.isWriting(filePath)) return undefined;

		try {
			const db = await readDatabaseFile(filePath);
			const existing = this.getByPath(filePath);
			const scope = existing?.scope ?? this.inferScope(filePath);
			const entry: DatabaseEntry = { db, path: filePath, scope };
			this.cache.set(db.id, entry);
			this._onDidChange.fire(entry);
			return entry;
		} catch {
			return undefined;
		}
	}

	async updateRecord(
		dbId: string,
		recordId: string,
		fieldId: string,
		value: string | number | boolean | string[] | null,
	): Promise<void> {
		const entry = this.cache.get(dbId);
		if (!entry) return;

		const record = entry.db.records.find((r) => r.id === recordId);
		if (!record) return;

		record[fieldId] = value;
		await this.save(entry);
	}

	async createRecord(
		dbId: string,
		values?: Record<string, string | number | boolean | string[] | null>,
	): Promise<DBRecord | undefined> {
		const entry = this.cache.get(dbId);
		if (!entry) return undefined;

		const record: DBRecord = {
			id: crypto.randomUUID(),
			...values,
		};
		entry.db.records.push(record);
		await this.save(entry);
		return record;
	}

	async deleteRecord(dbId: string, recordId: string): Promise<void> {
		const entry = this.cache.get(dbId);
		if (!entry) return;

		entry.db.records = entry.db.records.filter((r) => r.id !== recordId);
		await this.save(entry);
	}

	async updateView(dbId: string, viewId: string, changes: Partial<DBView>): Promise<void> {
		const entry = this.cache.get(dbId);
		if (!entry) return;

		const view = entry.db.views.find((v) => v.id === viewId);
		if (!view) return;

		Object.assign(view, changes);
		await this.save(entry);
	}

	async createView(dbId: string, name: string, viewType: DBView['type']): Promise<DBView | undefined> {
		const entry = this.cache.get(dbId);
		if (!entry) return undefined;

		const view: DBView = {
			id: crypto.randomUUID(),
			name,
			type: viewType,
			sort: [],
			filter: [],
			hiddenFields: [],
		};

		if (viewType === 'kanban') {
			const statusField = entry.db.schema.find((f) => f.type === 'status' || f.type === 'select');
			if (statusField) view.groupBy = statusField.id;
		}
		if (viewType === 'calendar') {
			const dateField = entry.db.schema.find((f) => f.type === 'date');
			if (dateField) view.groupBy = dateField.id;
		}

		entry.db.views.push(view);
		await this.save(entry);
		return view;
	}

	async deleteView(dbId: string, viewId: string): Promise<void> {
		const entry = this.cache.get(dbId);
		if (!entry) return;
		if (entry.db.views.length <= 1) return; // keep at least one

		entry.db.views = entry.db.views.filter((v) => v.id !== viewId);
		await this.save(entry);
	}

	async updateSchema(dbId: string, newSchema: Field[]): Promise<void> {
		const entry = this.cache.get(dbId);
		if (!entry) return;

		migrateSchema(entry.db, newSchema);
		await this.save(entry);
	}

	async createNewDatabase(name: string, dirPath: string): Promise<DatabaseEntry> {
		const db = createDatabase(name);
		const fileName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.db.json';
		const filePath = vscode.Uri.joinPath(vscode.Uri.file(dirPath), fileName).fsPath;

		await writeDatabaseFile(db, filePath);
		const entry: DatabaseEntry = { db, path: filePath, scope: this.inferScope(filePath) };
		this.cache.set(db.id, entry);
		this._onDidChange.fire(entry);
		return entry;
	}

	async renameDatabase(filePath: string, nextName: string): Promise<boolean> {
		const entry = this.getByPath(filePath);
		if (!entry) return false;

		const trimmed = nextName.trim();
		if (!trimmed || trimmed === entry.db.name) return false;

		entry.db.name = trimmed;
		await this.save(entry);
		return true;
	}

	async duplicateDatabase(filePath: string): Promise<DatabaseEntry | undefined> {
		const entry = this.getByPath(filePath);
		if (!entry) return undefined;

		const dirPath = path.dirname(filePath);
		let duplicateName = `${entry.db.name} (copy)`;
		let duplicateIndex = 2;
		const nameSet = new Set(
			this.getAll()
				.filter((candidate) => path.dirname(candidate.path) === dirPath)
				.map((candidate) => candidate.db.name.toLowerCase()),
		);
		while (nameSet.has(duplicateName.toLowerCase())) {
			duplicateName = `${entry.db.name} (copy ${duplicateIndex})`;
			duplicateIndex += 1;
		}

		const baseFileName =
			duplicateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'database';
		let candidatePath = path.join(dirPath, `${baseFileName}.db.json`);
		let pathIndex = 2;
		while (await this.pathExists(candidatePath)) {
			candidatePath = path.join(dirPath, `${baseFileName}-${pathIndex}.db.json`);
			pathIndex += 1;
		}

		const duplicate = JSON.parse(JSON.stringify(entry.db)) as Database;
		duplicate.id = crypto.randomUUID();
		duplicate.name = duplicateName;
		for (const view of duplicate.views) {
			view.id = crypto.randomUUID();
		}
		duplicate.records = duplicate.records.map((record) => ({ ...record, id: crypto.randomUUID() }));

		await writeDatabaseFile(duplicate, candidatePath);
		const duplicatedEntry: DatabaseEntry = {
			db: duplicate,
			path: candidatePath,
			scope: this.inferScope(candidatePath),
		};
		this.cache.set(duplicate.id, duplicatedEntry);
		this._onDidChange.fire(duplicatedEntry);
		return duplicatedEntry;
	}

	async deleteDatabase(filePath: string): Promise<boolean> {
		const entry = this.getByPath(filePath);
		if (!entry) return false;
		await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
		this.removeByPath(filePath);
		return true;
	}

	// ── Processed Records ──────────────────────────────────────

	getProcessedRecords(dbId: string, viewId: string): DBRecord[] {
		const entry = this.cache.get(dbId);
		if (!entry) return [];

		const view = entry.db.views.find((v) => v.id === viewId);
		if (!view) return entry.db.records;

		const resolver = this.getResolver();
		let records = entry.db.records;
		if (view.filter.length > 0) {
			records = applyFilters(records, view.filter, entry.db.schema, entry.db, resolver);
		}
		if (view.sort.length > 0) {
			records = applySorts(records, view.sort, entry.db.schema, entry.db, resolver);
		}
		return records;
	}

	// ── Write Management ───────────────────────────────────────

	isWriting(filePath: string): boolean {
		return this.writingPaths.has(filePath);
	}

	private async save(entry: DatabaseEntry): Promise<void> {
		this.writingPaths.add(entry.path);
		try {
			await writeDatabaseFile(entry.db, entry.path);
			this._onDidChange.fire(entry);
		} finally {
			// Delay removal so the watcher can check
			setTimeout(() => this.writingPaths.delete(entry.path), 500);
		}
	}

	private inferScope(filePath: string): 'global' | 'workspace' {
		const globalPath = getGlobalDatabasePath();
		return filePath.startsWith(globalPath) ? 'global' : 'workspace';
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
			return true;
		} catch {
			return false;
		}
	}

	removeByPath(filePath: string): void {
		for (const [id, entry] of this.cache) {
			if (entry.path === filePath) {
				this.cache.delete(id);
				this._onDidChange.fire(undefined);
				return;
			}
		}
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
