import { Player, SearchHandler, SearchInfo } from "./player";
import { ImmutablePosition, Color } from "tsshogi";
import { TimeStates } from "@/common/game/time";
import { LanEngine } from "@/renderer/network/lan_engine";
import { GameResult } from "@/common/game/result";
import { parseUSIPV, USIInfoCommand } from "@/common/game/usi";
import { dispatchUSIInfoUpdate } from "./usi";
import { t } from "@/common/i18n";

function getSessionId(sessionKey: string): string {
  const localStorageKey = `shogihome-lan-session-id-${sessionKey}`;
  let id = localStorage.getItem(localStorageKey);
  if (!id) {
    id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(localStorageKey, id);
  }
  return id;
}

export class LanPlayer implements Player {
  private handler?: SearchHandler;
  private position?: ImmutablePosition;
  private onSearchInfo?: (info: SearchInfo) => void;
  private info?: SearchInfo;
  private infoTimeout?: number;
  private _sessionID: number;
  private engineId: string;
  private engineName: string;
  private currentSfen: string = "";
  private lastGoCommand: string = "";
  private isThinking: boolean = false;
  private stopPromiseResolver: (() => void) | null = null;
  private stopPromiseRejector: ((err: Error) => void) | null = null;
  private stopPromise: Promise<void> | null = null;
  private _multiPV: number = 1;
  private onErrorCallback?: (e: Error) => void;
  private lanEngine: LanEngine;

