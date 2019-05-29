const vscode = require('vscode');
const os = require('os')
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

let terminating = false;
let process = null;
let outBuffer = "";

const lockFilePath = path.join(os.tmpdir(), 'vscode-auto-dark-mode-lock');

function spawnProcess(context) {
	try {
		const options = {
			stdio: [
				null,
				'pipe',
				'pipe',
			]
		}
		
		// (Preferred) Executable that efficiently waits for a change
		const waitRegistryCommand = context.asAbsolutePath('wait-registry.exe');
		// (Alternative) Batch file that inefficiently polls for a change
		const queryDarkBatch = context.asAbsolutePath('query-dark.cmd');
		
		if (fs.existsSync(waitRegistryCommand)) {
			process = child_process.spawn(waitRegistryCommand, ['HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'AppsUseLightTheme', '*'], options);
		} else if (fs.existsSync(queryDarkBatch)) {
			process = child_process.spawn('cmd.exe', ['/c', queryDarkBatch], options);
		} else {
			console.error(`Dark mode: External watch programs not found: ${waitRegistryCommand} / ${queryDarkBatch}`);
			return false;
		}

		process.stdout.on('data', (data) => {
			outBuffer += data;
			let idx;
			while ((idx = outBuffer.indexOf('\n')) >= 0) {
				const line = outBuffer.substr(0, idx).trim();
				outBuffer = outBuffer.substr(idx + 1);
				const value = parseInt(line);
				if (value !== 0 || line === "0") {
					matchDarkMode(value == 0);
				} else {
					console.log(`Dark mode: unexpected stdout: ${data}`);
				}
			}
		});
		process.stderr.on('data', (data) => {
			console.error(`Dark mode: stderr: ${data}`);
		});
		process.on('close', (code) => {
			if (!terminating) {
				console.error(`Dark mode: unexpected exit: ${code}`);
				vscode.window.showErrorMessage(`Dark mode: unexpected process exit: ${code}`);
			}
		});
		return true;
	} catch (e) {
		console.error(e);
		return false;
	}
}

async function killProcess() {
	if (process !== null) {
		terminating = true;
		//process.kill('SIGHUP');
		//process.kill('SIGINT');
		//process.kill('SIGTERM');
		process.kill('SIGKILL');
		process = null;
	}
}

function isDarkTheme() {
	const currentTheme = vscode.workspace.getConfiguration('workbench').get('colorTheme');
	const darkTheme = vscode.workspace.getConfiguration('autoDarkMode').get(`darkTheme`);
	return currentTheme === darkTheme;
}

async function setTheme(isDark) {
	const currentTheme = vscode.workspace.getConfiguration('workbench').get('colorTheme');
	const themeConfiguration = vscode.workspace.getConfiguration('autoDarkMode');
	const newTheme = themeConfiguration.get(isDark ? 'darkTheme' : 'lightTheme');
	if (newTheme !== currentTheme) {
		// Use a lock-file to make sure we only do this in one instance of VS Code
		let lockFile = null;
		try {
			lockFile = fs.openSync(lockFilePath, 'wx+');
			vscode.workspace.getConfiguration('workbench').update('colorTheme', newTheme, vscode.ConfigurationTarget.Global)
			// Delay a little while in the lock so other instances will lose the race
			await new Promise((resolve) => setTimeout(resolve, 5000));
			return isDark;
		} catch(e) {
			return undefined;
		} finally {
			if (lockFile != null) { await fs.close(lockFile); }
			if (fs.existsSync(lockFilePath)) {
				fs.unlinkSync(lockFilePath);
			}
		}
	}
	return null;
}

async function matchDarkMode(dark) {
	try {
		const result = await setTheme(dark);
		if (result === undefined) {
			vscode.window.showInformationMessage(`Switching theme to ${dark ? 'dark' : 'light'} to match Windows.`);
		} else if (result !== null) {
			vscode.window.showInformationMessage(`Switched theme to ${dark ? 'dark' : 'light'} to match Windows.`);
		}
	} catch(e) {
		console.error(e);
		vscode.window.showErrorMessage(`Problem while trying to matching theme to ${dark ? 'dark' : 'light'}`);
	}
}

async function toggleTheme() {
	try {
		const dark = !isDarkTheme();
		if (await setTheme(dark) != null) {
			vscode.window.showInformationMessage(`Toggled theme to ${dark ? 'dark' : 'light'}.`);
		} else {
			vscode.window.showErrorMessage(`Theme switching already in progress`);
		}
	} catch(e) {
		console.error(e);
		vscode.window.showErrorMessage(`Error toggling theme`);
	}
}


function activate(context) {
	//console.log('"auto-dark-mode-windows" activated');
	let disposable = vscode.commands.registerCommand('auto-dark-mode-windows.toggle', toggleTheme);
	context.subscriptions.push(disposable);

	// Clean any stale lock file
	try {
		if (fs.existsSync(lockFilePath)) {
			fs.unlinkSync(lockFilePath);
		}
	} catch(e) { ; }

	context.subscriptions.push({ dispose: killProcess() });
	if (!spawnProcess(context)) {
		vscode.window.showErrorMessage(`Error spawning dark mode monitoring process`);
	}
}

async function deactivate() {
	//console.log('"auto-dark-mode-windows" deactivating');
	await killProcess();
}

module.exports = {
	activate,
	deactivate
}
