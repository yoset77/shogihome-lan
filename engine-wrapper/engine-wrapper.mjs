import { spawn } from 'child_process';
import net from 'net';
import readline from 'readline';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Find .env file in the same directory as this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const HOST = process.env.BIND_ADDRESS || '127.0.0.1';
const PORT = parseInt(process.env.LISTEN_PORT || '4082', 10);

/**
 * Load engine list from engines.json.
 */
function getEngineList() {
  const enginesJsonPath = path.join(__dirname, 'engines.json');
  let engines = [];

  if (fs.existsSync(enginesJsonPath)) {
    try {
      const content = fs.readFileSync(enginesJsonPath, 'utf-8');
      engines = JSON.parse(content);
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Failed to parse engines.json: ${e.message}`);
    }
  } else {
    console.error(`[${new Date().toISOString()}] engines.json not found at ${enginesJsonPath}. No engines available.`);
  }

  return engines;
}

const server = net.createServer((socket) => {
  console.log(`[${new Date().toISOString()}] Client connected.`);
  let engineProcess = null;
  let isCleaningUp = false;

  const cleanup = () => {
    if (isCleaningUp) {
      console.log(`[${new Date().toISOString()}] Cleanup already in progress.`);
      return;
    }

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
      if (engineProcess) engineProcess.kill('SIGTERM');

      termTimeout = setTimeout(() => {
        console.warn(`[${new Date().toISOString()}] Engine did not respond to SIGTERM. Killing.`);
        if (engineProcess) engineProcess.kill('SIGKILL');
      }, 3000);
    }, 5000);

    engineProcess.once('close', (code) => {
      clearTimeout(quitTimeout);
      clearTimeout(termTimeout);
      console.log(`[${new Date().toISOString()}] Engine process exited with code ${code}.`);
      engineProcess = null;
      // Do not reset isCleaningUp to false, as this connection scope is done.
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
    const input = line.trim();
    console.log(`[${new Date().toISOString()}] Received command: '${input}'`);

    const engines = getEngineList();

    if (input === 'list') {
      const listResponse = JSON.stringify(engines);
      socket.write(listResponse + '\n');
      socket.end();
      return;
    }

    let engineId = '';
    if (input.startsWith('run ')) {
      engineId = input.substring(4).trim();
    } else if (input === 'research' || input === 'game') {
      // Backward compatibility
      engineId = input;
    } else {
      console.error(`[${new Date().toISOString()}] Invalid command received: ${input}`);
      socket.write(`WRAPPER_ERROR: Invalid command. Use 'list' or 'run <id>'.\n`);
      cleanup();
      return;
    }

    const engineDef = engines.find(e => e.id === engineId);
    if (!engineDef) {
      console.error(`[${new Date().toISOString()}] Engine ID '${engineId}' not found.`);
      socket.write(`WRAPPER_ERROR: Engine ID '${engineId}' not found.\n`);
      cleanup();
      return;
    }

    let enginePath = engineDef.path;
    if (!enginePath) {
      console.error(`[${new Date().toISOString()}] Engine path for ID '${engineId}' is not set.`);
      socket.write(`WRAPPER_ERROR: Engine path configuration error.\n`);
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
  
  const enginesJsonPath = path.join(__dirname, 'engines.json');
  if (fs.existsSync(enginesJsonPath)) {
    console.log(`[${new Date().toISOString()}] engines.json found at ${enginesJsonPath}`);
    try {
      const content = fs.readFileSync(enginesJsonPath, 'utf-8');
      const engines = JSON.parse(content);
      console.log(`[${new Date().toISOString()}] Loaded ${engines.length} engines from engines.json:`);
      engines.forEach(e => console.log(`  - ${e.id}: ${e.name} (${e.path})`));
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Failed to parse engines.json: ${e.message}`);
    }
  } else {
    console.error(`[${new Date().toISOString()}] engines.json not found. Please create one based on engines.json.example.`);
  }
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
