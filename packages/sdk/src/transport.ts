import type { WireFrame } from "@collab/protocol";

export type FrameHandler = (frame: WireFrame) => void;
export type CloseHandler = (reason: string) => void;

/** Abstract duplex transport for Collab frames */
export interface Transport {
  connect(timeoutMs?: number): Promise<void>;
  send(frame: WireFrame): void;
  onFrame(handler: FrameHandler): void;
  onClose(handler: CloseHandler): void;
  close(reason?: string): void;
  readonly connected: boolean;
}