  constructor(
    sessionKey: string,
    engineId: string,
    engineName: string,
    onSearchInfo?: (info: SearchInfo) => void,
    onError?: (e: Error) => void,
  ) {
    this.engineId = engineId;
    this.engineName = engineName;
    this.onSearchInfo = onSearchInfo;
    this.onErrorCallback = onError;
    this._sessionID = Math.floor(Math.random() * 100000);
    this.lanEngine = new LanEngine(getSessionId(sessionKey));
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
      this.lanEngine
        .connect((message: string) => {
          this.onMessage(message);
        })
        .then(() => {
          this.lanEngine.startEngine(this.engineId);
          if (this._multiPV !== 1) {
            this.lanEngine.setOption("MultiPV", this._multiPV);
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
    // Note: 'isready' and 'usinewgame' are handled automatically by the server.
  }

  async startSearch(
    position: ImmutablePosition,
    usi: string,
    timeStates: TimeStates,
    handler: SearchHandler,
  ): Promise<void> {
    const isNewSfen = this.currentSfen !== usi;
    this.handler = handler;
    this.position = position;
    this.currentSfen = usi;
    if (isNewSfen) {
      this.clearPendingInfo();
    }
    if (this.isThinking) {
      await this.stopAndWait();
    }
    this.lanEngine.sendCommand(usi); // "position ..."

    // ShogiHome keeps the time after adding the increment.
    // However, USI requires the time before adding the increment (btime + binc).
    // So we subtract the increment from the current time.
    const binc = timeStates.black.increment || 0;
    const winc = timeStates.white.increment || 0;
    const byoyomi = timeStates[position.color === Color.BLACK ? "black" : "white"].byoyomi || 0;

    let btime = timeStates.black.timeMs;
    let wtime = timeStates.white.timeMs;
    if (byoyomi === 0) {
      btime -= binc * 1000;
      wtime -= winc * 1000;
    }

    let goCommand = `go btime ${btime} wtime ${wtime}`;
    if (byoyomi > 0) {
      goCommand += ` byoyomi ${byoyomi * 1000}`;
    } else if (binc > 0 || winc > 0) {
      goCommand += ` binc ${binc * 1000} winc ${winc * 1000}`;
    }
    this.lastGoCommand = goCommand;
    this.lanEngine.sendCommand(goCommand);
    this.isThinking = true;
  }

  async startResearch(position: ImmutablePosition, usi: string): Promise<void> {
    const isNewSfen = this.currentSfen !== usi;
    this.position = position;
    this.currentSfen = usi;
    if (isNewSfen) {
      this.clearPendingInfo();
    }
    if (this.isThinking) {
      await this.stopAndWait();
    }
    this.lanEngine.sendCommand(usi);
    this.lastGoCommand = "go infinite";
    this.lanEngine.sendCommand("go infinite");
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
    this.lanEngine.sendCommand("gameover " + result);
  }

  async close(): Promise<void> {
    this.clearPendingInfo();
    try {
      if (this.isThinking) {
        await this.stopAndWait();
      }
    } finally {
      this.lanEngine.stopEngine();
      this.lanEngine.disconnect();
    }
  }

  get multiPV(): number | undefined {
    return this._multiPV;
  }

  async setMultiPV(multiPV: number): Promise<void> {
    this._multiPV = multiPV;
    if (this.lanEngine.isConnected()) {
      this.lanEngine.setOption("MultiPV", multiPV);
    }
  }

  private async stopAndWait(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = new Promise((resolve, reject) => {
      this.stopPromiseResolver = resolve;
      this.stopPromiseRejector = reject;
      this.lanEngine.sendCommand("stop");

      // Fallback timeout in case engine doesn't respond or message is lost
      setTimeout(() => {
        if (this.stopPromiseResolver === resolve) {
          console.error("LanPlayer: stopAndWait timed out, forcing resume.");
          this.isThinking = false;
          if (this.stopPromiseResolver) {
            this.stopPromiseResolver();
          }
          this.stopPromiseResolver = null;
          this.stopPromiseRejector = null;
          this.stopPromise = null;
        }
      }, 5000);
    });

    return this.stopPromise;
  }

  private onMessage(message: string): void {
    // Expected format from server: {"sfen":"...","info":"bestmove ..."}
    try {
      const data = JSON.parse(message);
      if (data.error) {
        const error = new Error(data.error);
        if (this.handler) {
          this.handler.onError(error);
        } else if (this.onErrorCallback) {
          this.onErrorCallback(error);
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
            this.stopPromiseRejector = null;
            this.stopPromise = null;
          }

          if (data.sfen === this.currentSfen) {
            this.flushInfo();
          } else {
            this.clearPendingInfo();
          }

          if (this.handler && this.position && data.sfen === this.currentSfen) {
            const parts = infoStr.split(" ");
            if (parts[1] === "resign") {
              this.handler.onResign();
              return;
            }
            const move = this.position.createMoveByUSI(parts[1]);
            if (move) {
              if (this.info?.pv && this.info.pv.length >= 1 && this.info.pv[0].equals(move)) {
                const info = {
                  ...this.info,
                  pv: this.info.pv.slice(1),
                };
                this.handler.onMove(move, info);
              } else {
                this.handler.onMove(move);
              }
            }
          }
        } else if (infoStr.startsWith("info") && this.position) {
          // Parse info string for research
          const infoCommand = this.parseInfoCommand(infoStr);
          this.updateInfo(infoCommand, data.sfen);
        }
      } else if (data.state) {
        if (
          this.isThinking &&
          (data.state === "uninitialized" || data.state === "stopped" || data.state === "ready")
        ) {
          // If the engine is not thinking (uninitialized, stopped, or ready) but the client expects it to be,
          // it means the session was lost, the process crashed, or the state is inconsistent.
          // We should NOT automatically restart to avoid losing the search tree/hash silently.

          // Exception: If state is 'ready', it might be that we just connected and 'bestmove' is coming in the replay buffer.
          // However, server sends 'state' BEFORE replay buffer.
          // If we treat 'ready' as error immediately, we might kill the session before processing 'bestmove'.
          // So we should ignore 'ready' here and let the replay buffer handle it.
          // If 'bestmove' never comes, we will timeout eventually or user will stop manually.

          if (data.state === "ready") {
            // Do nothing. Wait for buffered messages.
            return;
          }

          this.lanEngine.disconnect();

          const error = new Error(
            data.state === "uninitialized"
              ? t.researchStoppedBecauseLanDisconnected
              : t.engineProcessWasClosedUnexpectedly,
          );
          if (this.handler) {
            this.handler.onError(error);
          } else if (this.onErrorCallback) {
            this.onErrorCallback(error);
          }
          this.isThinking = false;
          if (this.stopPromiseRejector) {
            this.stopPromiseRejector(new Error("Engine stopped"));
            this.stopPromiseResolver = null;
            this.stopPromiseRejector = null;
            this.stopPromise = null;
          }
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
      else if (key === "seldepth") result.seldepth = parseInt(parts[++i]);
      else if (key === "nodes") result.nodes = parseInt(parts[++i]);
      else if (key === "time") result.timeMs = parseInt(parts[++i]);
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

    // Check if the received USI command matches the current command.
    // We must strictly check if the SFEN is provided and matches.
    if (sfen !== this.currentSfen) {
      return;
    }

    // Validate if the PV is applicable to the current position.
    // This prevents processing "chimera packets" where the server attributes a new SFEN to an old engine output.
    if (infoCommand.pv && infoCommand.pv.length > 0) {
      const move = this.position.createMoveByUSI(infoCommand.pv[0]);
      if (!move) {
        return;
      }
    }

    dispatchUSIInfoUpdate(this.sessionID, this.position, this.name, infoCommand);

    if (infoCommand.multipv && infoCommand.multipv !== 1) {
      return;
    }

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

    // Use currentSfen as the USI position command
    const usi = this.currentSfen;

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

    if (this.infoTimeout) {
      return;
    }
    this.infoTimeout = window.setTimeout(() => {
      this.flushInfo();
    }, 500);
  }

  private clearPendingInfo() {
    if (this.infoTimeout) {
      clearTimeout(this.infoTimeout);
      this.infoTimeout = undefined;
    }
    this.info = undefined;
  }

  private flushInfo() {
    if (this.infoTimeout) {
      clearTimeout(this.infoTimeout);
      this.infoTimeout = undefined;
    }
    if (this.info && this.info.usi === this.currentSfen) {
      this.onSearchInfo?.(this.info);
    }
  }
}
