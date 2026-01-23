import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import net from "net";
import { spawn, ChildProcess } from "child_process";
import path from "path";

const SERVER_PORT = 8100 + Math.floor(Math.random() * 1000);
const WRAPPER_PORT = 9990 + Math.floor(Math.random() * 1000);
const SERVER_URL = `ws://localhost:${SERVER_PORT}`;

describe("Server USI Protocol & Implicit Stop", () => {
  let serverProcess: ChildProcess;
  let serverReady = false;
  let mockWrapperServer: net.Server;
  let activeWrapperSocket: net.Socket | null = null;

  beforeAll(async () => {
    // 1. Start Mock Engine Wrapper (TCP Server)
    mockWrapperServer = net.createServer((socket) => {
      activeWrapperSocket = socket;
      socket.on("data", (data) => {
        const commands = data.toString().split("\n");
        for (const cmd of commands) {
          if (!cmd.trim()) continue;
          handleWrapperCommand(socket, cmd.trim());
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockWrapperServer.listen(WRAPPER_PORT, () => {
        console.log(`Mock Wrapper listening on ${WRAPPER_PORT}`);
        resolve();
      });
    });

    // 2. Start server.ts
    const serverPath = path.resolve(__dirname, "../../../server.ts");
    serverProcess = spawn("npx", ["tsx", serverPath], {
      env: {
        ...process.env,
        PORT: SERVER_PORT.toString(),
        REMOTE_ENGINE_PORT: WRAPPER_PORT.toString(),
        ALLOWED_ORIGINS: `http://localhost:${SERVER_PORT}`,
        WRAPPER_ACCESS_TOKEN: "", // Disable auth for tests
      },
      stdio: "pipe",
      shell: true,
    });

    await new Promise<void>((resolve, reject) => {
      serverProcess.stdout?.on("data", (data) => {
        const msg = data.toString();
        if (msg.includes(`Server is listening on 0.0.0.0:${SERVER_PORT}`)) {
          serverReady = true;
          resolve();
        }
      });
      setTimeout(() => {
        if (!serverReady) reject(new Error("Server start timeout"));
      }, 10000);
    });
  });

  afterAll(() => {
    if (serverProcess) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", serverProcess.pid!.toString(), "/f", "/t"]);
      } else {
        serverProcess.kill();
      }
    }
    if (mockWrapperServer) {
      mockWrapperServer.close();
    }
  });

  // Mock Engine Logic

  let isThinking = false;

  function handleWrapperCommand(socket: net.Socket, cmd: string) {
    if (cmd.startsWith("run ")) {
      // simulate engine start

      setTimeout(() => socket.write("usiok\n"), 50);
    } else if (cmd === "usi") {
      // ignore, usually handled after connect or run
    } else if (cmd === "isready") {
      setTimeout(() => socket.write("readyok\n"), 50);
    } else if (cmd.startsWith("go")) {
      isThinking = true;

      // Simulate thinking info

      setTimeout(() => {
        if (isThinking) socket.write("info depth 1 score cp 10 pv 7g7f\n");
      }, 100);

      // If not infinite, send bestmove automatically

      if (!cmd.includes("infinite")) {
        setTimeout(() => {
          if (isThinking) {
            isThinking = false;

            socket.write("bestmove 7g7f\n");
          }
        }, 200);
      }
    } else if (cmd === "stop") {
      if (isThinking) {
        isThinking = false;

        setTimeout(() => socket.write("bestmove 7g7f\n"), 50);
      }
    }
  }

  it("should perform implicit stop when receiving 'position' while thinking", async () => {
    const sessionId = "test-implicit-stop";
    const ws = new WebSocket(`${SERVER_URL}/?sessionId=${sessionId}`, {
      origin: `http://localhost:${SERVER_PORT}`,
    });

    await new Promise<void>((resolve) => ws.on("open", resolve));

    // 1. Start Engine
    const readyPromise = new Promise<void>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.info === "info: engine is ready") {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });
    ws.send("start_engine test-engine");
    await readyPromise;

    // 2. Start Thinking
    const thinkingPromise = new Promise<void>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.state === "thinking" || (msg.info && msg.info.startsWith("info"))) {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });
    ws.send("position startpos");
    ws.send("go btime 30000 wtime 30000");
    await thinkingPromise;

    // 3. Send 'position' command WHILE thinking (should trigger implicit stop)
    // We spy on the mock wrapper socket to see if 'stop' was sent
    let stopReceived = false;
    // Intercept wrapper commands
    const commandPromise = new Promise<void>((resolve) => {
      const socket = activeWrapperSocket!;
      // Note: We don't remove existing listeners to avoid breaking the mock logic completely,
      // but we prepend this one or just add it.
      // Better to check if we can add a listener without removing.
      // The original code removed all listeners which might break the handleWrapperCommand if not careful.
      // But handleWrapperCommand is inside the listener.
      // Let's attach a new 'data' listener.
      const listener = (data: Buffer) => {
        const commands = data.toString().split("\n");
        for (const cmd of commands) {
          if (!cmd.trim()) continue;
          if (cmd.trim() === "stop") {
            stopReceived = true;
            socket.off("data", listener);
            resolve();
          }
        }
      };
      socket.on("data", listener);
    });
    ws.send("position startpos moves 7g7f");
    // Wait for stop to be received by wrapper
    await commandPromise;
    expect(stopReceived).toBe(true);
    ws.close();
  });

  it("should queue commands while starting and flush them when ready", async () => {
    const sessionId = "test-queuing";
    const ws = new WebSocket(`${SERVER_URL}/?sessionId=${sessionId}`, {
      origin: `http://localhost:${SERVER_PORT}`,
    });

    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Capture received commands on the mock wrapper
    const receivedCommands: string[] = [];

    // We need to hook into the socket as soon as it connects.
    // Since we can't easily predict when start_engine connects, we poll activeWrapperSocket
    // But sending start_engine starts the process.
    // The previous test might have left a socket?
    // start_engine will create a NEW socket connection.

    // We'll prepare the hook promise first.
    const hookPromise = new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (activeWrapperSocket && activeWrapperSocket.connecting === false) {
          // Wait until it's a NEW socket? hard to tell.
          // But since start_engine connects to mock server, mock server callback updates activeWrapperSocket.
          // We can just rely on mockWrapperServer 'connection' event?
          // The mock server setup in beforeAll updates activeWrapperSocket on connection.
          // We can add a listener to the server itself?
          // No, mockWrapperServer is net.Server.
          clearInterval(checkInterval);

          const socket = activeWrapperSocket;
          const listener = (data: Buffer) => {
            const cmds = data.toString().split("\n");
            for (const c of cmds) {
              if (c.trim()) receivedCommands.push(c.trim());
            }
          };
          socket.on("data", listener);
          resolve();
        }
      }, 10);
    });

    // 1. Start Engine
    ws.send("start_engine test-engine");

    // 2. Send options IMMEDIATELY (while engine is starting/initializing)
    ws.send("setoption name MultiPV value 5");

    // Wait for ready state from client perspective
    const readyPromise = new Promise<void>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.info === "info: engine is ready") {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });

    await readyPromise;
    await hookPromise; // Ensure we hooked (though we might have missed early commands if polling was slow, but setoption comes later)

    // Allow some time for queue flush
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify commands were sent AFTER handshake
    expect(receivedCommands).toContain("setoption name MultiPV value 5");

    ws.close();
  });

  it("should handle normal go/bestmove flow correctly", async () => {
    const sessionId = "test-normal-flow";
    const ws = new WebSocket(`${SERVER_URL}/?sessionId=${sessionId}`, {
      origin: `http://localhost:${SERVER_PORT}`,
    });

    await new Promise<void>((resolve) => ws.on("open", resolve));

    const readyPromise = new Promise<void>((resolve, reject) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.error) {
          ws.off("message", listener);
          reject(new Error(`Server returned error during start: ${msg.error}`));
        }
        if (msg.info === "info: engine is ready") {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });

    ws.send("start_engine test-engine");
    await readyPromise;

    // Start thinking
    const thinkingPromise = new Promise<void>((resolve, reject) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.error) {
          ws.off("message", listener);
          reject(new Error(`Server returned error during thinking wait: ${msg.error}`));
        }
        if (msg.state === "thinking") {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });

    const bestmovePromise = new Promise<void>((resolve, reject) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.error) {
          ws.off("message", listener);
          reject(new Error(`Server returned error during bestmove wait: ${msg.error}`));
        }
        if (msg.info && msg.info.startsWith("bestmove")) {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });

    // Check state returns to ready
    // Must listen BEFORE sending go, as bestmove and ready state come back-to-back
    const readyStatePromise = new Promise<void>((resolve, reject) => {
      const listener = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.error) {
          ws.off("message", listener);
          reject(new Error(`Server returned error during ready state wait: ${msg.error}`));
        }
        if (msg.state === "ready") {
          ws.off("message", listener);
          resolve();
        }
      };
      ws.on("message", listener);
    });

    ws.send("position startpos");
    ws.send("go btime 1000");

    // Check for thinking state
    await thinkingPromise;

    // Wait for bestmove
    await bestmovePromise;

    await readyStatePromise;

    ws.close();
  });
});
