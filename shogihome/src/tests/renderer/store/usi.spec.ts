import { USIPlayerMonitor } from "@/renderer/store/usi";

describe("USIPlayerMonitor", () => {
  const sfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

  it("should ignore info updates without pv and score", () => {
    const monitor = new USIPlayerMonitor(1, "Test Engine");

    // 1. Update MultiPV 1
    monitor.update(
      sfen,
      {
        multipv: 1,
        scoreCP: 100,
        pv: ["7g7f", "3c3d", "2g2f"],
      },
      10,
    );

    // 2. Update MultiPV 2
    monitor.update(
      sfen,
      {
        multipv: 2,
        scoreCP: 50,
        pv: ["2g2f", "8c8d", "7g7f"],
      },
      10,
    );

    // 3. Update Summary (No PV, No Score) - FukauraOu style
    monitor.update(
      sfen,
      {
        nodes: 1000,
        nps: 5000,
        hashfullPerMill: 1,
      },
      10,
    );

    const latest = monitor.latestInfo;

    // Should have 2 entries (MPV 1 and MPV 2), ignoring the summary
    expect(latest).toHaveLength(2);
    expect(latest[0].score).toBe(100); // MPV 1 comes first

    expect(latest[0].multiPV).toBe(1);
    expect(latest[0].pv).toEqual(["7g7f", "3c3d", "2g2f"]);

    expect(latest[1].score).toBe(50); // MPV 2 comes second

    expect(latest[1].multiPV).toBe(2);
    expect(latest[1].pv).toEqual(["2g2f", "8c8d", "7g7f"]);

    // Verify monitor properties are updated from summary
    expect(monitor.nodes).toBe(1000);
    expect(monitor.nps).toBe(5000);
  });

  it("should handle mixed order updates", () => {
    const monitor = new USIPlayerMonitor(1, "Test Engine");

    // Summary first
    monitor.update(sfen, { nodes: 100, nps: 1000 }, 10);

    // MPV 1
    monitor.update(sfen, { multipv: 1, scoreCP: 100, pv: ["7g7f"] }, 10);

    expect(monitor.latestInfo).toHaveLength(1);
    expect(monitor.latestInfo[0].multiPV).toBe(1);
  });
});
