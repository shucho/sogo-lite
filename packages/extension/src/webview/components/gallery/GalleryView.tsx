/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#gallery-view
 * @task: TASK-029
 * @validated: null
 * ---
 */

import type { Database, DBRecord, DBView, Field } from 'sogo-db-core';
import { getRecordTitle, getFieldDisplayValue, getVisibleFields, getStatusColor } from 'sogo-db-core';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { EmptyState } from '../shared/EmptyState.js';

interface GalleryViewProps {
	database: Database;
	view: DBView;
	records: DBRecord[];
	relationTitles?: Record<string, string>;
	onOpenRecord: (recordId: string) => void;
}

function isCoverCandidate(field: Field): boolean {
	return field.type === 'url' || field.type === 'text';
}

function hasImageLikeName(field: Field): boolean {
	return /image|cover|thumbnail|photo|picture|avatar/i.test(field.name);
}

function inferCoverField(view: DBView, database: Database): Field | undefined {
	if (view.cardCoverField) {
		const configured = database.schema.find((field) => field.id === view.cardCoverField);
		if (configured && isCoverCandidate(configured)) return configured;
	}
	const named = database.schema.find((field) => isCoverCandidate(field) && hasImageLikeName(field));
	if (named) return named;
	return database.schema.find((field) => field.type === 'url');
}

function isLikelyImage(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (/^data:image\//i.test(trimmed)) return true;
	return /(?:^https?:\/\/|^\/|^\.\/|^\.\.\/).+\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i.test(trimmed);
}

async function pickImageAsDataUrl(targetDocument: Document): Promise<string | undefined> {
	return new Promise((resolve) => {
		const input = targetDocument.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.style.display = 'none';
		const cleanup = () => input.remove();
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) {
				cleanup();
				resolve(undefined);
				return;
			}
			const reader = new FileReader();
			reader.addEventListener('load', () => {
				cleanup();
				resolve(typeof reader.result === 'string' ? reader.result : undefined);
			});
			reader.addEventListener('error', () => {
				cleanup();
				resolve(undefined);
			});
			reader.readAsDataURL(file);
		}, { once: true });
		(targetDocument.body ?? targetDocument.documentElement).appendChild(input);
		input.click();
	});
}

export function GalleryView({ database, view, records, onOpenRecord }: GalleryViewProps) {
	if (records.length === 0) {
		return (
			<EmptyState
				title="No records"
				description="Create a record to get started."
				action={{ label: '+ New Record', onClick: () => postCommand({ type: 'create-record' }) }}
			/>
		);
	}

	const coverField = inferCoverField(view, database);
	const cardFields = view.cardFields
		? database.schema.filter((field) => view.cardFields!.includes(field.id))
		: getVisibleFields(database.schema, view)
			.filter((field) => field.id !== coverField?.id)
			.slice(1, 4);

	return (
		<div className="grid gap-3 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
			{records.map((record) => {
				const title = getRecordTitle(record, database.schema);
				const rawCoverValue = coverField ? record[coverField.id] : undefined;
				const coverImage = isLikelyImage(rawCoverValue) ? rawCoverValue : undefined;
				const statusField = database.schema.find((field) => field.type === 'status');
				const statusValue = statusField ? String(record[statusField.id] ?? '') : '';
				return (
					<div
						key={record.id}
						className="rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
						style={{
							backgroundColor: 'var(--vscode-editor-background)',
							border: '1px solid var(--vscode-panel-border)',
						}}
						onClick={() => onOpenRecord(record.id)}
					>
						<div
							className="relative h-[110px] flex items-center justify-center group/cover"
							style={{
								backgroundColor: coverImage
									? 'var(--vscode-editorWidget-background)'
									: statusValue
										? getStatusColor(statusValue)
										: 'var(--vscode-editorWidget-background)',
							}}
						>
							{coverImage ? (
								<img src={coverImage} alt="" className="w-full h-full object-cover" />
							) : (
								<span className="text-2xl opacity-70">📄</span>
							)}
							{coverField ? (
								<button
									className="absolute right-2 bottom-2 text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover/cover:opacity-100"
									style={{
										backgroundColor: 'var(--vscode-editor-background)',
										border: '1px solid var(--vscode-panel-border)',
									}}
									onClick={async (e) => {
										e.stopPropagation();
										const dataUrl = await pickImageAsDataUrl(e.currentTarget.ownerDocument);
										if (!dataUrl) return;
										postCommand({
											type: 'update-record',
											recordId: record.id,
											fieldId: coverField.id,
											value: dataUrl,
										});
									}}
								>
									{coverImage ? 'Replace image' : 'Upload image'}
								</button>
							) : (
								<span className="absolute right-2 bottom-2 text-[10px] opacity-60">
									Set card image field in View
								</span>
							)}
						</div>
						<div className="p-3">
							<div className="font-medium text-sm mb-2 truncate">{title}</div>
							{cardFields.map((field) => {
								const display = getFieldDisplayValue(record, field.id, database.schema, database);
								if (!display) return null;
								return (
									<div key={field.id} className="flex items-baseline gap-1 text-xs mb-0.5">
										<span className="opacity-40 flex-shrink-0">{field.name}:</span>
										<span className="truncate">{display}</span>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
