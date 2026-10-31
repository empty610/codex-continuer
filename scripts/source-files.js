import { readdirSync } from 'node:fs';
import { join } from 'node:path';
export const sourceRoots = ['server', 'public', 'plugin', 'desktop', 'scripts', 'tests', 'docs', 'third_party', '.github'];
export const sourceFiles = ['AGENTS.md', '.gitattributes', '.gitignore', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'plugin.json', 'mcp.json', 'Install-Plugin.ps1', 'Install-Portable.ps1', 'Uninstall-Plugin.ps1', 'Enable-Autostart.ps1', 'Start-Continuer.ps1', 'Stop-Continuer.ps1', 'Start.cmd', 'Open-Widget.cmd'];
export function publicFiles(root = '.') {
  const files = [...sourceFiles];
  const visit = directory => {
    for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
      const name = directory + '/' + item.name;
      if (/assessment|^\.review/i.test(item.name)) continue;
      if (item.isSymbolicLink()) throw Error('Public source must not contain symlinks: ' + name);
      if (item.isDirectory()) visit(name);
      else if (item.isFile() && !name.endsWith('.exe')) files.push(name);
    }
  };
  sourceRoots.forEach(visit); return files.sort();
}
