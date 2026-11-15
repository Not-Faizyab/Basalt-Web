#!/usr/bin/env node
/* Bundle the renderer (src/app.js → dist/bundle.js) with esbuild. */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });

esbuild
  .build({
    entryPoints: [path.join(root, 'src/app.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(root, 'dist/bundle.js'),
    sourcemap: false,
    minify: false,
    logLevel: 'info',
    loader: { '.cjs': 'js' },
  })
  .then(() => console.log('bundle written to dist/bundle.js'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
