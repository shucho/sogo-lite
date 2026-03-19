/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#gallery-view
 * @task: TASK-029
 * @validated: null
 * ---
 */

import { useEffect, useRef } from 'react';
import type { Database, DBView, Field } from 'sogo-db-core';
import { postCommand } from '../../hooks/useVSCodeApi.js';

const CREATE_IMAGE_FIELD = '__create_image_field__';

interface GalleryViewSettingsPanelProps {
	view: DBView;
	database: Database;
	onClose: () => void;
}

function isCoverCandidate(field: Field): boolean {
	return field.type === 'url' || field.type === 'text';
}

export function GalleryViewSettingsPanel({ view, database, onClose }: GalleryViewSettingsPanelProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const candidateFields = database.schema.filter(isCoverCandidate);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [onClose]);

	function ensureImageField(): string {
		const existingNames = new Set(database.schema.map((field) => field.name.toLowerCase()));
		let fieldName = 'Card image';
		let index = 2;
		while (existingNames.has(fieldName.toLowerCase())) {
			fieldName = `Card image ${index++}`;
		}
		const newField: Field = { id: crypto.randomUUID(), name: fieldName, type: 'url' };
		postCommand({ type: 'update-schema', schema: [...database.schema, newField] });
		return newField.id;
	}

	return (
		<div
			ref={panelRef}
			className="absolute right-0 top-full z-50 mt-1 rounded shadow-lg p-3 min-w-[260px]"
			style={{ backgroundColor: 'var(--vscode-dropdown-background)', border: '1px solid var(--vscode-dropdown-border)' }}
		>
			<div className="text-xs font-medium mb-2">Gallery settings</div>
			<label className="block text-xs opacity-70 mb-1">Card image</label>
			<select
				className="w-full rounded px-2 py-1 text-xs"
				style={{ backgroundColor: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)' }}
				value={view.cardCoverField ?? ''}
				onChange={(e) => {
					if (e.target.value === CREATE_IMAGE_FIELD) {
						const fieldId = ensureImageField();
						postCommand({ type: 'update-view', viewId: view.id, changes: { cardCoverField: fieldId } });
						return;
					}
					postCommand({
						type: 'update-view',
						viewId: view.id,
						changes: { cardCoverField: e.target.value || undefined },
					});
				}}
			>
				<option value="">None</option>
				{candidateFields.map((field) => (
					<option key={field.id} value={field.id}>{field.name}</option>
				))}
				<option value={CREATE_IMAGE_FIELD}>+ New image field</option>
			</select>
			<div className="text-[11px] opacity-50 mt-2">
				Select an image field to enable upload and cover previews.
			</div>
		</div>
	);
}

