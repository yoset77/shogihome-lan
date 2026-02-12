import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

from common import BASE_DIR

# Configuration
PORT = 0  # 0 means random available port
BIND_ADDRESS = "127.0.0.1"


# --- Path Resolution Logic ---

# 1. Search for engines.json
ENGINES_JSON_PATH = BASE_DIR / "engines.json"

# 2. Search for config_editor.html
HTML_PATH = BASE_DIR / "config_editor.html"

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")


def parse_usi_option_line(line):
    """
    Parse a single USI 'option' line.
    format: option name <Name> type <Type> [default <Default>] [min <Min>] [max <Max>] [var <Var>]...
    """
    if not line.startswith("option"):
        return None, None

    parts = line.split()

    # Helper to find value between keywords
    def get_value(start_keyword, current_parts, end_keywords=None):
        if start_keyword not in current_parts:
            return None
        start_idx = current_parts.index(start_keyword) + 1

        end_idx = len(current_parts)
        if end_keywords:
            for kw in end_keywords:
                if kw in current_parts[start_idx:]:
                    # Find the first occurrence of any end keyword after start_idx
                    idx = current_parts.index(kw, start_idx)
                    if idx < end_idx:
                        end_idx = idx

        return " ".join(current_parts[start_idx:end_idx])

    # Keywords that start a new field
    keywords = ["name", "type", "default", "min", "max", "var"]

    try:
        name = get_value("name", parts, keywords)
        opt_type = get_value("type", parts, keywords)

        if not name or not opt_type:
            return None, None

        opt_def = {"type": opt_type}

        default_val = get_value("default", parts, keywords)
        if default_val == "<empty>":
            default_val = ""
        if default_val is not None:
            opt_def["default"] = default_val

        # Type specific handling
        if opt_type == "check":
            opt_def["default"] = default_val == "true"
        elif opt_type == "spin":
            opt_def["min"] = int(get_value("min", parts, keywords) or 0)
            opt_def["max"] = int(get_value("max", parts, keywords) or 1000000)
            try:
                opt_def["default"] = int(default_val)
            except (ValueError, TypeError):
                opt_def["default"] = opt_def["min"]
        elif opt_type == "combo":
            # 'var' can appear multiple times
            vars = []
            curr_idx = 0
            while "var" in parts[curr_idx:]:
                var_idx = parts.index("var", curr_idx)
                # End of this var is next keyword or EOL
                next_kw_idx = len(parts)
                for kw in keywords:
                    if kw == "var":
                        continue  # skip self
                    if kw in parts[var_idx + 1 :]:
                        idx = parts.index(kw, var_idx + 1)
                        if idx < next_kw_idx:
                            next_kw_idx = idx

                # Also check for next 'var'
                if "var" in parts[var_idx + 1 :]:
                    idx = parts.index("var", var_idx + 1)
                    if idx < next_kw_idx:
                        next_kw_idx = idx

                val = " ".join(parts[var_idx + 1 : next_kw_idx])
                vars.append(val)
                curr_idx = next_kw_idx

            opt_def["vars"] = vars

        return name, opt_def

    except ValueError:
        return None, None


class ConfigEditorHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress logging to stderr to prevent crashes in no-console mode
        pass

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/":
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.end_headers()
            if HTML_PATH.exists():
                with open(HTML_PATH, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.wfile.write(b"Error: config_editor.html not found.")
            return

        if parsed.path == "/api/load":
            self.handle_load()
            return

        # Serve static files if needed, or 404
        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/save":
            self.handle_save()
            return

        if parsed.path == "/api/analyze":
            self.handle_analyze()
            return

        if parsed.path == "/api/browse":
            self.handle_browse()
            return

        if parsed.path == "/api/shutdown":
            self.handle_shutdown()
            return

        self.send_error(404)

    def handle_browse(self):
        try:
            import tkinter as tk
            from tkinter import filedialog

            # Create a root window but hide it
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)  # Bring to front

            file_path = filedialog.askopenfilename(
                title="エンジン実行ファイルを選択",
                filetypes=[("Executable", "*.exe"), ("All Files", "*.*")],
            )

            root.destroy()

            if file_path:
                # Normalize path
                file_path = str(Path(file_path).resolve())
                self.send_json({"status": "ok", "path": file_path})
            else:
                self.send_json({"status": "cancel"})

        except Exception as e:
            self.send_error_json(str(e))

    def handle_shutdown(self):
        self.send_json({"status": "ok", "message": "Server shutting down..."})

        # Schedule shutdown
        def kill_server():
            print("Shutdown requested via API. Exiting.")
            os._exit(0)

        threading.Timer(0.5, kill_server).start()

    def handle_load(self):
        try:
            if ENGINES_JSON_PATH.exists():
                with open(ENGINES_JSON_PATH, "r", encoding="utf-8") as f:
                    engines_data = json.load(f)
            else:
                engines_data = []  # Return empty array if not exists

            self.send_json({"engines": engines_data, "os": os.name})
        except Exception as e:
            self.send_error_json(str(e))

    def handle_save(self):
        try:
            length = int(self.headers["Content-Length"])
            body = self.rfile.read(length).decode("utf-8")
            data = json.loads(body)

            # Basic validation
            if not isinstance(data, list):
                raise ValueError("Root must be a list")

            # Write to file
            with open(ENGINES_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            self.send_json({"status": "ok"})
        except Exception as e:
            self.send_error_json(str(e))

    def handle_analyze(self):
        try:
            length = int(self.headers["Content-Length"])
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body)
            path_str = payload.get("path")

            if not path_str:
                raise ValueError("Path is required")

            # Resolve path and prevent path traversal
            # Use resolve() to get absolute path and handle symlinks/..
            try:
                engine_path = Path(path_str).expanduser()
                if not engine_path.is_absolute():
                    engine_path = (BASE_DIR / engine_path).resolve()
                else:
                    engine_path = engine_path.resolve()
            except Exception as e:
                raise ValueError(f"Invalid path format: {e}") from e

            # Basic validation: must exist and be a file
            if not engine_path.exists():
                raise FileNotFoundError(f"Engine not found at: {engine_path}")
            if not engine_path.is_file():
                raise ValueError(f"Path is not a file: {engine_path}")

            # Run engine and get USI options
            options = self.get_usi_options(engine_path)
            self.send_json({"status": "ok", "options": options})

        except Exception as e:
            self.send_error_json(str(e))

    def get_usi_options(self, engine_path):
        """
        Run engine, send 'usi', wait for 'usiok', parse 'option' lines.
        Returns a dict of option definitions.
        """
        import queue

        # Start process
        cwd = engine_path.parent
        proc = None

        # Suppress console window on Windows
        startupinfo = None
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        try:
            proc = subprocess.Popen(
                [str(engine_path)],
                cwd=str(cwd),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
                startupinfo=startupinfo,
            )
        except Exception as e:
            raise RuntimeError(f"Failed to start engine: {e}") from e

        options = {}

        try:
            # Threaded reader to prevent blocking on readline
            q = queue.Queue()

            def reader_thread():
                try:
                    for line in proc.stdout:
                        q.put(line)
                    proc.stdout.close()
                except Exception:
                    pass

            t = threading.Thread(target=reader_thread, daemon=True)
            t.start()

            if proc.stdin:
                try:
                    proc.stdin.write("usi\n")
                    proc.stdin.flush()
                except OSError:
                    pass

            # Read with timeout
            start_time = time.time()
            timeout_sec = 5.0

            while True:
                remaining = timeout_sec - (time.time() - start_time)
                if remaining <= 0:
                    raise TimeoutError("Engine USI response timed out")

                try:
                    line = q.get(timeout=remaining)
                except queue.Empty as e:
                    raise TimeoutError("Engine USI response timed out") from e

                line = line.strip()
                if line == "usiok":
                    break

                if line.startswith("option"):
                    name, opt_def = parse_usi_option_line(line)
                    if name and opt_def:
                        options[name] = opt_def

            # Send quit
            if proc.stdin:
                try:
                    proc.stdin.write("quit\n")
                    proc.stdin.flush()
                except OSError:
                    pass

            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()

        except Exception as e:
            if proc:
                proc.kill()
            raise e
        finally:
            if proc and proc.poll() is None:
                proc.kill()

        return options

    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def send_error_json(self, message):
        self.send_response(500)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode("utf-8"))


def run_server(port=0, no_browser=False):
    # Bind to localhost only for security
    with socketserver.TCPServer((BIND_ADDRESS, port), ConfigEditorHandler) as httpd:
        actual_port = httpd.server_address[1]
        url = f"http://{BIND_ADDRESS}:{actual_port}"
        print(f"Serving Config Editor at {url}")

        if not no_browser:
            # Open browser
            threading.Timer(0.5, lambda: webbrowser.open(url)).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ShogiHome Engine Config Editor")
    parser.add_argument("--port", type=int, default=0, help="Port to bind to")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically")
    args = parser.parse_args()

    run_server(port=args.port, no_browser=args.no_browser)
