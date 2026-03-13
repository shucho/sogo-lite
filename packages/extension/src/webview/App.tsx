/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#webview
 * @task: TASK-021
 * @validated: null
 * ---
 */

import { useEffect, useState } from 'react';
import { useDatabase } from './hooks/useDatabase.js';
import type { HostMessage } from './protocol.js';
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
	const { database, activeView, processedRecords, relationTitles, databaseCatalog, syncStatus, loading } = useDatabase();
	const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
	const [showSchemaEditor, setShowSchemaEditor] = useState(false);

	useEffect(() => {
		function handleHostMessage(event: MessageEvent<HostMessage>) {
			if (event.data.type === 'open-record-ui') {
				setEditingRecordId(event.data.recordId);
			}
		}
		window.addEventListener('message', handleHostMessage);
		return () => window.removeEventListener('message', handleHostMessage);
	}, []);

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
				return (
					<TableView
						key={activeView.id}
						database={database}
						view={activeView}
						records={processedRecords}
						relationTitles={relationTitles}
						databaseCatalog={databaseCatalog}
						onOpenRecord={onOpenRecord}
					/>
				);
			case 'kanban':
				return <KanbanView key={activeView.id} database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'calendar':
				return <CalendarView key={activeView.id} database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'gallery':
				return <GalleryView key={activeView.id} database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			case 'list':
				return <ListView key={activeView.id} database={database} view={activeView} records={processedRecords} relationTitles={relationTitles} onOpenRecord={onOpenRecord} />;
			default:
				return <EmptyState title={`Unknown view type: ${activeView.type}`} />;
		}
	}

	return (
		<div className="db-editor-root">
			<div className="db-toolbar">
				<ViewSwitcher views={database.views} activeViewId={activeView.id} />
				<span className="db-toolbar-spacer" />
				<Toolbar
					view={activeView}
					schema={database.schema}
					database={database}
					syncStatus={syncStatus}
					onManageFields={() => setShowSchemaEditor(true)}
				/>
			</div>

			<div className="db-content db-editor-content">
				{renderView()}
			</div>

			{peekRecord && (
				<PeekPanel
					record={peekRecord}
					database={database}
					databaseCatalog={databaseCatalog}
					relationTitles={relationTitles}
					onClose={() => setEditingRecordId(null)}
				/>
			)}

			{showSchemaEditor && (
				<SchemaEditor
					database={database}
					databaseCatalog={databaseCatalog}
					view={activeView}
					onClose={() => setShowSchemaEditor(false)}
				/>
			)}
		</div>
	);
}
