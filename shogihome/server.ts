import express from "express";
import http from "http";
import net from "net";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import dotenv from "dotenv";
import helmet from "helmet";
const getBasePath = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((process as any).pkg) {
    return path.dirname(process.execPath);
  }
  const __filename = fileURLToPath(import.meta.url);
  return path.dirname(__filename);
};

dotenv.config({ path: path.join(getBasePath(), ".env") });

const app = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT || "8080", 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push(`http://localhost:${PORT}`);
}

const shogiHomePath = path.join(getBasePath(), "docs", "webapp");
console.log(`Serving static files from: ${shogiHomePath}`);

const updatePuzzlesManifest = () => {
  const puzzlesDir = path.join(shogiHomePath, "puzzles");
  const manifestPath = path.join(shogiHomePath, "puzzles-manifest.json");
  console.log(`Checking puzzles in: ${puzzlesDir}`);

  try {
    if (!fs.existsSync(puzzlesDir)) {
      console.log("Puzzles directory not found, skipping manifest update.");
      return;
    }

    const files = fs.readdirSync(puzzlesDir).filter((file) => file.endsWith(".json"));
    console.log(`Found ${files.length} puzzle files.`);

    const manifest = files.map((file) => {
      const filePath = path.join(puzzlesDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const puzzles = JSON.parse(content);
        return {
          file: file,
          count: Array.isArray(puzzles) ? puzzles.length : 0,
        };
      } catch (e) {
        console.warn(`Failed to read or parse puzzle file: ${file}`, e);
        return { file: file, count: 0 };
      }
    });

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Updated puzzle manifest at ${manifestPath}`);
  } catch (error) {
    console.error("Failed to update puzzle manifest:", error);
  }
};

updatePuzzlesManifest();

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'",
          "ws:",
          "wss:",
          ...ALLOWED_ORIGINS.map((o) => o.replace("http", "ws").replace("https", "wss")),
        ],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
      },
    },
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }),
);

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  verifyClient: (info, cb) => {
    const origin = info.origin;

    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`Blocked connection from unauthorized origin: ${origin}`);
      console.warn(`Allowed origins are: ${JSON.stringify(ALLOWED_ORIGINS)}`);
      cb(false, 403, "Forbidden");
      return;
    }
    cb(true);
  },
});

const REMOTE_ENGINE_HOST = process.env.REMOTE_ENGINE_HOST || "localhost";
const REMOTE_ENGINE_PORT = parseInt(process.env.REMOTE_ENGINE_PORT || "4082", 10);

app.use(express.static(shogiHomePath));

app.get("/*", (req, res) => {
  res.sendFile(path.join(shogiHomePath, "index.html"));
});

enum EngineState {
  UNINITIALIZED,
  STARTING,
  WAITING_USIOK,
  WAITING_READYOK,
  READY,
  STOPPED,
}

type EngineHandle = {
  write: (command: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
  removeAllListeners: (event?: string) => void;
};

// Custom type for WebSocket with isAlive property
interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
}

// Add a keep-alive mechanism
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws: ExtendedWebSocket) {
    if (ws.isAlive === false) {
      console.log("Client connection timed out, terminating.");
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

wss.on("close", function close() {
  clearInterval(interval);
});

wss.on("connection", (ws: ExtendedWebSocket) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  let engineHandle: EngineHandle | null = null;
  let engineState = EngineState.UNINITIALIZED;
  const commandQueue: string[] = [];
  const postStopCommandQueue: string[] = [];
  let isThinking = false;
  let isWaitingForBestmove = false;
  let currentEngineSfen: string | null = null;
  let isStopping = false;

  console.log("Client connected");

  const updateCurrentSfen = (command: string) => {
    if (command.startsWith("position sfen ")) {
      currentEngineSfen = command.substring("position sfen ".length);
    }
  };

  const isValidUsiCommand = (command: string): boolean => {
    if (/[\r\n]/.test(command)) return false;

    const cmd = command.trim();
    if (cmd === "") return false;
    const parts = cmd.split(" ");
    const head = parts[0];

    switch (head) {
      case "usi":
      case "isready":
      case "usinewgame":
      case "stop":
      case "ponderhit":
      case "quit":
        return parts.length === 1;
      case "gameover":
        return parts.length === 2 && ["win", "lose", "draw"].includes(parts[1]);
      case "setoption":
        // setoption name <id> [value <x>]
        return /^setoption name \S+( value .+)?$/.test(cmd);
      case "position":
        // position [sfen <sfenstring> | startpos ] moves <move1> ... <movei>
        if (parts[1] === "startpos") {
          if (parts.length === 2) return true;
          if (parts[2] === "moves") {
            return parts.slice(3).every((m) => /^[a-zA-Z0-9+*]+$/.test(m));
          }
          return false;
        } else if (parts[1] === "sfen") {
          const movesIndex = parts.indexOf("moves");
          if (movesIndex === -1) {
            return new RegExp("^position sfen [a-zA-Z0-9+/\\s-]+$").test(cmd);
          } else {
            const sfenPart = parts.slice(0, movesIndex).join(" ");
            if (!new RegExp("^position sfen [a-zA-Z0-9+/\\s-]+$").test(sfenPart)) return false;
            return parts.slice(movesIndex + 1).every((m) => /^[a-zA-Z0-9+*]+$/.test(m));
          }
        }
        return false;
      case "go": {
        const args = parts.slice(1);
        for (let i = 0; i < args.length; i++) {
          const t = args[i];
          if (["ponder", "infinite"].includes(t)) continue;
          if (["btime", "wtime", "byoyomi", "binc", "winc"].includes(t)) {
            if (i + 1 >= args.length || !/^\d+$/.test(args[i + 1])) return false;
            i++;
          } else if (t === "mate") {
            if (i + 1 >= args.length || !/^(\d+|infinite)$/.test(args[i + 1])) return false;
            i++;
          } else {
            return false;
          }
        }
        return true;
      }
      default:
        return false;
    }
  };

  const sendToEngine = (command: string) => {
    if (engineHandle) {
      if (!isValidUsiCommand(command)) {
        console.warn(`Invalid USI command blocked: ${command}`);
        return;
      }

      updateCurrentSfen(command);
      if (command.startsWith("go")) {
        isThinking = true;
      }
      console.log(`Sending to engine: ${command}`);
      engineHandle.write(command + "\n");
    }
  };

  const sendError = (message: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      let safeMessage = message;
      if (message.includes("WRAPPER_ERROR:")) {
        console.error(`Internal Wrapper Error: ${message}`); // Log full error on server
        // Sanitize for client
        if (message.includes("Engine executable not found")) {
          safeMessage = "error: Engine executable not found.";
        } else if (message.includes("Engine path for type")) {
          safeMessage = "error: Engine path configuration error.";
        } else {
          safeMessage = "error: Internal server error.";
        }
      } else {
        safeMessage = message.startsWith("error: ") ? message : `error: ${message}`;
      }
      ws.send(JSON.stringify({ error: safeMessage }));
    }
  };

  const processCommandQueue = () => {
    while (commandQueue.length > 0) {
      const command = commandQueue.shift();
      if (command) {
        sendToEngine(command);
      }
    }
  };

  const startEngine = (engineId: string) => {
    if (engineHandle) {
      sendError("engine already running");
      return;
    }
    engineState = EngineState.STARTING;

    const onEngineClose = () => {
      console.log("Engine process exited.");
      engineHandle?.removeAllListeners();
      engineHandle = null;
      engineState = EngineState.STOPPED;
      isStopping = false;
      commandQueue.length = 0;
      postStopCommandQueue.length = 0;
      isThinking = false;
      isWaitingForBestmove = false;
      currentEngineSfen = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ info: "info: engine stopped" }));
      }
    };

    const setupEngineHandlers = (stream: NodeJS.ReadableStream) => {
      const rl = readline.createInterface({ input: stream });
      rl.on("line", (line) => {
        console.log(`Engine output: ${line}`);

        if (line.trim().startsWith("WRAPPER_ERROR:")) {
          console.error(`Engine wrapper error: ${line}`);
          sendError(line);
          onEngineClose();
          return;
        }

        const response = { sfen: currentEngineSfen, info: line };
        ws.send(JSON.stringify(response));

        if (line.startsWith("bestmove")) {
          isThinking = false;
          if (isWaitingForBestmove) {
            isWaitingForBestmove = false;

            // --- Debounce commands (handling setoption and position) ---
            let latestPosition: string | null = null;
            let latestSetoptionMultiPV: string | null = null;
            let latestGo: string | null = null;

            for (const command of postStopCommandQueue) {
              if (command.startsWith("position sfen")) {
                latestPosition = command;
              } else if (command.startsWith("setoption name MultiPV")) {
                latestSetoptionMultiPV = command;
              } else if (command.startsWith("go")) {
                latestGo = command;
              }
            }

            const commandsToRun: string[] = [];
            // Ensure 'setoption' is sent before 'position'
            if (latestSetoptionMultiPV) {
              commandsToRun.push(latestSetoptionMultiPV);
            }
            if (latestPosition) {
              commandsToRun.push(latestPosition);
            }
            if (latestGo) {
              commandsToRun.push(latestGo);
            }

            postStopCommandQueue.length = 0;

            if (commandsToRun.length > 0) {
              console.log(`Running debounced commands: ${JSON.stringify(commandsToRun)}`);
              for (const command of commandsToRun) {
                sendToEngine(command);
              }
            }
          }
        }

        if (engineState === EngineState.WAITING_USIOK && line.trim() === "usiok") {
          engineState = EngineState.WAITING_READYOK;
          sendToEngine("isready");
        } else if (engineState === EngineState.WAITING_READYOK && line.trim() === "readyok") {
          engineState = EngineState.READY;
          ws.send(JSON.stringify({ info: "info: engine is ready" }));
          processCommandQueue();
        }
      });
    };

    console.log(`Connecting to remote engine at ${REMOTE_ENGINE_HOST}:${REMOTE_ENGINE_PORT}`);

    const socket = new net.Socket();

    const connectionTimeout = setTimeout(() => {
      console.error("Connection timed out after 5 seconds");
      sendError("connection timed out");
      socket.destroy();
      engineState = EngineState.UNINITIALIZED;
      commandQueue.length = 0;
      postStopCommandQueue.length = 0;
      isThinking = false;
      isWaitingForBestmove = false;
      currentEngineSfen = null;
    }, 5000); // 5-second timeout

    socket.on("connect", () => {
      clearTimeout(connectionTimeout);
      console.log(`Connected to remote engine. Specifying engine ID: ${engineId}`);
      socket.write(`run ${engineId}\n`);

      engineState = EngineState.WAITING_USIOK;
      engineHandle = {
        write: (cmd) => socket.write(cmd),
        close: () => socket.end(),
        on: (e, l) => socket.on(e, l),
        off: (e, l) => socket.off(e, l),
        removeAllListeners: (e) => socket.removeAllListeners(e),
      };
      setupEngineHandlers(socket);
      engineHandle.on("close", onEngineClose);
      engineHandle.on("error", (err) => {
        console.error("Remote engine connection error:", err);
        sendError("remote engine connection failed");
        onEngineClose();
      });
      // Initiate USI handshake automatically
      sendToEngine("usi");
    });

    socket.on("error", (err) => {
      clearTimeout(connectionTimeout);
      if (engineState === EngineState.STARTING) {
        console.error("Failed to connect to remote engine:", err);
        sendError(`failed to connect to remote engine (${err.message})`);
        engineState = EngineState.UNINITIALIZED;
        commandQueue.length = 0;
        postStopCommandQueue.length = 0;
        isThinking = false;
        isWaitingForBestmove = false;
        currentEngineSfen = null;
      }
    });

    socket.connect(REMOTE_ENGINE_PORT, REMOTE_ENGINE_HOST);
  };

  const getEngineList = () => {
    console.log(`Fetching engine list from ${REMOTE_ENGINE_HOST}:${REMOTE_ENGINE_PORT}`);
    const socket = new net.Socket();
    let data = "";

    const connectionTimeout = setTimeout(() => {
      socket.destroy(new Error("Connection timed out"));
    }, 5000);

    socket.on("connect", () => {
      clearTimeout(connectionTimeout);
      socket.write("list\n");
    });

    socket.on("data", (chunk) => {
      data += chunk.toString();
    });

    socket.on("end", () => {
      try {
        const engines = JSON.parse(data.trim());
        ws.send(JSON.stringify({ engineList: engines }));
      } catch (e) {
        console.error("Failed to parse engine list from wrapper:", e);
        sendError("failed to parse engine list");
      }
    });

    socket.on("error", (err) => {
      clearTimeout(connectionTimeout);
      console.error("Failed to get engine list:", err);
      sendError(`failed to connect to engine wrapper (${err.message})`);
    });

    socket.connect(REMOTE_ENGINE_PORT, REMOTE_ENGINE_HOST);
  };

  ws.on("message", (message) => {
    const command = message.toString();
    console.log(`Received command: ${command}`);

    if (command === "get_engine_list") {
      getEngineList();
      return;
    }

    if (command === "stop") {
      if (engineState === EngineState.READY && isThinking && !isWaitingForBestmove) {
        isWaitingForBestmove = true;
        postStopCommandQueue.length = 0;
        sendToEngine(command);
      }
      return;
    }

    if (isWaitingForBestmove) {
      postStopCommandQueue.push(command);
      return;
    }

    if (command.startsWith("start_engine ")) {
      const engineId = command.substring("start_engine ".length).trim();
      startEngine(engineId);
      return;
    }

    if (command === "stop_engine") {
      if (engineHandle) {
        isStopping = true;
        commandQueue.length = 0;
        postStopCommandQueue.length = 0;
        isThinking = false;
        isWaitingForBestmove = false;
        currentEngineSfen = null;
        engineHandle.close();
      }
      return;
    }

    if (command === "usi" || command === "isready") {
      // Handshake is managed by the server automatically.
      return;
    }

    if (command.startsWith("setoption ")) {
      if (engineState >= EngineState.WAITING_USIOK) {
        sendToEngine(command);
      } else {
        console.log(`Engine connection in progress, queueing: ${command}`);
        commandQueue.push(command);
      }
      return;
    }

    if (engineState === EngineState.READY) {
      sendToEngine(command);
    } else if (engineState > EngineState.UNINITIALIZED && engineState < EngineState.READY) {
      console.log(`Engine not ready, queueing command: ${command}`);
      commandQueue.push(command);
    } else {
      sendError(`engine not started. Cannot process command: ${command}`);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    commandQueue.length = 0;
    postStopCommandQueue.length = 0;
    isThinking = false;
    currentEngineSfen = null;
    if (engineHandle && !isStopping) {
      engineHandle.close();
    }
  });
});

const BIND_ADDRESS = process.env.BIND_ADDRESS || "0.0.0.0";

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Server is listening on ${BIND_ADDRESS}:${PORT}`);
  console.log(`Access ShogiHome at http://localhost:${PORT}`);
});
