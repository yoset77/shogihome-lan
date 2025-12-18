import { Player, SearchHandler } from "./player";
import { ImmutablePosition } from "tsshogi";
import { TimeStates } from "@/common/game/time";
import { lanEngine } from "@/renderer/network/lan_engine";
import { GameResult } from "@/common/game/result";

export class LanPlayer implements Player {
  private handler?: SearchHandler;
  private position?: ImmutablePosition;

  get name(): string {
    return "LAN Engine";
  }

  isEngine(): boolean {
    return true;
  }

  async launch(): Promise<void> {
    return new Promise((resolve, reject) => {
      lanEngine
        .connect((message: string) => {
          this.onMessage(message);
        })
        .then(() => {
          lanEngine.startGameEngine();
          resolve();
        })
        .catch(reject);
    });
  }

  async readyNewGame(): Promise<void> {
    lanEngine.sendCommand("isready");
  }

  async startSearch(
    position: ImmutablePosition,
    usi: string,
    timeStates: TimeStates,
    handler: SearchHandler,
  ): Promise<void> {
    this.handler = handler;
    this.position = position;
    lanEngine.sendCommand(usi); // The 'usi' argument already contains "position ..."
    const btime = timeStates.black.timeMs;
    const wtime = timeStates.white.timeMs;
    const byoyomi = timeStates.black.byoyomi;
    let goCommand = `go btime ${btime} wtime ${wtime}`;
    if (byoyomi) {
      goCommand += ` byoyomi ${byoyomi * 1000}`;
    }
    lanEngine.sendCommand(goCommand);
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  async startPonder(
    _position: ImmutablePosition,
    _usi: string,
    _timeStates: TimeStates,
  ): Promise<void> {
    // Ponder is not supported in this implementation.
  }

  async startMateSearch(
    _position: ImmutablePosition,
    _usi: string,
    _maxSeconds: number | undefined,
  ): Promise<void> {
    // Mate search is not supported in this implementation.
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  async stop(): Promise<void> {
    lanEngine.sendCommand("stop");
  }

  async gameover(result: GameResult): Promise<void> {
    lanEngine.sendCommand("gameover " + result);
  }

  async close(): Promise<void> {
    lanEngine.stopEngine();
    lanEngine.disconnect();
  }

  private onMessage(message: string): void {
    if (!this.handler || !this.position) {
      return;
    }
    // Expected format from server: {"sfen":"...","info":"bestmove ..."}
    try {
      const data = JSON.parse(message);
      if (data.error) {
        this.handler.onError(new Error(data.error));
        return;
      }
      if (data.info && data.info.startsWith("bestmove")) {
        const parts = data.info.split(" ");
        if (parts[1] === "resign") {
          this.handler.onResign();
          return;
        }
        const move = this.position.createMoveByUSI(parts[1]);
        if (move) {
          this.handler.onMove(move);
        }
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  }
}
