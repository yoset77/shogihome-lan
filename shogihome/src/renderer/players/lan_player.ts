import { Player, SearchHandler, SearchInfo } from "./player";
import { ImmutablePosition, Color } from "tsshogi";
import { TimeStates } from "@/common/game/time";
import { lanEngine } from "@/renderer/network/lan_engine";
import { GameResult } from "@/common/game/result";
import { parseUSIPV, USIInfoCommand } from "@/common/game/usi";
import { dispatchUSIInfoUpdate } from "./usi";

export class LanPlayer implements Player {
  private handler?: SearchHandler;
  private position?: ImmutablePosition;
  private onSearchInfo?: (info: SearchInfo) => void;
  private info?: SearchInfo;
  private _sessionID: number;
  private engineId: string;
  private engineName: string;
  private currentSfen: string = "";
  private isThinking: boolean = false;
  private stopPromiseResolver: (() => void) | null = null;

  constructor(engineId: string, engineName: string, onSearchInfo?: (info: SearchInfo) => void) {
    this.engineId = engineId;
    this.engineName = engineName;
    this.onSearchInfo = onSearchInfo;
    this._sessionID = Math.floor(Math.random() * 100000); // Dummy session ID
  }

  get name(): string {
    return this.engineName;
  }

  get sessionID(): number {
    return this._sessionID;
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
          // If the ID is 'game' or 'research', use the legacy commands for compatibility
          if (this.engineId === "game") {
            lanEngine.startGameEngine();
          } else if (this.engineId === "research") {
            lanEngine.startResearchEngine();
          } else {
            lanEngine.startEngine(this.engineId);
          }
          resolve();
        })
        .catch(reject);
    });
  }

  async readyNewGame(): Promise<void> {
    if (this.isThinking) {
      await this.stopAndWait();
    }
    lanEngine.sendCommand("isready");
    // Also send usinewgame? USI protocol says isready -> readyok -> usinewgame -> go
    lanEngine.sendCommand("usinewgame");
  }

  async startSearch(
    position: ImmutablePosition,
    usi: string,
    timeStates: TimeStates,
    handler: SearchHandler,
  ): Promise<void> {
    if (this.isThinking) {
      await this.stopAndWait();
    }
    this.handler = handler;
    this.position = position;
    this.currentSfen = usi;
    lanEngine.sendCommand(usi); // "position ..."
    const btime = timeStates.black.timeMs;
    const wtime = timeStates.white.timeMs;
    const byoyomi = timeStates.black.byoyomi;
    let goCommand = `go btime ${btime} wtime ${wtime}`;
    if (byoyomi) {
      goCommand += ` byoyomi ${byoyomi * 1000}`;
    }
    lanEngine.sendCommand(goCommand);
    this.isThinking = true;
  }

  async startResearch(position: ImmutablePosition, usi: string): Promise<void> {
    if (this.isThinking) {
      await this.stopAndWait();
    }
    this.position = position;
    this.currentSfen = usi;
    lanEngine.sendCommand(usi);
    lanEngine.sendCommand("go infinite");
    this.isThinking = true;
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
    if (this.isThinking) {
      await this.stopAndWait();
    }
  }

  async gameover(result: GameResult): Promise<void> {
    if (this.isThinking) {
      await this.stopAndWait();
    }
    lanEngine.sendCommand("gameover " + result);
  }

  async close(): Promise<void> {
    if (this.isThinking) {
      await this.stopAndWait();
    }
    lanEngine.stopEngine();
    lanEngine.disconnect();
  }

  get multiPV(): number | undefined {
    return 1; // Default or fetch?
  }

  async setMultiPV(multiPV: number): Promise<void> {
    lanEngine.setOption("MultiPV", multiPV);
  }

  private async stopAndWait(): Promise<void> {
    return new Promise((resolve) => {
      this.stopPromiseResolver = resolve;
      lanEngine.sendCommand("stop");
      
      // Fallback timeout in case engine doesn't respond or message is lost
      setTimeout(() => {
        if (this.stopPromiseResolver === resolve) {
            console.warn("LanPlayer: stopAndWait timed out, forcing resume.");
            this.isThinking = false;
            this.stopPromiseResolver = null;
            resolve();
        }
      }, 5000);
    });
  }

  private onMessage(message: string): void {
    // Expected format from server: {"sfen":"...","info":"bestmove ..."}
    try {
      const data = JSON.parse(message);
      if (data.error) {
        if (this.handler) {
          this.handler.onError(new Error(data.error));
        } else {
          console.error("LAN Engine Error:", data.error);
        }
        return;
      }

      if (data.info) {
        const infoStr = data.info as string;
        if (infoStr.startsWith("bestmove")) {
          this.isThinking = false;
          if (this.stopPromiseResolver) {
            this.stopPromiseResolver();
            this.stopPromiseResolver = null;
          }

          if (this.handler && this.position) {
            const parts = infoStr.split(" ");
            if (parts[1] === "resign") {
              this.handler.onResign();
              return;
            }
            const move = this.position.createMoveByUSI(parts[1]);
            if (move) {
              this.handler.onMove(move);
            }
          }
        } else if (infoStr.startsWith("info") && this.position) {
          // Parse info string for research
          const infoCommand = this.parseInfoCommand(infoStr);
          this.updateInfo(infoCommand, data.sfen);
        }
      }
    } catch (e) {
      // Ignore non-JSON messages or parse errors
    }
  }

  private parseInfoCommand(infoStr: string): USIInfoCommand {
    const parts = infoStr.split(" ");
    const result: USIInfoCommand = {};
    for (let i = 1; i < parts.length; i++) {
      const key = parts[i];
      if (key === "depth") result.depth = parseInt(parts[++i]);
      else if (key === "nodes") result.nodes = parseInt(parts[++i]);
      else if (key === "score") {
        const type = parts[++i];
        const value = parseInt(parts[++i]);
        if (type === "cp") result.scoreCP = value;
        else if (type === "mate") result.scoreMate = value;
      } else if (key === "multipv") result.multipv = parseInt(parts[++i]);
      else if (key === "nps") result.nps = parseInt(parts[++i]);
      else if (key === "hashfull") result.hashfullPerMill = parseInt(parts[++i]);
      else if (key === "pv") {
        result.pv = parts.slice(i + 1);
        break; // pv is usually the last part
      }
    }
    return result;
  }

  private updateInfo(infoCommand: USIInfoCommand, sfen?: string) {
    if (!this.position || !this.onSearchInfo) return;

    dispatchUSIInfoUpdate(this.sessionID, this.position, this.name, infoCommand);

    const sign = this.position.color === Color.BLACK ? 1 : -1;
    const pv = infoCommand.pv;

    // Only update if we have meaningful data
    if (
      !infoCommand.depth &&
      !infoCommand.nodes &&
      !infoCommand.scoreCP &&
      !infoCommand.scoreMate &&
      !pv
    ) {
      return;
    }

    // Use sfen from server if available, otherwise use saved currentSfen
    const usi = sfen || this.currentSfen;

    this.info = {
      usi: usi || this.info?.usi || "",
      depth: infoCommand.depth ?? this.info?.depth,
      nodes: infoCommand.nodes ?? this.info?.nodes,
      score:
        (infoCommand.scoreCP !== undefined ? infoCommand.scoreCP * sign : undefined) ??
        this.info?.score,
      mate:
        (infoCommand.scoreMate !== undefined ? infoCommand.scoreMate * sign : undefined) ??
        this.info?.mate,
      pv: (pv && parseUSIPV(this.position, pv)) ?? this.info?.pv,
    };

    this.onSearchInfo(this.info);
  }
}
