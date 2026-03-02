/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#webview
 * @task: TASK-021
 * @validated: null
 * ---
 */

import { useState } from 'react';
import { useDatabase } from './hooks/useDatabase.js';
import { ThemeKindProvider } from './hooks/useThemeColors.js';
import { ViewSwitcher } from './components/ViewSwitcher.js';
import { Toolbar } from './components/Toolbar.js';
import { TableView } from './components/table/TableView.js';
import { KanbanView } from './components/kanban/KanbanView.js';
import { CalendarView } from './components/calendar/CalendarView.js';
import { GalleryView } from './components/gallery/GalleryView.js';
import { ListView } from './components/list/ListView.js';
import { PeekPanel } from './components/record/PeekPanel.js';
import { SchemaEditor } from './components/schema/SchemaEditor.js';
import { Spinner } from './components/shared/Spinner.js';
import { EmptyState } from './components/shared/EmptyState.js';

export function App() {
	const { database, activeView, processedRecords, relationTitles, loading } = useDatabase();
	const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
	const [showSchemaEditor, setShowSchemaEditor] = useState(false);

	if (loading) return <Spinner />;
	if (!database) return <EmptyState title="No database loaded" />;
	if (!activeView) return <EmptyState title="No view available" />;

	const peekRecord = editingRecordId
		? database.records.find((r) => r.id === editingRecordId)
		: null;

	const onOpenRecord = (recordId: string) => setEditingRecordId(recordId);

	function renderView() {
		if (!database || !activeView) return null;

		switch (activeView.type) {
			case 'table':
				return <TableView database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'kanban':
				return <KanbanView database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'calendar':
				return <CalendarView database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'gallery':
				return <GalleryView database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'list':
				return <ListView database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			default:
				return <EmptyState title={`Unknown view type: ${activeView.type}`} />;
		}
	}

	return (
		<ThemeKindProvider>
		<div className="flex flex-col h-screen" style={{ color: 'var(--vscode-foreground)' }}>
			<div className="flex items-center justify-between px-3 py-1">
				<h1 className="text-sm font-semibold truncate">{database.name}</h1>
				<button
					className="text-xs opacity-50 hover:opacity-100"
					onClick={() => setShowSchemaEditor(true)}
					title="Edit schema"
				>
					Schema
				</button>
			</div>

			<ViewSwitcher
				views={database.views}
				activeViewId={activeView.id}
			/>

			<Toolbar view={activeView} schema={database.schema} />

			<div className="flex-1 overflow-hidden flex flex-col">
				{renderView()}
			</div>

			<div className="px-3 py-1 text-[10px] opacity-40 border-t" style={{ borderColor: 'var(--vscode-panel-border)' }}>
				{processedRecords.length} records
			</div>

			{peekRecord && (
				<PeekPanel
					record={peekRecord}
					database={database}
					relationTitles={relationTitles}
					onClose={() => setEditingRecordId(null)}
				/>
			)}

			{showSchemaEditor && (
				<SchemaEditor
					database={database}
					onClose={() => setShowSchemaEditor(false)}
				/>
			)}
		</div>
		</ThemeKindProvider>
	);
}
