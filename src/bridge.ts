import { setTimeout as delay } from 'node:timers/promises';
import { CdpConnection } from './cdp.js';
import { isIdePage, listTargets, selectIdePage, type Target } from './discovery.js';
import { ToolError } from './errors.js';
import { readProjectConfig, samePath } from './project.js';
import { redact } from './redact.js';

interface IdeProject { id: string; path: string; name?: string; appId?: string; engineType?: string }
export class IdeBridge {
  private active = new Set<CdpConnection>();
  private closed = false;
  constructor(readonly endpoint: string) {}

  private async evaluate(target: Target, expression: string, timeout = 20000): Promise<any> {
    if (this.closed) throw new ToolError('CANCELLED', 'Server is closed.');
    const cdp = new CdpConnection();
    this.active.add(cdp);
    try {
      await cdp.connect(target.webSocketDebuggerUrl!);
      if (this.closed) throw new ToolError('CANCELLED', 'Server is closed.');
      const response = await cdp.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
      if (response.exceptionDetails) throw new ToolError('IDE_BRIDGE_FAILED',
        redact(String(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)).slice(0,4000),
        'The IDE preload interface may have changed; supported adapter: 2.0.6. Complete login and use one IDE instance.');
      return response.result?.value;
    } finally { this.active.delete(cdp); cdp.close(); }
  }

  async openProject(project: string, importIfMissing = false): Promise<IdeProject> {
    const target = selectIdePage(await listTargets(this.endpoint), 'project-list');
    const entries: unknown = await this.evaluate(target,
      'window.electronAPIInProjectListPage.getProjectList().then(xs => xs.map(({id,path,name,appId,engineType}) => ({id,path,name,appId,engineType})))');
    if (!Array.isArray(entries)) throw new ToolError('IDE_BRIDGE_INVALID', 'IDE did not return a project list.');
    const matches = entries.filter((p): p is IdeProject => p && typeof p.id === 'string' && typeof p.path === 'string' && samePath(p.path, project));
    if (matches.length > 1) throw new ToolError('PROJECT_AMBIGUOUS', 'Multiple imported projects match this directory.');
    if (!matches.length) {
      if (!importIfMissing) throw new ToolError('PROJECT_NOT_IMPORTED', 'Project is not imported into this IDE.',
        'Import using the IDE first, or set importIfMissing=true. IDE import may rewrite project.config.json.');
      const config = await readProjectConfig(project);
      if (typeof config.appid !== 'string' || !config.appid.trim() || typeof config.projectname !== 'string' || !config.projectname.trim()) {
        throw new ToolError('PROJECT_INVALID', 'Import requires appid and projectname in project.config.json.');
      }
      const form = {isCreate: false, directory: project, name: config.projectname, appId: config.appid, engineType: config.engine_type ?? 'frog'};
      this.checkResult(await this.evaluate(target, `window.electronAPIInProjectListPage.createProject(${JSON.stringify(form)})`));
      return this.openProject(project, false);
    }
    const entry = matches[0]!;
    const alreadyOpen = (await listTargets(this.endpoint)).filter(t => isIdePage(t, 'project') && new URL(t.url).searchParams.get('projectId') === entry.id);
    if (alreadyOpen.length) { await this.projectTarget(entry.id, project); return entry; }
    this.checkResult(await this.evaluate(target, `window.electronAPIInProjectListPage.openProject(${JSON.stringify(entry)})`));
    const deadline = Date.now() + 10000;
    do {
      try { await this.projectTarget(entry.id, project); return entry; }
      catch (error) { if (this.closed || Date.now() >= deadline) throw error; await delay(200); }
    } while (true);
  }

  private async projectTarget(projectId: string, project: string): Promise<Target> {
    const target = selectIdePage(await listTargets(this.endpoint), 'project', projectId);
    // Only return path/id; do not retrieve IDE user credentials or userInfo.
    const info = await this.evaluate(target,
      `window.electronAPIInProjectPage.getProjectInfo(${JSON.stringify(projectId)}).then(x => ({id:x.projectInfo.id,path:x.projectInfo.path}))`);
    if (!info || info.id !== projectId || typeof info.path !== 'string' || !samePath(info.path, project)) {
      throw new ToolError('PROJECT_MISMATCH', 'Project window no longer belongs to the requested directory.');
    }
    return target;
  }

  async generate(projectId: string, project: string, debug = false) {
    const target = await this.projectTarget(projectId, project);
    const method = debug ? 'phoneInspectProject' : 'phonePreviewProject';
    const action = debug ? 'PHONE_INSPECT' : 'PHONE_PREVIEW';
    const result = await this.evaluate(target,
      `window.electronAPIInProjectPage.${method}(${JSON.stringify({id:projectId,projectPath:project,action})})`, 120000);
    this.checkResult(result);
    const scheme: unknown = result.phonePreviewData?.scheme;
    if (typeof scheme !== 'string' || !scheme || scheme.length > 16000) {
      throw new ToolError('PREVIEW_OUTPUT_MISSING', 'IDE returned success without a valid preview scheme.');
    }
    return { scheme, action, packageType: result.phonePreviewData.packageType, taskId: result.phonePreviewData.taskId };
  }

  private checkResult(result: any) {
    if (result?.result !== 'SUCCESS') throw new ToolError('IDE_OPERATION_FAILED',
      redact(`${String(result?.result ?? 'INVALID_RESULT')}: ${String(result?.errorMessage ?? 'IDE operation failed.')}`).slice(0,4000));
  }
  close() { this.closed = true; for (const cdp of this.active) cdp.close(); this.active.clear(); }
}
