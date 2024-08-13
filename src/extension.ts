import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new RulerUpdateProvider());
}

export function deactivate() {
	const config = vscode.workspace.getConfiguration('editor');
	const rulers = config.get<Ruler[]>('rulers') || [];
	if (rulers.length !== 0) {
		for (let index = 0; index < rulers.length; ++index) {
			const ruler = rulers[index];
			if (ruler.comment !== 'clang-format')
				continue;

			rulers.splice(index, 1);
			config.update('rulers', rulers, vscode.ConfigurationTarget.Workspace);
			break;
		}
	}
}

interface Ruler {
	color?: string;
	column?: number;

	// Custom field to mark clang-format ruler
	comment?: string;
};

interface ClangFormat {
	BasedOnStyle?: string;
	ColumnLimit?: number;
};

class RulerUpdateProvider implements vscode.Disposable {
	private workspace?: vscode.WorkspaceFolder;
	private onEditorChange: vscode.Disposable;
	private onConfigChange: vscode.Disposable;
	private watchClangFormat?: vscode.FileSystemWatcher;
	private onClangFormatChange?: vscode.Disposable;
	private onClangFormatDelete?: vscode.Disposable;
	private onClangFormatCreate?: vscode.Disposable;

	constructor() {
		this.onEditorChange = vscode.window.onDidChangeActiveTextEditor(this.didEditorChanged, this);
		this.onConfigChange = vscode.workspace.onDidChangeConfiguration(this.didChangeConfig, this);
		this.didEditorChanged(vscode.window.activeTextEditor);
	}

	public dispose(): void {
		this.onEditorChange.dispose();
		this.onConfigChange.dispose();
		this.watchClangFormat?.dispose();
		this.onClangFormatChange?.dispose();
		this.onClangFormatDelete?.dispose();
		this.onClangFormatCreate?.dispose();
	}

	private async didEditorChanged(editor: vscode.TextEditor | undefined) {
		const uri = editor?.document.uri;
		if (uri === undefined) return;

		const workspace = vscode.workspace.getWorkspaceFolder(uri);
		if (workspace === this.workspace) return;

		this.workspace = workspace;
		if (workspace === undefined) return;

		this.onClangFormatChange?.dispose();
		this.onClangFormatDelete?.dispose();
		this.onClangFormatCreate?.dispose();
		this.watchClangFormat?.dispose();

		this.watchClangFormat = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspace, '.clang-format'));
		this.onClangFormatChange = this.watchClangFormat.onDidChange(async (uri) => { this.updateRuler() }, this);
		this.onClangFormatDelete = this.watchClangFormat.onDidDelete(async (uri) => { this.updateRuler() }, this);
		this.onClangFormatCreate = this.watchClangFormat.onDidCreate(async (uri) => { this.updateRuler() }, this);

		this.updateRuler();
	}

	private async didChangeConfig(event: vscode.ConfigurationChangeEvent) {
		if (!event.affectsConfiguration('editor.rulers') && !event.affectsConfiguration('vscode-clang-format-ruler-decor')) return;

		this.updateRuler();
	}

	private async updateRuler() {
		if (this.workspace === undefined) return;

		const clangFormatPath = path.join(this.workspace.uri.fsPath, '.clang-format');
		const config = vscode.workspace.getConfiguration('editor');
		const rulers = config.get<Ruler[]>('rulers') || [];

		if (!fs.existsSync(clangFormatPath)) {
			if (rulers.length !== 0) {
				for (let index = 0; index < rulers.length; ++index) {
					const ruler = rulers[index];
					if (ruler.comment !== 'clang-format')
						continue;

					rulers.splice(index, 1);
					config.update('rulers', rulers, vscode.ConfigurationTarget.Workspace);
					break;
				}
			}
			return;
		}

		const clangFormat = this.loadClangFormat(clangFormatPath);
		const columnLimit = this.getColumnLimit(clangFormat);
		const color = vscode.workspace.getConfiguration('vscode-clang-format-ruler-decor').get<string>('color');

		if (rulers.length !== 0) {
			for (let ruler of rulers) {
				if (ruler.comment !== 'clang-format')
					continue;

				if (ruler.column === columnLimit && ruler.color === color)
					return;

				ruler.column = columnLimit;
				ruler.color = color?.length !== 0 ? color : undefined
				config.update('rulers', rulers, vscode.ConfigurationTarget.Workspace);
				return;
			}
		}

		const ruler: Ruler = {
			column: columnLimit,
			comment: 'clang-format',
			color: color?.length !== 0 ? color : undefined
		};
		rulers.push(ruler);
		config.update('rulers', rulers, vscode.ConfigurationTarget.Workspace);
	}

	private loadClangFormat(path: string): ClangFormat {
		let result = {} as ClangFormat;
		const clangFormatContent = fs.readFileSync(path, { encoding: 'utf8' }).split('\n');
		for (const line of clangFormatContent) {
			if (line.trim().startsWith('BasedOnStyle:')) {
				result.BasedOnStyle = line.slice('BasedOnStyle:'.length).trim();
				continue;
			}
			if (line.trim().startsWith('ColumnLimit:')) {
				const ColumnLimit = line.slice('ColumnLimit:'.length).trim();
				result.ColumnLimit = parseInt(ColumnLimit);
				continue;
			}
		}
		return result;
	}

	private getColumnLimit(clangFormat: ClangFormat): number {
		if (clangFormat.ColumnLimit !== undefined)
			return clangFormat.ColumnLimit;

		switch (clangFormat.BasedOnStyle) {
			case 'Google':
				return 100;
			case 'Microsoft':
				return 120;
			default:
				return 80;
		};
	}
};