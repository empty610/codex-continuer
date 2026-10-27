import { win32 } from 'node:path';
import { statSync } from 'node:fs';
import { ClientError } from './http-policy.js';

// Check the string before touching the filesystem: UNC/device stat can send SMB
// authentication. Accept drive-qualified Windows paths only, including in demo.
export function localProjectPath(value) {
  if (typeof value !== 'string') throw new ClientError('项目目录必须是本地盘符绝对路径');
  const path = value.trim().replaceAll('/', '\\');
  if (!/^[a-z]:\\(?!\\)/i.test(path) || /[\x00-\x1f]/.test(path) || path.slice(2).includes(':')) throw new ClientError('项目目录必须是本地盘符绝对路径，不支持网络或设备路径');
  return win32.normalize(path);
}
export function checkedProjectPath(value, { demo = false, stat = statSync } = {}) {
  const path = localProjectPath(value);
  if (!demo && !stat(path).isDirectory()) throw new ClientError('项目目录必须是存在的本地目录');
  return path;
}
