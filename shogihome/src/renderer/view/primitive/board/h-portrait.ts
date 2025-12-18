import { Config } from "./config.js";
import { Color, ImmutablePosition, reverseColor } from "tsshogi";
import { Frame, Layout, PlayerName, Turn } from "./layout.js";
import { hPortraitViewParams } from "./params.js";
import { Point, RectSize } from "@/common/assets/geometry.js";

export class HPortraitLayoutBuilder {
  constructor(private config: Config) {}

  get ratio(): number {
    let ratio = this.config.upperSizeLimit.width / hPortraitViewParams.frame.width;
    if (hPortraitViewParams.frame.height * ratio > this.config.upperSizeLimit.height) {
      ratio = this.config.upperSizeLimit.height / hPortraitViewParams.frame.height;
    }
    return ratio;
  }

  get boardBasePoint(): Point {
    return new Point(hPortraitViewParams.board.x, hPortraitViewParams.board.y).multiply(this.ratio);
  }

  get blackHandBasePoint(): Point {
    const params = this.config.flip
      ? hPortraitViewParams.hand.white
      : hPortraitViewParams.hand.black;
    return new Point(params.x, params.y).multiply(this.ratio);
  }

  get whiteHandBasePoint(): Point {
    const params = this.config.flip
      ? hPortraitViewParams.hand.black
      : hPortraitViewParams.hand.white;
    return new Point(params.x, params.y).multiply(this.ratio);
  }

  build(position: ImmutablePosition): Layout {
    const ratio = this.ratio;

    const buildFrameLayout = (): Frame => {
      const height = hPortraitViewParams.frame.height * ratio;
      const width = hPortraitViewParams.frame.width * ratio;
      return {
        style: {
          height: height + "px",
          width: width + "px",
        },
        size: new RectSize(width, height),
      };
    };

    const buildTurnLayout = (): Turn => {
      const color = position.color;
      const displayColor = this.config.flip ? reverseColor(color) : color;
      const borderWidth = 2;
      const params = hPortraitViewParams.turn[displayColor];
      return {
        style: {
          left: params.x * ratio - borderWidth + "px",
          top: params.y * ratio - borderWidth + "px",
          width: hPortraitViewParams.turn.width * ratio - borderWidth + "px",
          height: hPortraitViewParams.turn.height * ratio - borderWidth + "px",
          "font-size": hPortraitViewParams.turn.fontSize * ratio + "px",
          "border-radius": hPortraitViewParams.turn.height * ratio * 0.4 + "px",
          "border-width": borderWidth + "px",
          "border-style": "solid",
        },
      };
    };

    const buildPlayerNameLayout = (color: Color): PlayerName => {
      const displayColor = this.config.flip ? reverseColor(color) : color;
      const params = hPortraitViewParams.playerName[displayColor];
      return {
        style: {
          left: params.x * ratio + "px",
          top: params.y * ratio + "px",
          width: hPortraitViewParams.playerName.width * ratio + "px",
          height: hPortraitViewParams.playerName.height * ratio + "px",
          "font-size": hPortraitViewParams.playerName.fontSize * ratio + "px",
        },
      };
    };

    const buildClockLayout = (color: Color): PlayerName => {
      const displayColor = this.config.flip ? reverseColor(color) : color;
      const params = hPortraitViewParams.clock[displayColor];
      return {
        style: {
          left: params.x * ratio + "px",
          top: params.y * ratio + "px",
          width: hPortraitViewParams.clock.width * ratio + "px",
          height: hPortraitViewParams.clock.height * ratio + "px",
          "font-size": hPortraitViewParams.clock.fontSize * ratio + "px",
        },
      };
    };

    const boardBasePoint = this.boardBasePoint;
    const blackHandBasePoint = this.blackHandBasePoint;
    const whiteHandBasePoint = this.whiteHandBasePoint;

    return {
      ratio,
      frame: buildFrameLayout(),
      boardStyle: {
        left: boardBasePoint.x + "px",
        top: boardBasePoint.y + "px",
      },
      blackHandStyle: {
        left: blackHandBasePoint.x + "px",
        top: blackHandBasePoint.y + "px",
      },
      whiteHandStyle: {
        left: whiteHandBasePoint.x + "px",
        top: whiteHandBasePoint.y + "px",
      },
      turn: this.config.hideClock ? buildTurnLayout() : undefined,
      blackPlayerName: buildPlayerNameLayout(Color.BLACK),
      whitePlayerName: buildPlayerNameLayout(Color.WHITE),
      blackClock: this.config.hideClock ? undefined : buildClockLayout(Color.BLACK),
      whiteClock: this.config.hideClock ? undefined : buildClockLayout(Color.WHITE),
    };
  }
}
