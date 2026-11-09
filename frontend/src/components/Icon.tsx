const P: Record<string, string[]> = {
  type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M9 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z', 'm21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'],
  chart: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'],
  layers: ['M12 2 2 7l10 5 10-5-10-5Z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-15-6.7L3 13'],
  redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 15-6.7L21 13'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  folder: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  filePlus: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M12 18v-6', 'M9 15h6'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 2v2', 'M12 20v2', 'm4.9 4.9 1.4 1.4', 'm17.7 17.7 1.4 1.4', 'M2 12h2', 'M20 12h2', 'm4.9 19.1 1.4-1.4', 'm17.7 6.3 1.4-1.4'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  eyeOff: ['M9.9 4.2A10 10 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-1.7 2.7', 'M6.6 6.6A13 13 0 0 0 2 12s3 7 10 7a10 10 0 0 0 5.4-1.6', 'm2 2 20 20'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  copy: ['M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  chevR: ['m9 18 6-6-6-6'], chevD: ['m6 9 6 6 6-6'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01'],
  plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'],
  key: ['M7.5 20a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z', 'm21 2-9.6 9.6', 'm15.5 7.5 3 3L22 7l-3-3'],
  alignLeft: ['M4 2v20', 'M8 6h12v4H8z', 'M8 14h7v4H8z'],
  alignHCenter: ['M12 2v20', 'M5 6h14v4H5z', 'M8 14h8v4H8z'],
  alignRight: ['M20 2v20', 'M4 6h12v4H4z', 'M9 14h7v4H9z'],
  alignTop: ['M2 4h20', 'M6 8h4v12H6z', 'M14 8h4v7h-4z'],
  alignVMiddle: ['M2 12h20', 'M6 5h4v14H6z', 'M14 8h4v8h-4z'],
  alignBottom: ['M2 20h20', 'M6 4h4v12H6z', 'M14 9h4v7h-4z'],
  distH: ['M3 3v18', 'M21 3v18', 'M9 8h6v8H9z'],
  distV: ['M3 3h18', 'M3 21h18', 'M8 9h8v6H8z'],
  front: ['M8 8h13v13H8z', 'M3 16V3h13'],
  back: ['M3 3h13v13H3z', 'M8 21h13V8'],
  grid: ['M3 3h18v18H3z', 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  ul: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  ol: ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 10h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
  quote: ['M3 21c3 0 7-1 7-8V5c0-1.2-.8-2-2-2H4c-1.2 0-2 .8-2 2v4c0 1.2.8 2 2 2h4', 'M15 21c3 0 7-1 7-8V5c0-1.2-.8-2-2-2h-4c-1.2 0-2 .8-2 2v4c0 1.2.8 2 2 2h4'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  aL: ['M21 6H3', 'M15 12H3', 'M17 18H3'], aC: ['M21 6H3', 'M17 12H7', 'M19 18H5'], aR: ['M21 6H3', 'M21 12H9', 'M21 18H7'], aJ: ['M21 6H3', 'M21 12H3', 'M21 18H3'],
  eraser: ['m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21', 'M22 21H7'],
  braces: ['M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1', 'M16 21h1a2 2 0 0 0 2-2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'],
  sparkles: ['m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z'],
  loader: ['M21 12a9 9 0 1 1-6.2-8.6'],
}

export type IconName = keyof typeof P

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name].map((d, i) => <path key={i} d={d} />)}</svg>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f59e0b" /><stop offset="1" stopColor="#ef4444" /></linearGradient></defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M8 22V10m5 12V14m5 8V8m5 14v-6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}
