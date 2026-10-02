import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import os from 'node:os'

export class WorkerFailure extends Error {
  constructor(message: string, public cancelled = false) { super(message) }
}

export class ProcessingWorker {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<string, { resolve(value: any): void; reject(reason: Error): void }>()
  private closed = false
  public onProgress: (id: string, data: any) => void = () => {}
  constructor(executable: string, args: string[], onFailure: (message: string) => void) {
    this.child = spawn(executable, args, {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    if (this.child.pid) {
      try { os.setPriority(this.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch {}
    }
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      try {
        const value = JSON.parse(line)
        if (value.event === 'progress') { this.onProgress(value.id, value.data); return }
        const request = this.pending.get(value.id)
        if (!request) return
        this.pending.delete(value.id)
        if (value.error) request.reject(new WorkerFailure(value.error, value.cancelled))
        else request.resolve(value.result)
      } catch { /* Ignore non-protocol lines; errors are reported on stderr. */ }
    })
    this.child.stderr.on('data', () => {})
    const fail = () => {
      this.closed = true
      for (const request of this.pending.values()) request.reject(new WorkerFailure('处理引擎已停止，请重新打开应用后重试。'))
      this.pending.clear()
      onFailure('处理引擎已停止，请重新打开应用。')
    }
    this.child.on('error', fail)
    this.child.on('exit', fail)
  }
  request(method: string, params: unknown = {}, id: string = randomUUID()): Promise<any> {
    if (this.closed) return Promise.reject(new WorkerFailure('处理引擎不可用。'))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', (error) => {
        if (error) { this.pending.delete(id); reject(error) }
      })
    })
  }
  cancel(id: string) {
    if (!this.closed) this.child.stdin.write(JSON.stringify({ method: 'cancel', target: id }) + '\n')
  }
  close() {
    if (this.closed) return
    if (process.platform === 'win32' && this.child.pid) {
      const killer = spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => this.child.kill())
    } else this.child.kill()
  }
}
