import { join } from 'node:path';
import { root, dataDir, launch } from './runtime.js';
launch(join(root, 'node_modules/electron/dist/electron.exe'), [join(root, 'desktop/main.cjs'), '--quit'], 'widget-close', { ELECTRON_RUN_AS_NODE: undefined, CONTINUER_DATA_DIR: dataDir });
