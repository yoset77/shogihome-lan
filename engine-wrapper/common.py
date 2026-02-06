import os
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values


def is_frozen():
    """判定: 実行ファイル形式（Nuitka/PyInstaller）で動いているか"""
    return getattr(sys, "frozen", False) or "__compiled__" in globals()


def get_base_dir():
    """実行ファイルまたはスクリプトが存在するディレクトリを返す"""
    if is_frozen():
        return Path(sys.argv[0]).resolve().parent
    return Path(__file__).resolve().parent


# 各スクリプトからの相対パスの起点となるディレクトリ
BASE_DIR = get_base_dir()


def load_env_value(env_path, key, default):
    """指定した.envファイルから値を読み込む。数値の場合はキャストを試みる"""
    if env_path.exists():
        try:
            config = dotenv_values(env_path)
            if key in config:
                val = config[key]
                if isinstance(default, int):
                    try:
                        return int(val)
                    except ValueError:
                        return default
                return val
        except Exception:
            pass
    return default


def kill_proc_tree(pid):
    """Windows環境でプロセスツリー全体を強制終了する。Unix系ではSIGKILLを送信"""
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                startupinfo=startupinfo,
            )
        except Exception:
            pass
    else:
        try:
            import signal

            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass
