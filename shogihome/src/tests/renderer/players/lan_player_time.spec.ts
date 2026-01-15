import { LanPlayer } from "@/renderer/players/lan_player";
import { LanEngine } from "@/renderer/network/lan_engine";
import { Record } from "tsshogi";
import { TimeStates } from "@/common/game/time";
import { SearchHandler } from "@/renderer/players/player";
import { Mock } from "vitest";

vi.mock("@/renderer/network/lan_engine");
vi.mock("@/renderer/players/usi.js");

describe("LanPlayer Time Control", () => {
  let player: LanPlayer;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let messageHandler: (message: string) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (LanEngine.prototype.connect as Mock).mockResolvedValue(undefined);
    (LanEngine.prototype.startEngine as Mock).mockResolvedValue(undefined);
    (LanEngine.prototype.sendCommand as Mock).mockResolvedValue(undefined);

    player = new LanPlayer("test-session", "test-engine", "Test Engine");

    (LanEngine.prototype.connect as Mock).mockImplementation(function (
      this: LanEngine,
      handler?: (message: string) => void,
    ) {
      if (handler) {
        messageHandler = handler;
      }
      return Promise.resolve();
    });

    await player.launch();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const dummyHandler: SearchHandler = {
    onMove: vi.fn(),
    onResign: vi.fn(),
    onWin: vi.fn(),
    onError: vi.fn(),
  };

  it("should send correct go command for Fischer rule (Black)", async () => {
    const usi = "position startpos";
    const record = Record.newByUSI(usi) as Record;
    // Black turn

    const timeStates: TimeStates = {
      black: { timeMs: 60000, byoyomi: 0, increment: 5 }, // 5s increment
      white: { timeMs: 60000, byoyomi: 0, increment: 5 },
    };

    await player.startSearch(record.position, usi, timeStates, dummyHandler);

    // Expect btime/wtime to be subtracted by increment * 1000
    // 60000 - 5000 = 55000
    const expectedGo = "go btime 55000 wtime 55000 binc 5000 winc 5000";
    expect(LanEngine.prototype.sendCommand).toHaveBeenCalledWith(expectedGo);
  });

  it("should send correct go command for Byoyomi rule (Black)", async () => {
    const usi = "position startpos";
    const record = Record.newByUSI(usi) as Record;
    // Black turn

    const timeStates: TimeStates = {
      black: { timeMs: 60000, byoyomi: 10, increment: 0 }, // 10s byoyomi
      white: { timeMs: 60000, byoyomi: 10, increment: 0 },
    };

    await player.startSearch(record.position, usi, timeStates, dummyHandler);

    // Expect NO subtraction for byoyomi
    const expectedGo = "go btime 60000 wtime 60000 byoyomi 10000";
    expect(LanEngine.prototype.sendCommand).toHaveBeenCalledWith(expectedGo);
  });

  it("should send correct go command for Fischer rule (White)", async () => {
    const usi = "position startpos moves 7g7f";
    const record = Record.newByUSI(usi) as Record;
    // White turn

    const timeStates: TimeStates = {
      black: { timeMs: 55000, byoyomi: 0, increment: 5 },
      white: { timeMs: 60000, byoyomi: 0, increment: 5 }, // 5s increment
    };

    await player.startSearch(record.position, usi, timeStates, dummyHandler);

    // Expect btime/wtime to be subtracted by increment * 1000
    // Black: 55000 - 5000 = 50000
    // White: 60000 - 5000 = 55000
    const expectedGo = "go btime 50000 wtime 55000 binc 5000 winc 5000";
    expect(LanEngine.prototype.sendCommand).toHaveBeenCalledWith(expectedGo);
  });

  it("should prioritize Byoyomi over Increment if Byoyomi > 0", async () => {
    const usi = "position startpos";
    const record = Record.newByUSI(usi) as Record;

    // Invalid config technically, but strictly following logic:
    // If byoyomi > 0, treat as byoyomi mode.
    const timeStates: TimeStates = {
      black: { timeMs: 60000, byoyomi: 10, increment: 5 },
      white: { timeMs: 60000, byoyomi: 10, increment: 5 },
    };

    await player.startSearch(record.position, usi, timeStates, dummyHandler);

    // Should subtract increment (5000) from both even if byoyomi > 0
    const expectedGo = "go btime 55000 wtime 55000 byoyomi 10000";
    expect(LanEngine.prototype.sendCommand).toHaveBeenNthCalledWith(2, expectedGo);
  });

  it("should calculate correct time for 3rd move (Black) with Fischer rule", async () => {
    // 3rd move: Black -> White -> Black (Current)
    const usi = "position startpos moves 7g7f 3c3d";
    const record = Record.newByUSI(usi) as Record;

    // Initial: 60s, Inc: 5s
    // Black consumed 10s in 1st move.
    // Current timeMs = 60000 - 10000 + 5000 = 55000
    const timeStates: TimeStates = {
      black: { timeMs: 55000, byoyomi: 0, increment: 5 },
      white: { timeMs: 60000, byoyomi: 0, increment: 5 }, // White hasn't moved or consumed roughly
    };

    await player.startSearch(record.position, usi, timeStates, dummyHandler);

    // Expected btime: 55000 - 5000 = 50000
    // Expected wtime: 60000 - 5000 = 55000 (Always subtract inc)
    const expectedGo = "go btime 50000 wtime 55000 binc 5000 winc 5000";
    expect(LanEngine.prototype.sendCommand).toHaveBeenNthCalledWith(2, expectedGo);
  });

  it("should pass delay to handler", async () => {
    const usi = "position startpos";
    const record = Record.newByUSI(usi) as Record;
    const dummyHandler: SearchHandler = {
      onMove: vi.fn(),
      onResign: vi.fn(),
      onWin: vi.fn(),
      onError: vi.fn(),
    };

    const timeStates: TimeStates = {
      black: { timeMs: 60000, byoyomi: 0, increment: 0 },
      white: { timeMs: 60000, byoyomi: 0, increment: 0 },
    };

    await player.startSearch(record.position, usi, timeStates, dummyHandler);

    // Simulate server response with delay
    const response = JSON.stringify({
      sfen: usi,
      info: "bestmove 7g7f",
      delay: 1234,
    });
    messageHandler(response);

    expect(dummyHandler.onMove).toHaveBeenCalledWith(
      expect.objectContaining({ usi: "7g7f" }), // Move object check
      expect.objectContaining({ delay: 1234, usi }), // SearchInfo object check
    );
  });
});
