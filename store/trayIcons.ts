import type { ThemePalette } from "../theme/palette";

/** The three faces the tray icon can show. */
export type TrayState = "locked" | "unlocked" | "attention";

/**
 * Panels draw a tray icon at 16 to 24 pixels, so the icons are filled shapes
 * rather than thin strokes, and every one of them is inline: a data URI costs
 * no file read at startup and cannot go missing from the bundle.
 */
function svg(body: string): string {
  const document = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body.trim()}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(document)}`;
}

/**
 * The icon for `state`, colored from the app palette. The three shapes differ
 * by silhouette as well as by color, so they stay apart in a panel that draws
 * them in a single color.
 */
export function trayIcon(state: TrayState, palette: ThemePalette): string {
  switch (state) {
    case "locked":
      // A closed shackle and a keyhole: the two cues that read as "locked"
      // even when the panel draws the icon in one color.
      return svg(`
<path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="${palette.muted}" stroke-width="2.6" stroke-linecap="round"/>
<path fill="${palette.muted}" fill-rule="evenodd" d="M5.5 10h13a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-6A2.5 2.5 0 0 1 5.5 10Zm6.5 2.5a2 2 0 0 0-1 3.7V19h2v-2.8a2 2 0 0 0-1-3.7Z"/>
`);
    case "unlocked":
      // The same body without the keyhole, and a shackle that stops short of
      // it: the gap is the whole difference from the locked icon.
      return svg(`
<path d="M7 10V7a5 5 0 0 1 9.9-1" fill="none" stroke="${palette.success}" stroke-width="2.6" stroke-linecap="round"/>
<rect x="3" y="10" width="18" height="11" rx="2.5" fill="${palette.success}"/>
`);
    case "attention":
      return svg(`
<path d="M12 3 22 20H2L12 3Zm-1.2 5.4h2.4v6h-2.4v-6Zm0 7.8h2.4v2h-2.4v-2Z" fill="${palette.warning}" fill-rule="evenodd"/>
`);
  }
}
