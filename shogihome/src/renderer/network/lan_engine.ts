type MessageHandler = (data: string) => void;

class LanEngine {
  private ws: WebSocket | null = null;
  private static instance: LanEngine;
  private onMessageHandler: MessageHandler | null = null;

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
        if (this.onMessageHandler) {
          this.onMessageHandler(event.data);
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

  startResearchEngine() {
    this.sendCommand("start_research_engine");
  }

  startGameEngine() {
    this.sendCommand("start_game_engine");
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
