import { spawn } from 'child_process';
import net from 'net';
import readline from 'readline';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Find .env file in the same directory as this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const RESEARCH_ENGINE_PATH = process.env.RESEARCH_ENGINE_PATH;
const GAME_ENGINE_PATH = process.env.GAME_ENGINE_PATH;

const HOST = process.env.BIND_ADDRESS || '127.0.0.1';
const PORT = parseInt(process.env.LISTEN_PORT || '4082', 10);

const server = net.createServer((socket) => {
  console.log(`[${new Date().toISOString()}] Client connected.`);
  let engineProcess = null;
  let isCleaningUp = false;

  const cleanup = () => {
    if (isCleaningUp) return;

    if (!engineProcess || engineProcess.exitCode !== null) {
      if (engineProcess) {
        engineProcess = null;
      }
      if (!socket.destroyed) {
        socket.end();
      }
      return;
    }

    isCleaningUp = true;
    console.log(`[${new Date().toISOString()}] Cleaning up engine process (PID: ${engineProcess.pid}).`);

    let termTimeout;
    const quitTimeout = setTimeout(() => {
      console.warn(`[${new Date().toISOString()}] Engine did not exit after 'quit'. Terminating.`);
      engineProcess.kill('SIGTERM');

      termTimeout = setTimeout(() => {
        console.warn(`[${new Date().toISOString()}] Engine did not respond to SIGTERM. Killing.`);
        engineProcess.kill('SIGKILL');
      }, 3000);
    }, 5000);

    engineProcess.once('close', (code) => {
      clearTimeout(quitTimeout);
      clearTimeout(termTimeout);
      console.log(`[${new Date().toISOString()}] Engine process exited with code ${code}.`);
      engineProcess = null;
      isCleaningUp = false;
      if (!socket.destroyed) {
        socket.end();
      }
    });

    try {
      if (engineProcess.stdin && engineProcess.stdin.writable) {
        console.log(`[${new Date().toISOString()}] Sending 'quit' command to engine.`);
        engineProcess.stdin.write('quit\n');
        engineProcess.stdin.end();
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Failed to send 'quit' command, proceeding to terminate.`, e.message);
    }
  };

  const rl = readline.createInterface({ input: socket });

  rl.once('line', (line) => {
    const type = line.trim();
    console.log(`[${new Date().toISOString()}] Received engine type request: '${type}'`);

    let enginePath;
    if (type === 'research') {
      enginePath = RESEARCH_ENGINE_PATH;
    } else if (type === 'game') {
      enginePath = GAME_ENGINE_PATH;
    } else {
      console.error(`[${new Date().toISOString()}] Invalid engine type received: ${type}`);
      const errorMessage = `WRAPPER_ERROR: Invalid engine type.`;
      socket.write(errorMessage + '\n');
      cleanup();
      return;
    }

    if (!enginePath) {
      console.error(`[${new Date().toISOString()}] Engine path for type '${type}' is not set in .env file.`);
      const errorMessage = `WRAPPER_ERROR: Engine path configuration error.`;
      socket.write(errorMessage + '\n');
      cleanup();
      return;
    }

    // Resolve relative paths relative to the script directory to ensure 'cwd' is absolute and correct
    if (!path.isAbsolute(enginePath)) {
      enginePath = path.resolve(__dirname, enginePath);
    }

    const engineDirectory = path.dirname(enginePath);
    engineProcess = spawn(enginePath, [], { cwd: engineDirectory });

    engineProcess.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] Failed to start engine process. ${err.message}`);
      // Differentiate specific errors if needed for logs, but keep client message generic
      let clientMsg = "WRAPPER_ERROR: Failed to start engine process.";
      if (err.code === 'ENOENT') {
         clientMsg = "WRAPPER_ERROR: Engine executable not found.";
      }
      socket.write(clientMsg + '\n');
      cleanup();
    });

    // If the process fails to start, the 'error' event will be emitted and handled above.
    // We should not proceed if the process is not valid.
    if (engineProcess.pid === undefined) {
        return;
    }

    console.log(`[${new Date().toISOString()}] Started engine process: ${enginePath} (PID: ${engineProcess.pid})`);

    // Forward all subsequent lines from client to engine
    rl.on('line', (command) => {
      if (engineProcess && engineProcess.stdin.writable) {
        console.log(`[Client -> Engine] ${command}`);
        engineProcess.stdin.write(command + '\n');
      }
    });

    // Pipe all output from engine back to client
    engineProcess.stdout.on('data', (data) => {
      console.log(`[Engine -> Client] ${data.toString().trim()}`);
      socket.write(data);
    });
    engineProcess.stderr.on('data', (data) => {
      console.error(`[Engine ERROR] ${data.toString().trim()}`);
      socket.write(data);
    });

    engineProcess.on('close', (code) => {
      if (!isCleaningUp) {
        console.log(`[${new Date().toISOString()}] Engine process exited unexpectedly with code ${code}.`);
        cleanup();
      }
    });
  });

  socket.on('end', () => {
    console.log(`[${new Date().toISOString()}] Client sent FIN packet.`);
    cleanup();
  });

  socket.on('close', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected.`);
    cleanup();
  });

  socket.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] Socket error:`, err);
    cleanup();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Single-port engine wrapper server listening on ${HOST}:${PORT}`);
  console.log(`[${new Date().toISOString()}] Engine paths will be loaded from ${path.join(__dirname, '.env')}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`[${new Date().toISOString()}] Received ${signal}. Shutting down gracefully.`);
  server.close(() => {
    console.log(`[${new Date().toISOString()}] All connections closed. Server is shut down.`);
    process.exit(0);
  });

  // Forcefully close server after a timeout
  setTimeout(() => {
    console.error(`[${new Date().toISOString()}] Could not close connections in time, forcefully shutting down.`);
    process.exit(1);
  }, 10000); // 10 seconds
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
