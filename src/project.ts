import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from './errors.js';
export function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => {
    const result = path.normalize(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? result.toLowerCase() : result;
  };
  return normalize(a) === normalize(b);
}
export async function readProjectConfig(project: string): Promise<Record<string, any>> {
  const file = path.join(project, 'project.config.json');
  try {
    if ((await stat(file)).size > 1024 * 1024) throw new Error('Config too large');
    const config = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Expected object');
    if (config.compileType && !['game', 'microgame'].includes(config.compileType)) throw new Error('Not a mini game');
    const entry = config.engine_type === 'unity' ? 'ig_kwai.json' : 'game.js';
    if (!(await stat(path.join(project, entry))).isFile()) throw new Error('Entry missing');
    return config;
  } catch {
    throw new ToolError('PROJECT_INVALID', 'Expected a Kuaishou mini-game project.config.json and game.js (ig_kwai.json for native Unity).',
      'Select the exported Kuaishou directory, not the Unity source project or a mini-program.');
  }
}
export async function validateProject(input: string, allowedRoots: string[]): Promise<string> {
  if (!path.isAbsolute(input)) throw new ToolError('PROJECT_INVALID', 'projectPath must be an absolute path.');
  let project: string;
  try {
    project = await realpath(input);
    if (!(await stat(project)).isDirectory()) throw new Error('Not a directory');
  } catch { throw new ToolError('PROJECT_NOT_FOUND', 'The project directory does not exist.'); }
  if (allowedRoots.length) {
    const roots = await Promise.all(allowedRoots.map(root => realpath(root)));
    if (!roots.some(root => {
      const relative = path.relative(root, project);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    })) throw new ToolError('PROJECT_NOT_ALLOWED', 'Project is outside KUAISHOU_ALLOWED_ROOTS (symlinks are resolved).');
  }
  await readProjectConfig(project);
  return project;
}
