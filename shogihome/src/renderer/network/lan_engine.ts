type MessageHandler = (data: string) => void;
type MessageListener = (data: string) => boolean; // Return true to remove listener

export interface LanEngineInfo {
  id: string;
  name: string;
  type?: "game" | "research" | "both";
  path: string;
}

class LanEngine {
  private ws: WebSocket | null = null;
  private static instance: LanEngine;
  private onMessageHandler: MessageHandler | null = null;
  private messageListeners: MessageListener[] = [];
  private engineListCache: LanEngineInfo[] | null = null;

  private constructor() {}

  public static getInstance(): LanEngine {
    if (!LanEngine.instance) {
      LanEngine.instance = new LanEngine();
    }
    return LanEngine.instance;
  }

  connect(onMessage: MessageHandler): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log("WebSocket is already connected.");
        // Update handler even if already connected
        this.onMessageHandler = onMessage;
        resolve();
        return;
      }

      // Use the same port as the server.ts, and connect to the host serving the web page.
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}`;
      this.ws = new WebSocket(url);
      this.onMessageHandler = onMessage;

      this.ws.onopen = () => {
        console.log("WebSocket connection established");
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = event.data;

        // Process temporary listeners
        this.messageListeners = this.messageListeners.filter((listener) => !listener(data));

        if (this.onMessageHandler) {
          this.onMessageHandler(data);
        }
      };

      this.ws.onclose = () => {
        console.log("WebSocket connection closed");
        this.ws = null;
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        reject(error);
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }

  sendCommand(command: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(command);
    } else {
      console.error("WebSocket is not connected.");
    }
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  async getEngineList(): Promise<LanEngineInfo[]> {
    if (this.engineListCache) {
      return this.engineListCache;
    }

    if (!this.isConnected()) {
      // Auto connect if not connected, using a dummy handler for now
      await this.connect(() => {});
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for engine list"));
      }, 5000);

      this.messageListeners.push((data: string) => {
        try {
          const json = JSON.parse(data);
          if (json.engineList) {
            clearTimeout(timeout);
            this.engineListCache = json.engineList;
            resolve(json.engineList);
            return true; // Remove listener
          }
        } catch (e) {
          // ignore
        }
        return false; // Keep listener
      });

      this.sendCommand("get_engine_list");
    });
  }

  startEngine(engineId: string) {
    this.sendCommand(`start_engine ${engineId}`);
  }

  stopEngine() {
    this.sendCommand("stop_engine");
  }

  setOption(name: string, value?: string | number) {
    if (value !== undefined) {
      this.sendCommand(`setoption name ${name} value ${value}`);
    } else {
      this.sendCommand(`setoption name ${name}`);
    }
  }
}

export const lanEngine = LanEngine.getInstance();
