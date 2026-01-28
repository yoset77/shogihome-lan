import { createStore } from "@/renderer/store/index.js";
import { exportJKFString, importJKFString, Move } from "tsshogi";

describe("store/webapp", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("withUSENParam", () => {
    vi.stubGlobal("window", {
      location: {
        toString: () =>
          "http://localhost/?usen=~0.7ku2jm6y20e45t2.&branch=0&ply=2&bname=bbb&wname=www",
      },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    });
    const store = createStore();
    expect(store.isRecordFileUnsaved).toBeFalsy();
    expect(store.record.getUSI({ allMoves: true })).toBe(
      "position startpos moves 7g7f 3c3d 2g2f 4a3b 2f2e",
    );
    expect(store.record.moves).toHaveLength(6);
    expect(store.record.current.ply).toBe(2);
  });

  it("pcWeb/withLocalStorage", () => {
    vi.stubGlobal("window", {
      location: {
        toString: () => "http://localhost/",
      },
      history: {
        replaceState: vi.fn(),
      },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    });
    const store = createStore();
    store.doMove(store.record.position.createMoveByUSI("5g5f") as Move);
    vi.runAllTimers();
    const store2 = createStore();
    expect(store2.record.getUSI({ allMoves: true })).toBe("position startpos moves 5g5f");
  });

  it("saveOnNavigate", () => {
    vi.stubGlobal("window", {
      location: {
        toString: () => "http://localhost/",
      },
      history: {
        replaceState: vi.fn(),
      },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    });
    const store = createStore();
    store.doMove(store.record.position.createMoveByUSI("7g7f") as Move);
    store.doMove(store.record.position.createMoveByUSI("3c3d") as Move);
    vi.runAllTimers();

    store.goBack();
    vi.runAllTimers();

    const store2 = createStore();
    // Should be at 1st move (7g7f)
    expect(store2.record.current.ply).toBe(1);
    expect(store2.record.moves).toHaveLength(3); // Record itself has 2 moves + startpos

    store.goForward();
    vi.runAllTimers();

    const store3 = createStore();
    // Should be at 2nd move (3c3d)
    expect(store3.record.current.ply).toBe(2);
  });

  it("jkf/branch-consistency", () => {
    const store = createStore();
    // 1. Setup a record with branches
    store.doMove(store.record.position.createMoveByUSI("7g7f") as Move);
    store.doMove(store.record.position.createMoveByUSI("3c3d") as Move);

    store.goBack(); // Back to 7g7f
    store.doMove(store.record.position.createMoveByUSI("8c8d") as Move);

    // 3. Export to JKF
    const jkf = exportJKFString(store.record);

    // 4. Import from JKF
    const restoredRecord = importJKFString(jkf);
    if (restoredRecord instanceof Error) {
      throw restoredRecord;
    }

    // 6. Verify Branch Structure
    restoredRecord.goto(2); // 7g7f -> 3c3d
    expect((restoredRecord.current.move as Move).usi).toBe("3c3d");

    restoredRecord.goto(1);
    // Check if branch exists linked from the next node (main branch node)
    const nextNode = restoredRecord.current.next;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchNode = (nextNode as any).branch;
    expect(branchNode).toBeDefined();
    expect(branchNode.move.usi).toBe("8c8d");
  });

  it("mobileWeb/localStorage", () => {
    vi.stubGlobal("window", {
      location: {
        toString: () => "http://localhost/?mobile",
      },
      history: {
        replaceState: vi.fn(),
      },
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
    });
    const store = createStore();
    store.doMove(store.record.position.createMoveByUSI("5g5f") as Move);
    vi.runAllTimers();
    const store2 = createStore();
    expect(store2.record.getUSI({ allMoves: true })).toBe("position startpos moves 5g5f");
  });
});
