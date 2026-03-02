/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#theme-colors
 * @task: TASK-040
 * @validated: null
 * ---
 *
 * Detects the VS Code theme kind from webview body classes
 * and exposes it via React context.
 */

import { createContext, useContext, useState, useEffect } from 'react';
import type { ThemeKind } from 'sogo-db-core';

function detectThemeKind(): ThemeKind {
	const cl = document.body.classList;
	if (cl.contains('vscode-high-contrast') || cl.contains('vscode-high-contrast-light')) {
		return 'high-contrast';
	}
	if (cl.contains('vscode-light')) return 'light';
	return 'dark';
}

const ThemeKindContext = createContext<ThemeKind>('dark');

export function ThemeKindProvider({ children }: { children: React.ReactNode }) {
	const [theme, setTheme] = useState<ThemeKind>(detectThemeKind);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setTheme(detectThemeKind());
		});
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);

	return <ThemeKindContext.Provider value={theme}>{children}</ThemeKindContext.Provider>;
}

export function useThemeKind(): ThemeKind {
	return useContext(ThemeKindContext);
}
