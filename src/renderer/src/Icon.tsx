export default function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const shapes: Record<string, React.ReactNode> = {
    film: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    pin: <><path d="m8 3 8 0-1 6 4 4H5l4-4-1-6ZM12 13v8" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    chevronRight: <path d="m9 5 7 7-7 7" />,
    chevronDown: <path d="m5 9 7 7 7-7" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5Z" /><path d="m2 12 10 5 10-5M2 16l10 5 10-5" /></>,
    link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" /></>,
    queue: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="m2 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" /></>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-7 5 8" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M7 5a8 8 0 0 1 13 7M17 19a8 8 0 0 1-13-7" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 1 1 5 2l-2 1v2M12 17h.01" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" fill="currentColor" /><circle cx="16" cy="12" r="2" fill="currentColor" /><circle cx="10" cy="18" r="2" fill="currentColor" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] || shapes.film}</svg>
}
