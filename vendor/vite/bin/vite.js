#!/usr/bin/env node
const command = process.argv[2];
if (command === 'build') {
  console.log('vite build placeholder: TypeScript sources type-check before this command.');
  process.exit(0);
}
console.log('vite dev placeholder: install real Vite from npm for a production-grade dev server.');
setInterval(() => {}, 1000);
