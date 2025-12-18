import asyncio
import os
import sys
import logging
import subprocess
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone
from dotenv import load_dotenv
from pathlib import Path

# Determine if running as a compiled executable (Nuitka or PyInstaller)
is_compiled_or_frozen = getattr(sys, 'frozen', False) or '__compiled__' in globals()

if is_compiled_or_frozen:
    # Running as compiled executable
    # Nuitka --onefile might set sys.executable to temp dir, so use sys.argv[0]
    script_dir = Path(sys.argv[0]).resolve().parent
else:
    # Running as a script
    script_dir = Path(__file__).resolve().parent

# Configure logging
log_handlers = []
# If running as a compiled executable, always log to file to ensure stability in non-interactive environments
# (e.g. Task Scheduler, Services) where sys.stderr might be invalid or cause crashes (0x80070001).
if is_compiled_or_frozen:
    log_file = script_dir / 'engine-wrapper.log'
    log_handlers.append(RotatingFileHandler(
        log_file, 
        maxBytes=1*1024*1024, 
        backupCount=2, 
        encoding='utf-8'
    ))
else:
    # Development mode: Log to console
    log_handlers.append(logging.StreamHandler())

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s.%(msecs)03dZ] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    handlers=log_handlers
)
logging.Formatter.converter = lambda *args: datetime.now(timezone.utc).timetuple()

logging.debug(f"is_compiled_or_frozen: {is_compiled_or_frozen}")
logging.debug(f"sys.executable: {sys.executable}")
logging.debug(f"sys.argv[0]: {sys.argv[0]}")
logging.debug(f"Resolved script_dir: {script_dir}")

load_dotenv(dotenv_path=script_dir / '.env')

RESEARCH_ENGINE_PATH = os.getenv('RESEARCH_ENGINE_PATH')
GAME_ENGINE_PATH = os.getenv('GAME_ENGINE_PATH')
HOST = os.getenv('BIND_ADDRESS', '127.0.0.1')
PORT = int(os.getenv('LISTEN_PORT', '4082'))

async def pipe_stream(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, log_prefix: str):
    try:
        while not reader.at_eof():
            data = await reader.read(1024)
            if not data:
                break
            logging.info(f"{log_prefix} {data.decode(errors='ignore').strip()}")
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
        pass
    finally:
        pass

async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    peername = client_writer.get_extra_info('peername')
    logging.info(f"Client connected from {peername}")
    engine_process = None
    tasks_to_cancel = []

    try:
        first_line = await client_reader.readline()
        if not first_line:
            logging.warning("Client disconnected before sending engine type.")
            return

        engine_type = first_line.decode().strip()
        logging.info(f"Received engine type request: '{engine_type}'")

        engine_path_str = None
        if engine_type == 'research':
            engine_path_str = RESEARCH_ENGINE_PATH
        elif engine_type == 'game':
            engine_path_str = GAME_ENGINE_PATH
        else:
            logging.error(f"Invalid engine type received: {engine_type}")
            error_message = "WRAPPER_ERROR: Invalid engine type."
            client_writer.write(error_message.encode() + b'\n')
            await client_writer.drain()
            return

        if not engine_path_str:
            logging.error(f"Engine path for type '{engine_type}' is not set in .env file.")
            error_message = "WRAPPER_ERROR: Engine path configuration error."
            client_writer.write(error_message.encode() + b'\n')
            await client_writer.drain()
            return
        
        engine_path = Path(engine_path_str)
        # Resolve relative paths relative to the script directory to ensure 'cwd' is absolute and correct
        if not engine_path.is_absolute():
            engine_path = (script_dir / engine_path).resolve()

        engine_directory = engine_path.parent

        # Prevent new console window on Windows
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NO_WINDOW

        try:
            engine_process = await asyncio.create_subprocess_exec(
                str(engine_path),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=engine_directory,
                creationflags=creationflags
            )
        except FileNotFoundError:
            logging.error(f"Engine executable not found at '{engine_path_str}'")
            error_message = "WRAPPER_ERROR: Engine executable not found."
            client_writer.write(error_message.encode() + b'\n')
            await client_writer.drain()
            return
        except Exception as e:
            logging.error(f"Failed to start engine process: {e}", exc_info=True)
            error_message = "WRAPPER_ERROR: Failed to start engine process."
            client_writer.write(error_message.encode() + b'\n')
            await client_writer.drain()
            return

        logging.info(f"Started engine process: {engine_path} (PID: {engine_process.pid})")

        client_to_engine_task = asyncio.create_task(
            pipe_stream(client_reader, engine_process.stdin, "[Client -> Engine]")
        )
        engine_stdout_to_client_task = asyncio.create_task(
            pipe_stream(engine_process.stdout, client_writer, "[Engine -> Client]")
        )
        engine_stderr_to_client_task = asyncio.create_task(
            pipe_stream(engine_process.stderr, client_writer, "[Engine ERROR]")
        )
        engine_wait_task = asyncio.create_task(engine_process.wait())
        
        tasks_to_cancel = [
            client_to_engine_task, 
            engine_stdout_to_client_task, 
            engine_stderr_to_client_task, 
            engine_wait_task
        ]

        done, pending = await asyncio.wait(
            tasks_to_cancel,
            return_when=asyncio.FIRST_COMPLETED
        )

        for task in pending:
            task.cancel()

    except Exception as e:
        logging.error(f"An error occurred in client handler: {e}", exc_info=True)
    finally:
        for task in tasks_to_cancel:
            if not task.done():
                task.cancel()

        if engine_process and engine_process.returncode is None:
            logging.info(f"Cleaning up engine process (PID: {engine_process.pid}).")
            try:
                # Send 'quit' command
                if engine_process.stdin and not engine_process.stdin.is_closing():
                    logging.info("Sending 'quit' command to engine.")
                    engine_process.stdin.write(b'quit\n')
                    await engine_process.stdin.drain()
                
                # Wait for engine to exit
                await asyncio.wait_for(engine_process.wait(), timeout=8.0)
                logging.info(f"Engine process (PID: {engine_process.pid}) exited gracefully.")

            except (BrokenPipeError, ConnectionResetError):
                logging.warning("Engine stdin pipe already closed, could not send 'quit'.")
            except asyncio.TimeoutError:
                logging.warning(f"Engine did not exit after 'quit' command. Terminating.")
                try:
                    engine_process.terminate()
                    await asyncio.wait_for(engine_process.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    logging.warning(f"Engine process (PID: {engine_process.pid}) did not terminate gracefully, killing.")
                    engine_process.kill()
            except ProcessLookupError:
                pass

        if client_writer and not client_writer.is_closing():
            client_writer.close()
            await client_writer.wait_closed()
        
        logging.info(f"Client disconnected from {peername}.")


async def main():
    server = await asyncio.start_server(handle_client, HOST, PORT)
    addrs = ', '.join(str(sock.getsockname()) for sock in server.sockets)
    logging.info(f"Single-port engine wrapper server listening on {addrs}")
    logging.info(f"Engine paths will be loaded from {script_dir / '.env'}")
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Server is shutting down.")