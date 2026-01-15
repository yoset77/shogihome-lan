import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import net from "net";
import { spawn, ChildProcess } from "child_process";
import path from "path";

const SERVER_PORT = 8100 + Math.floor(Math.random() * 100);
const WRAPPER_PORT = 9990 + Math.floor(Math.random() * 100);
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
    ws.send("start_engine test-engine");
    // Wait for ready
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.info === "info: engine is ready") resolve();
      });
    });

    // 2. Start Thinking
    ws.send("position startpos");
    ws.send("go btime 30000 wtime 30000");
    // Wait for thinking state or info
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.state === "thinking" || (msg.info && msg.info.startsWith("info"))) {
          resolve();
        }
      });
    });

    // 3. Send 'position' command WHILE thinking (should trigger implicit stop)
    // We spy on the mock wrapper socket to see if 'stop' was sent
    let stopReceived = false;
    // Intercept wrapper commands
    const commandPromise = new Promise<void>((resolve) => {
      const socket = activeWrapperSocket!;
      socket.removeAllListeners("data");
      socket.on("data", (data) => {
        const commands = data.toString().split("\n");
        for (const cmd of commands) {
          if (!cmd.trim()) continue;
          if (cmd.trim() === "stop") {
            stopReceived = true;
            resolve();
          }
          // Pass to original logic to send bestmove
          handleWrapperCommand(socket, cmd.trim());
        }
      });
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

    // 1. Start Engine
    ws.send("start_engine test-engine");

    // 2. Send options IMMEDIATELY (while engine is starting/initializing)
    ws.send("setoption name MultiPV value 5");
    ws.send("setoption name Hash value 128");

    // Capture received commands on the mock wrapper
    const receivedCommands: string[] = [];

    // We need to hook into the existing socket or wait for new connection
    // Since start_engine triggers a new connection, we need to wait for it.
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (activeWrapperSocket) {
          clearInterval(checkInterval);
          const originalListener = activeWrapperSocket.listeners("data")[0] as (
            data: Buffer | string,
          ) => void;
          activeWrapperSocket.removeAllListeners("data");
          activeWrapperSocket.on("data", (data) => {
            const cmds = data.toString().split("\n");
            for (const c of cmds) {
              if (c.trim()) receivedCommands.push(c.trim());
            }
            // Call original to handle handshake
            originalListener(data as Buffer);
          });
          resolve();
        }
      }, 50);
    });

    // Wait for ready state
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.info === "info: engine is ready") resolve();
      });
    });

    // Allow some time for queue flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify commands were sent AFTER handshake
    // Expected order: run ..., usi, isready, setoption..., setoption...
    // Note: 'run' and 'usi' might be processed before we hooked, but setoptions should be there.
    expect(receivedCommands).toContain("setoption name MultiPV value 5");
    expect(receivedCommands).toContain("setoption name Hash value 128");

    ws.close();
  });

  it("should handle normal go/bestmove flow correctly", async () => {
    const sessionId = "test-normal-flow";
    const ws = new WebSocket(`${SERVER_URL}/?sessionId=${sessionId}`, {
      origin: `http://localhost:${SERVER_PORT}`,
    });

    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send("start_engine test-engine");

    // Wait for ready
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.info === "info: engine is ready") resolve();
      });
    });

    // Start thinking
    ws.send("position startpos");
    ws.send("go btime 1000");

    // Check for thinking state
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.state === "thinking") resolve();
      });
    });

    // Wait for bestmove (simulated by mock wrapper automatically after 'go')
    // Our mock wrapper sends info then bestmove 7g7f
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.info && msg.info.startsWith("bestmove")) {
          resolve();
        }
      });
    });

    // Check state returns to ready
    await new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.state === "ready") resolve();
      });
    });

    ws.close();
  });
});
