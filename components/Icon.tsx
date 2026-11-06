import {
  Canvas,
  type CanvasRenderingContext2D,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from "nsh";
import { totalScale } from "../store/appStore";

export type IconName =
  | "copy"
  | "eye"
  | "eye-off"
  | "external-link"
  | "refresh-cw"
  | "key"
  | "user"
  | "clock"
  | "lock"
  | "settings"
  | "search"
  | "x"
  | "plus"
  | "minus"
  | "terminal"
  | "credit-card"
  | "file-text"
  | "folder"
  | "zap"
  | "history"
  | "download"
  | "check"
  | "shield"
  | "star"
  | "circle"
  | "upload"
  | "chevron-down"
  | "chevron-right";

type Draw = (cx: CanvasRenderingContext2D) => void;

const line = (cx: CanvasRenderingContext2D, points: number[]) => {
  cx.beginPath();
  cx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    cx.lineTo(points[i], points[i + 1]);
  }
  cx.stroke();
};

const rect = (
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  cx.beginPath();
  cx.roundRect(x, y, w, h, r);
  cx.stroke();
};

const circle = (
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill = false,
) => {
  cx.beginPath();
  cx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    cx.fill();
  } else {
    cx.stroke();
  }
};

// Icons are drawn on a 20x20 grid, then scaled to the requested size.
const glyphs: Record<IconName, Draw> = {
  copy: (c) => {
    rect(c, 7, 7, 10, 10, 2);
    line(c, [13, 4.5, 13, 4, 12, 3, 4, 3, 3, 4, 3, 12, 4, 13, 4.5, 13]);
  },
  eye: (c) => {
    c.beginPath();
    c.moveTo(2.5, 10);
    c.quadraticCurveTo(10, 2.5, 17.5, 10);
    c.quadraticCurveTo(10, 17.5, 2.5, 10);
    c.stroke();
    circle(c, 10, 10, 2.5);
  },
  "eye-off": (c) => {
    c.beginPath();
    c.moveTo(2.5, 10);
    c.quadraticCurveTo(10, 2.5, 17.5, 10);
    c.quadraticCurveTo(10, 17.5, 2.5, 10);
    c.stroke();
    circle(c, 10, 10, 2.5);
    line(c, [3, 3, 17, 17]);
  },
  "external-link": (c) => {
    line(c, [9, 4, 4, 4, 4, 16, 16, 16, 16, 11]);
    line(c, [11.5, 3.5, 16.5, 3.5, 16.5, 8.5]);
    line(c, [16.5, 3.5, 9.5, 10.5]);
  },
  "refresh-cw": (c) => {
    c.beginPath();
    c.arc(10, 10, 5.5, 0.4, Math.PI * 1.55);
    c.stroke();
    line(c, [10, 2.5, 10, 4.5, 8, 4.5]);
    c.beginPath();
    c.arc(10, 10, 5.5, Math.PI + 0.4, Math.PI * 2 + 1.55);
    c.stroke();
    line(c, [10, 17.5, 10, 15.5, 12, 15.5]);
  },
  key: (c) => {
    circle(c, 7, 7, 3.5);
    line(c, [9.5, 9.5, 16.5, 16.5]);
    line(c, [14, 14, 16, 12]);
    line(c, [15.5, 15.5, 17.5, 13.5]);
  },
  user: (c) => {
    circle(c, 10, 6.5, 3.2);
    c.beginPath();
    c.arc(10, 18, 6.5, Math.PI, 0);
    c.stroke();
  },
  clock: (c) => {
    circle(c, 10, 10, 7.5);
    line(c, [10, 5.5, 10, 10, 13.5, 11.5]);
  },
  lock: (c) => {
    rect(c, 4, 9, 12, 8.5, 2);
    line(c, [6.5, 9, 6.5, 6.5]);
    c.beginPath();
    c.arc(10, 6.5, 3.5, Math.PI, 0);
    c.stroke();
  },
  settings: (c) => {
    circle(c, 10, 10, 3);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      line(c, [
        10 + Math.cos(a) * 4.8,
        10 + Math.sin(a) * 4.8,
        10 + Math.cos(a) * 7.2,
        10 + Math.sin(a) * 7.2,
      ]);
    }
  },
  search: (c) => {
    circle(c, 8.5, 8.5, 5);
    line(c, [12.3, 12.3, 16.5, 16.5]);
  },
  x: (c) => {
    line(c, [5.5, 5.5, 14.5, 14.5]);
    line(c, [14.5, 5.5, 5.5, 14.5]);
  },
  plus: (c) => {
    line(c, [10, 4, 10, 16]);
    line(c, [4, 10, 16, 10]);
  },
  minus: (c) => line(c, [4, 10, 16, 10]),
  terminal: (c) => {
    rect(c, 2.5, 3.5, 15, 13, 2.5);
    line(c, [6, 8, 8.5, 10, 6, 12]);
    line(c, [10.5, 13, 14, 13]);
  },
  "credit-card": (c) => {
    rect(c, 2.5, 4.5, 15, 11, 2);
    line(c, [2.5, 8, 17.5, 8]);
    line(c, [5, 12, 8, 12]);
  },
  "file-text": (c) => {
    line(c, [5, 3, 11.5, 3, 15, 6.5, 15, 17, 5, 17, 5, 3]);
    line(c, [11.5, 3, 11.5, 6.5, 15, 6.5]);
    line(c, [7.5, 10, 12.5, 10]);
    line(c, [7.5, 13, 12.5, 13]);
  },
  folder: (c) => {
    line(c, [
      2.5, 6, 2.5, 15, 3.5, 16, 16.5, 16, 17.5, 15, 17.5, 7.5, 16.5, 6.5, 9.5, 6.5, 8, 4.5,
      3.5, 4.5, 2.5, 6,
    ]);
  },
  zap: (c) => {
    line(c, [11, 2.5, 5, 11, 9.5, 11, 8.5, 17.5, 15, 8.5, 10.5, 8.5, 11, 2.5]);
  },
  history: (c) => {
    c.beginPath();
    c.arc(10, 10, 6.5, Math.PI * 0.2, Math.PI * 1.95);
    c.stroke();
    line(c, [10, 3, 10, 5, 8, 5]);
    line(c, [10, 6.5, 10, 10, 13, 10]);
  },
  download: (c) => {
    line(c, [10, 3, 10, 12]);
    line(c, [6.5, 8.5, 10, 12, 13.5, 8.5]);
    line(c, [4, 15, 16, 15]);
  },
  check: (c) => line(c, [4.5, 10.5, 8.5, 14, 15.5, 6]),
  shield: (c) => {
    c.beginPath();
    c.moveTo(10, 3);
    c.lineTo(16, 5);
    c.quadraticCurveTo(16, 12, 10, 17);
    c.quadraticCurveTo(4, 12, 4, 5);
    c.closePath();
    c.stroke();
  },
  star: (c) => {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 3.2 : 7;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i) {
        c.lineTo(10 + Math.cos(a) * r, 10.5 + Math.sin(a) * r);
      } else {
        c.moveTo(10 + Math.cos(a) * r, 10.5 + Math.sin(a) * r);
      }
    }
    c.closePath();
    c.stroke();
  },
  circle: (c) => circle(c, 10, 10, 7),
  upload: (c) => {
    line(c, [10, 13, 10, 4]);
    line(c, [6.5, 7.5, 10, 4, 13.5, 7.5]);
    line(c, [4, 15, 16, 15]);
  },
  "chevron-down": (c) => line(c, [5, 7.5, 10, 12.5, 15, 7.5]),
  "chevron-right": (c) => line(c, [7.5, 5, 12.5, 10, 7.5, 15]),
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A razor-sharp Lucide icon drawn natively with the NSH 2D canvas. */
export function Icon(props: IconProps) {
  // `size` is the 100% value; icons follow the total factor so they stay in
  // step with text when the system or the app enlarges it.
  const size = Math.round((props.size ?? 14) * totalScale());
  const drawFn = glyphs[props.name];
  return (
    <Canvas
      testID={props.testID}
      style={{
        width: size,
        height: size,
        pointerEvents: "none",
        ...props.style,
      }}
      draw={(cx, { width }) => {
        if (!drawFn) {
          return;
        }
        cx.scale(width / 20, width / 20);
        cx.strokeStyle = props.color ?? "#ffffff";
        cx.fillStyle = props.color ?? "#ffffff";
        cx.lineWidth = props.strokeWidth ?? 1.5;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        drawFn(cx);
      }}
    />
  );
}
