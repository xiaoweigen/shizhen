// Use Electron's official downloader and its bundled version checksums.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const installer = require.resolve('electron/install.js');
const result = spawnSync(process.execPath, [installer], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const electron = require('electron');
if (!fs.existsSync(electron)) throw new Error('Electron executable is missing; run npm ci and npm run setup again.');
console.log('Project Electron runtime ready.');
