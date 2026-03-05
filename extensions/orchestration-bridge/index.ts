import { connect, Socket } from "node:net";

export class OrchestrationBridge {
  private socket: Socket | null = null;
  private socketPath = "/tmp/openclaw-events.sock";
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor() {}

  public connect() {
    this.socket = connect(this.socketPath);

    this.socket.on("connect", () => {
      console.log(`[OrchestrationBridge] Connected to event socket at ${this.socketPath}`);
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.socket.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          this.handleEvent(event);
        } catch (e) {
          console.error("[OrchestrationBridge] Failed to parse event", e);
        }
      }
    });

    this.socket.on("error", (err) => {
      console.error("[OrchestrationBridge] Socket error", err.message);
    });

    this.socket.on("close", () => {
      console.log("[OrchestrationBridge] Socket closed, reconnecting...");
      this.scheduleReconnect();
    });
  }

  private handleEvent(event: any) {
    console.log(`[OrchestrationBridge] Received event: ${event.type} in domain ${event.domain}`);
    // Here we'd normally route to Pi agent loop, update gateway state, etc.
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, 5000);
    }
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

// Example usage
if (require.main === module) {
  const bridge = new OrchestrationBridge();
  bridge.connect();
}
