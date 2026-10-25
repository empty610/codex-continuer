import { resolve } from 'node:path';
import { verifyArtifact } from './package-artifact.js';
const result = verifyArtifact(resolve(process.argv[2] || 'dist/marketplace/plugins/codex-continuer'));
console.log(`Verified ${Object.keys(result.files).length} files; build ${result.buildId}`);
