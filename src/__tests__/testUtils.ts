import { Frame } from "../frames/base";
import { TextFrame } from "../frames/data";
import { FrameProcessor } from "../processors/base";

export class CollectorProcessor extends FrameProcessor {
  public collectedFrames: Frame[] = [];

  public async processFrame(frame: Frame): Promise<void> {
    this.collectedFrames.push(frame);
    // Don't push downstream - this is a sink/collector
  }

  public getCollected(): Frame[] {
    return this.collectedFrames;
  }

  public clear(): void {
    this.collectedFrames = [];
  }
}

export class PassthroughProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    await this.pushFrame(frame, "downstream");
  }
}

export class EchoProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    await this.pushFrame(frame, "upstream");
  }
}

export class ErrorProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame && frame.text === "ERROR") {
      throw new Error("Test error");
    }
    await this.pushFrame(frame, "downstream");
  }
}

export class UppercaseProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      const upperText = frame.text.toUpperCase();
      await this.pushFrame(new TextFrame(upperText), "downstream");
    } else {
      await this.pushFrame(frame, "downstream");
    }
  }
}

export class CollectingPassthroughProcessor extends FrameProcessor {
  public collectedFrames: Frame[] = [];

  public async processFrame(frame: Frame): Promise<void> {
    this.collectedFrames.push(frame);
    await this.pushFrame(frame, "downstream");
  }

  public getCollected(): Frame[] {
    return this.collectedFrames;
  }

  public clear(): void {
    this.collectedFrames = [];
  }
}

// Helper to wait for async operations
export const advanceTime = async (ms: number) => {
  await new Promise(resolve => setTimeout(resolve, ms));
};
