import { LanPlayer } from "@/renderer/players/lan_player";
import { lanEngine } from "@/renderer/network/lan_engine";
import { Record } from "tsshogi";
import { Mocked } from "vitest";
import { TimeStates } from "@/common/game/time";
import { SearchHandler } from "@/renderer/players/player";

vi.mock("@/renderer/network/lan_engine");
vi.mock("@/renderer/players/usi.js");

const mockLanEngine = lanEngine as Mocked<typeof lanEngine>;

describe("LanPlayer Time Control", () => {
  let player: LanPlayer;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let messageHandler: (message: string) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    player = new LanPlayer("test-engine", "Test Engine");

    mockLanEngine.connect.mockImplementation((handler) => {
      messageHandler = handler;
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
    expect(mockLanEngine.sendCommand).toHaveBeenCalledWith(expectedGo);
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
    expect(mockLanEngine.sendCommand).toHaveBeenCalledWith(expectedGo);
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
    expect(mockLanEngine.sendCommand).toHaveBeenCalledWith(expectedGo);
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

    // Should behave as byoyomi mode (no subtraction, no binc/winc)
    const expectedGo = "go btime 60000 wtime 60000 byoyomi 10000";
    expect(mockLanEngine.sendCommand).toHaveBeenCalledWith(expectedGo);
  });
});
