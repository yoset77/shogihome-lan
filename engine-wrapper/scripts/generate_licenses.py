import subprocess
import urllib.request
import sys
from pathlib import Path

def main():
    output_dir = Path("licenses")
    output_dir.mkdir(exist_ok=True)

    # 1. Pythonライブラリのライセンス生成 (pip-licenses)
    # uv run pip-licenses ... として実行されることを想定
    print("Generating third-party licenses...")
    try:
        subprocess.run([
            "pip-licenses",
            "--format=plain-vertical",
            "--with-license-file",
            "--no-license-path",
            "--output-file", str(output_dir / "THIRD-PARTY-NOTICES.txt")
        ], check=True)
    except FileNotFoundError:
        print("Error: 'pip-licenses' not found. Please run 'uv sync' first.")
        sys.exit(1)

    # 2. Python自体のライセンス取得
    print("Downloading Python license...")
    python_license_url = "https://raw.githubusercontent.com/python/cpython/main/LICENSE"
    
    try:
        urllib.request.urlretrieve(python_license_url, output_dir / "PYTHON_LICENSE")
        print("PYTHON_LICENSE downloaded.")
    except Exception as e:
        print(f"Warning: Failed to download Python license: {e}")
        print("Please manually download LICENSE from https://www.python.org/ and place it in licenses/ folder.")

if __name__ == "__main__":
    main()
