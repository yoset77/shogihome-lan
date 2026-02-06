import io
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser

import customtkinter as ctk
import pystray
import qrcode
from PIL import Image
from pystray import MenuItem

from common import BASE_DIR, is_frozen, kill_proc_tree, load_env_value

# --- Configuration ---
APP_NAME = "ShogiHome LAN"

# Determine execution mode (Source or Frozen/Compiled)
IS_FROZEN = is_frozen()

if IS_FROZEN:
    # Exe location (Distribution root)
    ICON_PATH = BASE_DIR / "icon.png"  # Assuming icon is copied next to exe

    SERVER_ENV_PATH = BASE_DIR / "shogihome" / ".env"
    WRAPPER_ENV_PATH = BASE_DIR / "engine-wrapper" / ".env"
else:
    # Script location (engine-wrapper/)
    # Fallback to dev icon path
    ICON_PATH = BASE_DIR.parent / "shogihome" / "public" / "favicon.png"

    SERVER_ENV_PATH = BASE_DIR.parent / "shogihome" / ".env"
    WRAPPER_ENV_PATH = BASE_DIR / ".env"

SERVER_PORT = load_env_value(SERVER_ENV_PATH, "PORT", 8140)
WRAPPER_PORT = load_env_value(WRAPPER_ENV_PATH, "LISTEN_PORT", 4082)

# Paths to executables/scripts
if IS_FROZEN:
    SERVER_EXE = BASE_DIR / "shogihome" / "shogihome-server.exe"
    WRAPPER_EXE = BASE_DIR / "engine-wrapper" / "engine_wrapper.exe"
    CONFIG_EXE = BASE_DIR / "engine-wrapper" / "config_editor.exe"
else:
    # Development paths (using npm/python commands)
    SERVER_DIR = BASE_DIR.parent / "shogihome"
    WRAPPER_DIR = BASE_DIR

# Global state
server_process = None
wrapper_process = None
is_running = False
tray_icon = None
window = None

ctk.set_appearance_mode("System")
ctk.set_default_color_theme("blue")


def get_local_ip():
    try:
        # Connect to a public DNS server to determine the most likely LAN IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


class LauncherApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title(APP_NAME)
        self.geometry("400x540")
        self.resizable(False, False)

        # Handle window close (minimize to tray)
        self.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)

        # Header
        self.header_frame = ctk.CTkFrame(self)
        self.header_frame.pack(fill="x", padx=10, pady=10)

        self.title_label = ctk.CTkLabel(self.header_frame, text=APP_NAME, font=("Roboto", 20, "bold"))
        self.title_label.pack(side="left", padx=10)

        self.status_indicator = ctk.CTkLabel(self.header_frame, text="● Stopped", text_color="red", font=("Roboto", 14))
        self.status_indicator.pack(side="right", padx=10)

        # Footer (Stop button) - Pack first to reserve bottom space
        self.btn_stop = ctk.CTkButton(
            self,
            text="Stop & Exit",
            command=self.quit_app,
            height=40,
            font=("Roboto", 14),
            fg_color="#d32f2f",
            hover_color="#b71c1c",
        )
        self.btn_stop.pack(side="bottom", fill="x", padx=20, pady=20)

        # QR Code Section
        self.qr_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.qr_frame.pack(pady=10)

        local_ip = get_local_ip()
        lan_url = f"http://{local_ip}:{SERVER_PORT}"

        qr = qrcode.QRCode(box_size=4, border=2)
        qr.add_data(lan_url)
        qr.make(fit=True)
        qr_img_wrapper = qr.make_image(fill_color="black", back_color="white")

        # Convert to standard PIL Image to satisfy CTkImage type check
        # qrcode returns a wrapper, we need to extract or convert it.
        # Saving to buffer and reloading is the most robust way.
        buf = io.BytesIO()
        qr_img_wrapper.save(buf, format="PNG")
        buf.seek(0)
        qr_img = Image.open(buf)

        # Convert to CTkImage
        self.qr_image = ctk.CTkImage(light_image=qr_img, dark_image=qr_img, size=(180, 180))
        self.qr_label = ctk.CTkLabel(self.qr_frame, image=self.qr_image, text="")
        self.qr_label.pack()

        self.lan_link = ctk.CTkLabel(
            self.qr_frame,
            text=lan_url,
            font=("Roboto", 14),
            text_color=("#0d6efd", "#4dabf7"),
            cursor="hand2",
        )
        self.lan_link.pack(pady=5)
        self.lan_link.bind("<Button-1>", lambda e: webbrowser.open(lan_url))

        # Main Actions
        self.action_frame = ctk.CTkFrame(self)
        self.action_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.action_frame.columnconfigure((0, 1), weight=1)
        self.action_frame.rowconfigure((0, 1), weight=1)

        self.btn_open = ctk.CTkButton(
            self.action_frame,
            text="Open on PC",
            command=self.open_browser,
            height=60,
            font=("Roboto", 14),
            fg_color="#1161C9",
            hover_color="#124BC5",
        )
        self.btn_open.grid(row=0, column=0, padx=10, pady=10, sticky="nsew")

        self.btn_settings = ctk.CTkButton(
            self.action_frame,
            text="Engine Settings",
            command=self.open_settings,
            height=60,
            font=("Roboto", 14),
            fg_color="#2083e6",
            hover_color="#1868b8",
        )
        self.btn_settings.grid(row=0, column=1, padx=10, pady=10, sticky="nsew")

        self.btn_restart = ctk.CTkButton(
            self.action_frame,
            text="Restart Server",
            command=self.restart_services,
            height=60,
            font=("Roboto", 14),
            fg_color="#f76b0e",
            hover_color="#f55a12",
        )
        self.btn_restart.grid(row=1, column=0, padx=10, pady=10, sticky="nsew")

        self.btn_logs = ctk.CTkButton(
            self.action_frame,
            text="Show Logs",
            command=self.open_log_viewer,
            height=60,
            font=("Roboto", 14),
            fg_color="#607d8b",
            hover_color="#455a64",
        )
        self.btn_logs.grid(row=1, column=1, padx=10, pady=10, sticky="nsew")

        # Start processes on load
        self.after(100, self.start_services)
        self.after(1000, self.check_processes)

    def minimize_to_tray(self):
        self.withdraw()

    def show_window(self):
        self.deiconify()
        self.lift()

    def update_status(self, running):
        global is_running
        is_running = running
        if running:
            self.status_indicator.configure(text="● Running", text_color="#4caf50")  # Green
            self.btn_open.configure(state="normal")
            self.btn_restart.configure(state="normal")
            self.btn_settings.configure(state="normal")
        else:
            self.status_indicator.configure(text="● Stopped", text_color="#f44336")  # Red
            self.btn_open.configure(state="disabled")
            self.btn_restart.configure(state="normal")
            self.btn_settings.configure(state="normal")

    def check_processes(self):
        global server_process, wrapper_process, is_running

        if is_running:
            # Check if any process died
            server_dead = server_process and server_process.poll() is not None
            wrapper_dead = wrapper_process and wrapper_process.poll() is not None

            if server_dead or wrapper_dead:
                self.update_status(False)
                self.status_indicator.configure(text="● Error", text_color="#f44336")

        # Schedule next check
        self.after(2000, self.check_processes)

    def start_services(self):
        global server_process, wrapper_process

        if is_running:
            return

        self.status_indicator.configure(text="⟳ Starting...", text_color="#ff9800")  # Orange
        self.btn_restart.configure(state="disabled")

        threading.Thread(target=self._run_processes, daemon=True).start()

    def _run_processes(self):
        global server_process, wrapper_process

        # Prepare logs
        log_dir = BASE_DIR / "logs"
        log_dir.mkdir(exist_ok=True)

        # Use line buffering or flush manually? Standard is fine.
        # We use "a" (append) to avoid losing logs on quick restarts during debug
        server_log = open(log_dir / "server.log", "a", encoding="utf-8")
        wrapper_log = open(log_dir / "wrapper.log", "a", encoding="utf-8")

        server_log.write(f"\n--- {time.ctime()} Starting Server ---\n")
        wrapper_log.write(f"\n--- {time.ctime()} Starting Wrapper ---\n")

        startup_info = None
        if os.name == "nt":
            startup_info = subprocess.STARTUPINFO()
            startup_info.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        # Start Wrapper
        try:
            if IS_FROZEN:
                wrapper_cmd = [str(WRAPPER_EXE)]
                cwd = WRAPPER_EXE.parent
            else:
                # Dev: use uv run
                wrapper_cmd = ["uv", "run", "engine_wrapper.py"]
                cwd = WRAPPER_DIR

            wrapper_log.write(f"Executing Wrapper: {wrapper_cmd}\nCWD: {cwd}\n")
            wrapper_log.flush()

            wrapper_process = subprocess.Popen(
                wrapper_cmd,
                cwd=str(cwd),
                stdout=wrapper_log,
                stderr=wrapper_log,
                startupinfo=startup_info,
            )
        except Exception as e:
            wrapper_log.write(f"Failed to start wrapper: {e}\n")
            wrapper_log.flush()

        # Start Server
        try:
            if IS_FROZEN:
                server_cmd = [str(SERVER_EXE)]
                cwd = SERVER_EXE.parent
            else:
                # Dev: use npm run server:start
                server_cmd = ["npm", "run", "server:start"]
                cwd = SERVER_DIR

            use_shell = not IS_FROZEN

            server_log.write(f"Executing Server: {server_cmd}\nCWD: {cwd}\n")
            server_log.flush()

            server_process = subprocess.Popen(
                server_cmd,
                cwd=str(cwd),
                stdout=server_log,
                stderr=server_log,
                shell=use_shell,
                startupinfo=startup_info,
            )
        except Exception as e:
            server_log.write(f"Failed to start server: {e}\n")
            server_log.flush()

        # Wait a fixed time to avoid port scan detection
        time.sleep(2.0)

        # Flush to ensure log viewer can read early output
        server_log.flush()
        wrapper_log.flush()

        self.after(0, lambda: self.update_status(True))

    def stop_services(self):
        global server_process, wrapper_process

        self.status_indicator.configure(text="Stopping...", text_color="#f44336")

        if server_process:
            self._kill_proc_tree(server_process)
            server_process = None
        if wrapper_process:
            self._kill_proc_tree(wrapper_process)
            wrapper_process = None

        self.update_status(False)

    def restart_services(self):
        # Run in thread to avoid freezing UI
        def _restart():
            self.after(0, lambda: self.btn_restart.configure(state="disabled", text="Restarting..."))
            self.stop_services()
            # Slight delay to ensure ports are freed
            time.sleep(1.0)
            self.after(0, self.start_services)
            self.after(0, lambda: self.btn_restart.configure(text="Restart Server"))

        threading.Thread(target=_restart, daemon=True).start()

    def open_log_viewer(self):
        log_window = ctk.CTkToplevel(self)
        log_window.title("Log Viewer")
        log_window.geometry("600x400")
        log_window.attributes("-topmost", True)

        tabview = ctk.CTkTabview(log_window)
        tabview.pack(fill="both", expand=True, padx=10, pady=10)

        tab_server = tabview.add("Server Log")
        tab_wrapper = tabview.add("Wrapper Log")

        text_server = ctk.CTkTextbox(tab_server)
        text_server.pack(fill="both", expand=True)

        text_wrapper = ctk.CTkTextbox(tab_wrapper)
        text_wrapper.pack(fill="both", expand=True)

        def refresh_logs():
            log_dir = BASE_DIR / "logs"
            try:
                if (log_dir / "server.log").exists():
                    with open(log_dir / "server.log", "r", encoding="utf-8", errors="ignore") as f:
                        text_server.delete("1.0", "end")
                        text_server.insert("1.0", f.read())
                        text_server.see("end")
                if (log_dir / "wrapper.log").exists():
                    with open(log_dir / "wrapper.log", "r", encoding="utf-8", errors="ignore") as f:
                        text_wrapper.delete("1.0", "end")
                        text_wrapper.insert("1.0", f.read())
                        text_wrapper.see("end")
            except Exception as e:
                text_server.insert("end", f"\nError reading logs: {e}")

        btn_refresh = ctk.CTkButton(log_window, text="Refresh", command=refresh_logs)
        btn_refresh.pack(pady=10)

        refresh_logs()

    def open_browser(self, auto=False):
        # Open Localhost on PC
        webbrowser.open(f"http://127.0.0.1:{SERVER_PORT}")

    def open_settings(self):
        # In frozen mode, we might want to launch config_editor.exe if not running?
        # But config_editor.py is designed to run standalone.
        # Actually, config_editor.py acts as a server.
        # Ideally, we should launch config_editor.exe and let it open browser.

        if IS_FROZEN:
            subprocess.Popen([str(CONFIG_EXE)], cwd=str(CONFIG_EXE.parent))
        else:
            cwd = WRAPPER_DIR
            subprocess.Popen(["uv", "run", "config_editor.py"], cwd=str(cwd))

    def quit_app(self):
        global tray_icon

        # UI Feedback
        self.btn_stop.configure(text="Stopping...", state="disabled")
        self.btn_restart.configure(state="disabled")
        self.btn_open.configure(state="disabled")
        self.btn_settings.configure(state="disabled")
        self.update()  # Force UI update

        self.stop_services()

        if tray_icon:
            tray_icon.stop()

        # Ensure we quit the mainloop from the main thread
        self.after(0, self.quit)

    def _kill_proc_tree(self, proc):
        # Force kill using common utility
        kill_proc_tree(proc.pid)


# --- Tray Icon ---
def setup_tray(app):
    global tray_icon

    if ICON_PATH.exists():
        image = Image.open(ICON_PATH)
    else:
        # Create dummy icon if missing
        image = Image.new("RGB", (64, 64), color=(73, 109, 137))

    menu = pystray.Menu(
        MenuItem("Open ShogiHome", lambda: app.open_browser()),
        MenuItem("Dashboard", lambda: app.show_window(), default=True),
        MenuItem("Settings", lambda: app.open_settings()),
        pystray.Menu.SEPARATOR,
        MenuItem("Exit", lambda: app.quit_app()),
    )

    tray_icon = pystray.Icon("ShogiHome LAN", image, "ShogiHome LAN", menu)
    tray_icon.run()


# --- Main ---
if __name__ == "__main__":
    app = LauncherApp()

    # Run tray in separate thread (pystray run is blocking)
    # BUT customtkinter mainloop must be in main thread.
    # And pystray requires to run in main thread on macOS, but we are on Windows.
    # On Windows, pystray can run in background thread.

    threading.Thread(target=setup_tray, args=(app,), daemon=True).start()

    # Hide window initially? Or show "Starting..." splash?
    # Let's show dashboard initially.

    app.mainloop()
    sys.exit(0)
