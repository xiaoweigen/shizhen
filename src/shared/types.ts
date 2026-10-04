export type VideoInfo = {
  duration: number; width: number; height: number; fps: number; codec: string;
  format: string; size: number; bitrate: number; audioCodec: string; rotation: number;
  hdr: boolean; thumbnail?: string; warning?: string; sar?: number;
}
export type VideoItem = {
  id: string; name: string; source: 'local' | 'online'; path?: string; url?: string;
  platform?: string; remoteId?: string; info?: VideoInfo; status: 'reading' | 'ready' | 'error';
  error?: string; thumbnailUrl?: string; mediaUrl?: string; override?: ExtractSettings;
  projectId?: string; downloadedPath?: string; publicShare?: boolean; pinnedAt?: number; crop?: CropRect | null; cropSegments?: CropSegment[];
  previewPath?: string; previewSource?: string; previewStatus?: 'preparing'|'ready'|'error'; previewProgress?: number; previewError?: string; derivedFrom?: string;
  trimEnabled?:boolean;
  extractRange?:ExtractRange;
  localReady?:boolean;
  downloadStatus?:Job['status']; downloadProgress?:number; downloadError?:string; downloadJobId?:string;
}
export type VideoProject = { id: string; name: string; collapsed: boolean; pinnedAt?: number }
export type CropRect = { x: number; y: number; width: number; height: number }
export type CropSegment = { id: string; start: number; end: number; rect: CropRect | null }
export type ViewportPrefs = { zoomIn: string; zoomOut: string; fit: string; actual: string; close: string; wheel: 'control' | 'alt' | 'shift' | 'none' | 'disabled'; pan: 'space' | 'middle' | 'left'; longPressPan: boolean; longPressMs: number; zoomStep: number }
export const DEFAULT_VIEWPORT: ViewportPrefs = { zoomIn: 'Control+Equal', zoomOut: 'Control+Minus', fit: 'Control+Digit0', actual: 'Control+Digit1', close: 'Escape', wheel: 'control', pan: 'space', longPressPan: true, longPressMs: 350, zoomStep: 1.2 }
export type SpaceEstimate = { frames: number; minBytes: number; maxBytes: number; freeBytes: number | null; sufficient: boolean; folder: string }
export type StoryTemplate = { id: string; name: string; settings: ExtractSettings }
export type ExtractSettings = {
  interval: number; start: number; end: number | null; includeStart: boolean;
  format: 'jpg' | 'png'; quality: number; maxWidth: number | null;
  conflict: 'skip' | 'overwrite' | 'batch'; autoStitch: boolean;
  layout: 'grid' | 'horizontal' | 'vertical'; rows: number; columns: number; perSheet: number;
  thumbWidth: number; padding: number; labels: boolean; background: string;
  notesEnabled: boolean; noteHeight: number; noteFontSize: number;
  markersEnabled: boolean; markerStyle: 'circle'|'number'; markerCorner: 'tl'|'tr'|'bl'|'br'; markerSize: number; markerColor: string; markerBackground: string; markerContinuous: boolean;
  markerPositions: Record<string, {x:number;y:number}>;
  onlineQuality: number; cookiePath: string; keepDownload: boolean;
  crop: CropRect | null; cropSegments: CropSegment[];
  sampling: 'interval' | 'scene'; deduplicate: boolean; similarity: number; sceneThreshold: number;
  hdrMode: 'auto' | 'off' | 'hable' | 'reinhard';
  preserveOrder: boolean; frameOrder: string[]; noteColor: string; noteBackground: string; noteAlign: 'left' | 'center' | 'right'; noteFont: 'yahei' | 'arial'; noteFields: boolean;
}
export type Job = {
  kind?: 'extract' | 'download' | 'trim'; downloadPath?: string;
  trimRanges?: TimeRange[]; trimJoin?: boolean; outputFiles?: string[];
  id: string; videoId: string; name: string; status: 'waiting' | 'running' | 'done' | 'error' | 'cancelled';
  stage: string; progress: number; completed: number; total: number; createdAt: string;
  settings: ExtractSettings; outputRoot: string; missing?: number; archived?: boolean; sourcePath?: string; error?: string; folder?: string;
  manifest?: string; count?: number; sheets?: string[]; elapsed?: number;
}
export type Snapshot = {
  closeAction:'ask'|'tray'|'quit';
  timeInputMode?:TimeInputMode;
  viewport: ViewportPrefs; templates: StoryTemplate[]; projects: VideoProject[]; activeProjectId: string | null; downloadRoot: string;
  videos: VideoItem[]; jobs: Job[]; settings: ExtractSettings; outputRoot: string;
  paused: boolean; health: { ready: boolean; message: string };
}
export type FrameResult = { name: string; path: string; url: string; target: number; actual: number; thumbnailUrl?: string; width?: number; height?: number }
export type TimeRange = { start:number; end:number }
export type ExtractRange = { start:number; end:number|null }
export type TimeInputMode = 'clock'|'milliseconds'
export type DeleteRequest = { videoId?:string; jobId?:string; names?:string[]; sheets?:string[] }
export type DeletePlan = { token:string; files:{id:string;name:string;path:string;size:number;category:string}[] }
export type SheetRecipe = { names: string[]; settings: ExtractSettings; notes: Record<string, string>; offset: number }
export type ResultPage = { frames: FrameResult[]; total: number; missing?: number; page?:number; sheetPage?:number; sheets: { path: string; url: string; thumbnailUrl?: string; recipe: SheetRecipe }[]; notes?: Record<string, string>; stitchDraft?: ExtractSettings }
export type StitchPreview = { order?: string[]; frames: FrameResult[]; total: number; pages: number; page: number; offset: number; columns: number; rows: number; capacity: number; width: number; height: number; imageWidth: number; imageHeight: number; labelHeight: number; noteHeight: number; rowNoteHeights: number[]; rowTops: number[]; padding: number; tooLarge: boolean }
export const STITCH_KEYS = ['layout','rows','columns','perSheet','thumbWidth','padding','labels','background','notesEnabled','noteHeight','noteFontSize','noteColor','noteBackground','noteAlign','noteFont','noteFields','markersEnabled','markerStyle','markerCorner','markerSize','markerColor','markerBackground','markerContinuous'] as const
export type Bridge = {
  snapshot(): Promise<Snapshot>; subscribe(callback: (state: Snapshot) => void): () => void;
  pickVideos(batch: boolean): Promise<void>; addFiles(paths: string[]): Promise<void>;
  filePath(file: File): string; removeVideo(id: string): Promise<void>;
  removeVideos(ids: string[]): Promise<void>; pinVideo(id: string, pinned: boolean): Promise<void>;
  setCrop(id: string, crop: CropRect | null, segments?: CropSegment[]): Promise<void>;
  saveViewport(value: ViewportPrefs): Promise<void>; estimate(ids: string[]): Promise<SpaceEstimate>;
  importResults(): Promise<number>; archiveJobs(ids: string[]): Promise<void>; restoreArchives(): Promise<void>;
  exportWorkspace(): Promise<boolean>; importWorkspace(): Promise<void>; relocateVideo(id: string): Promise<void>;
  saveTemplate(name: string, settings: ExtractSettings): Promise<void>; removeTemplate(id: string): Promise<void>;
  decoderStatus(): Promise<{ version: string; latest?: string; updateAvailable?: boolean; canRollback: boolean }>;
  updateDecoder(): Promise<void>; rollbackDecoder(): Promise<void>;
  resolveLinks(text: string): Promise<{ added: number; ids: string[]; errors: string[]; queued:number; reused:number; cancelled?:boolean }>;
  downloadVideo(id: string): Promise<boolean>;
  preparePreview(id:string, force?:boolean):Promise<{mediaUrl:string}>; cancelPreview(id:string):Promise<void>;
  setCloseAction(value:Snapshot['closeAction']):Promise<void>;
  trimVideo(id:string,ranges:TimeRange[],join:boolean):Promise<boolean>;
  setTrimEnabled(id:string,value:boolean):Promise<void>;
  revealPath(file:string):Promise<void>;
  planDelete(request:DeleteRequest):Promise<DeletePlan>; deleteFiles(token:string,ids:string[]):Promise<{deleted:number;errors:string[];removedJobIds:string[]}>;
  setExtractRanges(ids:string[],range:ExtractRange):Promise<void>;
  saveTimeInputMode(mode:TimeInputMode):Promise<void>;
  createProject(name: string): Promise<string>; updateProject(id: string, value: { name?: string; collapsed?: boolean; pinned?: boolean }): Promise<void>;
  removeProject(id: string): Promise<void>; setActiveProject(id: string | null): Promise<void>; moveVideos(ids: string[], projectId: string | null): Promise<void>;
  chooseOutput(): Promise<string | null>; chooseCookie(): Promise<string | null>;
  saveSettings(settings: ExtractSettings): Promise<void>; setOverride(id: string, settings: ExtractSettings | null): Promise<void>;
  enqueue(ids: string[]): Promise<void>; cancelJob(id: string): Promise<void>; retryJob(id: string): Promise<void>;
  cancelJobs(ids:string[]):Promise<void>; retryJobs(ids:string[]):Promise<{queued:number;skipped:number}>;
  pauseQueue(paused: boolean): Promise<void>; results(id: string, page: number, sheetPage?:number): Promise<ResultPage>;
  stitch(id: string, names: string[], settings: ExtractSettings, options?: { page?: number; offset?: number }): Promise<void>;
  stitchPreview(id: string, names: string[], settings: ExtractSettings, page: number, notes?: Record<string, string>, offset?: number): Promise<StitchPreview>;
  saveStitchDraft(id: string, notes: Record<string, string>, settings: ExtractSettings): Promise<void>;
  openPath(path: string): Promise<void>; clearFinished(): Promise<void>;
}
export const DEFAULT_SETTINGS: ExtractSettings = {
  interval: 1, start: 0, end: null, includeStart: false, format: 'jpg', quality: 92,
  maxWidth: null, conflict: 'skip', autoStitch: false, layout: 'grid', rows: 5, columns: 4,
  perSheet: 20, thumbWidth: 480, padding: 8, labels: true, background: '#182c26',
  notesEnabled: false, noteHeight: 96, noteFontSize: 14,
  markersEnabled:false, markerStyle:'circle', markerCorner:'tl', markerSize:32, markerColor:'#182c26', markerBackground:'#ffffff', markerContinuous:false, markerPositions:{},
  onlineQuality: 1080, cookiePath: '', keepDownload: false, crop: null, cropSegments: [],
  sampling: 'interval', deduplicate: false, similarity: 5, sceneThreshold: 18, hdrMode: 'auto',
  preserveOrder: false, frameOrder: [], noteColor: '#263a33', noteBackground: '#fffdf7', noteAlign: 'left', noteFont: 'yahei', noteFields: false
}
export function migrateSettings(value: Partial<ExtractSettings> = {}): ExtractSettings {
  const merged = { ...DEFAULT_SETTINGS, ...value }
  if (value.rows === undefined) merged.rows = Math.max(1, Math.min(20, Math.ceil(merged.perSheet / merged.columns)))
  if (merged.layout === 'grid') merged.perSheet = merged.rows * merged.columns
  return merged
}
export function videoSettings(video: VideoItem, shared: ExtractSettings): ExtractSettings {
  const base = video.override || shared
  const crop = video.crop !== undefined ? video.crop : base.crop
  const cropSegments = video.cropSegments || base.cropSegments || []
  return { ...base, ...video.extractRange, crop, cropSegments, conflict: (crop || cropSegments.length) && !video.override && base.conflict === 'skip' ? 'batch' : base.conflict }
}
export function expectedCount(duration: number, settings: ExtractSettings): number {
  const end = Math.min(duration, settings.end ?? duration)
  const span = end - settings.start
  if (span <= 0 || settings.interval <= 0) return 0
  if(settings.sampling==='scene')return Math.max(1,Math.ceil(span/settings.interval-1e-8))
  return Math.max(0, Math.ceil(span / settings.interval - 1e-8) - (settings.includeStart ? 0 : 1))
}
