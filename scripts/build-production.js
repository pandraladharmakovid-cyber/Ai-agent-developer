'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const outputRoot = path.join(projectRoot, 'dist');

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

function collectTypeScriptFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const sourcePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(sourcePath, files);
    } else if (entry.isFile() && sourcePath.endsWith('.ts')) {
      files.push(sourcePath);
    }
  }

  return files;
}

esbuild.buildSync({
  entryPoints: collectTypeScriptFiles(sourceRoot),
  outdir: outputRoot,
  outbase: sourceRoot,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: false,
  sourcemap: false,
  logLevel: 'silent',
});

fs.copyFileSync(path.join(sourceRoot, 'app.js'), path.join(outputRoot, 'app.js'));
fs.copyFileSync(path.join(sourceRoot, 'index.html'), path.join(outputRoot, 'index.html'));
