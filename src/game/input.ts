export class InputState {
  private keysDown = new Set<string>();
  private justPressedKeys = new Set<string>();
  mouseScreen = { x: 0, y: 0 };
  mouseDown = false;
  mouseJustPressed = false;
  mouseRightJustPressed = false;

  private canvas: HTMLCanvasElement;
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (!this.keysDown.has(key)) this.justPressedKeys.add(key);
    this.keysDown.add(key);
    if (["tab", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.key.toLowerCase());
  };
  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDown = true;
      this.mouseJustPressed = true;
    } else if (e.button === 2) {
      this.mouseRightJustPressed = true;
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };
  private onContextMenu = (e: MouseEvent) => e.preventDefault();
  private onBlur = () => {
    this.keysDown.clear();
    this.mouseDown = false;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("blur", this.onBlur);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("blur", this.onBlur);
  }

  isDown(key: string): boolean {
    return this.keysDown.has(key);
  }

  /** True only on the frame the key transitioned from up to down. Call once per frame per key. */
  wasJustPressed(key: string): boolean {
    return this.justPressedKeys.has(key);
  }

  /** Clear per-frame "just pressed" edges. Call once at the end of every update. */
  endFrame() {
    this.justPressedKeys.clear();
    this.mouseJustPressed = false;
    this.mouseRightJustPressed = false;
  }
}
