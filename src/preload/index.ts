import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Bridge, Snapshot } from '../shared/types'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args).catch(error => {
  const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  throw new Error(message)
})

const bridge: Bridge = {
  snapshot: () => invoke('snapshot'),
  subscribe: (callback) => {
    const listener = (_: unknown, value: Snapshot) => callback(value)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },
  pickVideos: (batch) => invoke('pick-videos', batch),
  addFiles: (paths) => invoke('add-files', paths),
  filePath: (file) => webUtils.getPathForFile(file),
  removeVideo: (id) => invoke('remove-video', id),
  removeVideos: (ids) => invoke('remove-videos', ids),
  pinVideo: (id, pinned) => invoke('pin-video', id, pinned),
  setCrop: (id, crop, segments) => invoke('set-crop', id, crop, segments),
  saveViewport: value => invoke('save-viewport', value), estimate: ids => invoke('estimate', ids),
  importResults: () => invoke('import-results'), archiveJobs: ids => invoke('archive-jobs', ids), restoreArchives: () => invoke('restore-archives'),
  exportWorkspace: () => invoke('export-workspace'), importWorkspace: () => invoke('import-workspace'), relocateVideo: id => invoke('relocate-video', id),
  saveTemplate: (name, settings) => invoke('save-template', name, settings), removeTemplate: id => invoke('remove-template', id),
  decoderStatus: () => invoke('decoder-status'), updateDecoder: () => invoke('update-decoder'), rollbackDecoder: () => invoke('rollback-decoder'),
  resolveLinks: (text) => invoke('resolve-links', text),
  downloadVideo: (id) => invoke('download-video', id),
  preparePreview:(id,force)=>invoke('prepare-preview',id,force),cancelPreview:id=>invoke('cancel-preview',id),
  trimVideo:(id,ranges,join)=>invoke('trim-video',id,ranges,join),revealPath:file=>invoke('reveal-path',file),
  setCloseAction:value=>invoke('set-close-action',value),
  setExtractRanges:(ids,range)=>invoke('set-extract-ranges',ids,range),
  saveTimeInputMode:mode=>invoke('save-time-input-mode',mode),
  setTrimEnabled:(id,value)=>invoke('set-trim-enabled',id,value),
  planDelete:request=>invoke('plan-delete',request),deleteFiles:(token,ids)=>invoke('delete-files',token,ids),
  createProject: (name) => invoke('create-project', name),
  updateProject: (id, value) => invoke('update-project', id, value),
  removeProject: (id) => invoke('remove-project', id),
  setActiveProject: (id) => invoke('set-active-project', id),
  moveVideos: (ids, projectId) => invoke('move-videos', ids, projectId),
  chooseOutput: () => invoke('choose-output'),
  chooseCookie: () => invoke('choose-cookie'),
  saveSettings: (settings) => invoke('save-settings', settings),
  setOverride: (id, settings) => invoke('set-override', id, settings),
  enqueue: (ids) => invoke('enqueue', ids),
  cancelJob: (id) => invoke('cancel-job', id),
  retryJob: (id) => invoke('retry-job', id),
  pauseQueue: (paused) => invoke('pause-queue', paused),
  results: (id, page, sheetPage) => invoke('results', id, page, sheetPage),
  cancelJobs: ids=>invoke('cancel-jobs',ids),retryJobs:ids=>invoke('retry-jobs',ids),
  stitch: (id, names, settings, options) => invoke('stitch', id, names, settings, options),
  stitchPreview: (id, names, settings, page, notes, offset) => invoke('stitch-preview', id, names, settings, page, notes, offset),
  saveStitchDraft: (id, notes, settings) => invoke('save-stitch-draft', id, notes, settings),
  openPath: (path) => invoke('open-path', path),
  clearFinished: () => invoke('clear-finished')
}
contextBridge.exposeInMainWorld('framepick', bridge)
