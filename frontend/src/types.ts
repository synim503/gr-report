export type ElType = 'text' | 'chart' | 'image'

export interface ChartSpec {
  dashboardUid: string
  panelId: number
  title?: string
  from?: string
  to?: string
  theme?: 'light' | 'dark'
  vars?: Record<string, string>
}

/** Geometry is in points (1/72 in), same as the generated .docx. */
export interface El {
  id: string
  type: ElType
  x: number
  y: number
  w: number
  h: number
  z: number
  html?: string
  lineHeight?: number
  chart?: ChartSpec
  dataUrl?: string
  /** Charts inserted as one block share a group id and move / get parameterised together. */
  group?: { id: string; presetId?: string; name?: string }
}

export interface Page { elements: El[] }

export interface Tpl {
  id?: string
  name: string
  pageWidth: number
  pageHeight: number
  timeRange: { from: string; to: string }
  /** Report variables: {{name}} in texts and chart variable values. */
  variables: Record<string, string>
  pages: Page[]
  updatedAt?: string
}

export const A4 = { w: 595.28, h: 841.89 }
export const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4: A4,
  A3: { w: 841.89, h: 1190.55 },
  A5: { w: 419.53, h: 595.28 },
  Letter: { w: 612, h: 792 },
}

export interface BlockVar { name: string; label?: string; defaultValue: string; options?: string[] }
export interface BlockChart { panelId: number; title?: string; x: number; y: number; w: number; h: number }
export interface Block {
  id?: string
  name: string
  dashboardUid: string
  dashboardTitle?: string
  width: number
  height: number
  variables: BlockVar[]
  charts: BlockChart[]
}
export interface DashboardSummary { uid: string; title: string; folder?: string; tags: string[] }
export interface PanelInfo { id: number; title: string; type: string; gridX: number; gridY: number; gridW: number; gridH: number }
export interface DashboardInfo { uid: string; title: string; slug: string; panels: PanelInfo[]; variables: DashVar[] }
export interface DashVar { name: string; label: string; type: string; defaultValue: string; options: string[] }
export interface SettingsView { grafanaUrl: string; tokenSet: boolean; tokenHint: string; orgId: number; imageScale: number; parallelism: number }
export type JobState = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'
export interface JobView { id: string; name: string; state: JobState; done: number; total: number; startedAt: number; finishedAt?: number; error?: string; warnings: string[]; sizeBytes?: number }
