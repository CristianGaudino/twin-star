import { InputState } from "./input";
import {
  CARGO_CAPACITY,
  CRUISE_DRAG,
  CRUISE_TURN_RATE,
  MAX_HULL,
  RCS_DRAG,
  SHIP_THRUST_ACCEL,
} from "./constants";
import { CHARGE_MAX_CARRIED } from "./constants";
import { ToolId } from "./tools";
import { Vec2, add, angleDelta, clamp, fromAngle, scale, sub, v2 } from "./vec2";

export type MoveMode = "cruise" | "rcs";

export class Ship {
  pos: Vec2;
  vel: Vec2 = v2(0, 0);
  angle = -Math.PI / 2; // facing "up" initially
  mode: MoveMode = "cruise";

  hull = MAX_HULL;
  cargoUsed = 0;
  cargoCapacity = CARGO_CAPACITY;
  signature = 0;

  selectedTool: ToolId = "laser";
  chargesCarried = CHARGE_MAX_CARRIED;

  /** True while the drill has grappled onto a cell surface; freezes thrust entirely. */
  anchored = false;

  constructor(pos: Vec2) {
    this.pos = pos;
  }

  get isAlive() {
    return this.hull > 0;
  }

  get cargoFull() {
    return this.cargoUsed >= this.cargoCapacity;
  }

  toggleMode() {
    this.mode = this.mode === "cruise" ? "rcs" : "cruise";
  }

  /** Steers/thrusts the ship for one tick. worldMouse only matters in cruise mode (aim). */
  updateMovement(dt: number, input: InputState, worldMouse: Vec2) {
    if (this.anchored) {
      this.vel = v2(0, 0);
      return;
    }
    const thrustInput = v2(0, 0);
    const up = input.isDown("w");
    const down = input.isDown("s");
    const left = input.isDown("a");
    const right = input.isDown("d");

    if (this.mode === "cruise") {
      const toMouse = sub(worldMouse, this.pos);
      if (toMouse.x !== 0 || toMouse.y !== 0) {
        const targetAngle = Math.atan2(toMouse.y, toMouse.x);
        const delta = angleDelta(this.angle, targetAngle);
        const maxStep = CRUISE_TURN_RATE * dt;
        this.angle += clamp(delta, -maxStep, maxStep);
      }
      const forward = fromAngle(this.angle);
      const rightVec = fromAngle(this.angle + Math.PI / 2);
      if (up) {
        thrustInput.x += forward.x;
        thrustInput.y += forward.y;
      }
      if (down) {
        thrustInput.x -= forward.x;
        thrustInput.y -= forward.y;
      }
      if (right) {
        thrustInput.x += rightVec.x;
        thrustInput.y += rightVec.y;
      }
      if (left) {
        thrustInput.x -= rightVec.x;
        thrustInput.y -= rightVec.y;
      }
    } else {
      if (up) thrustInput.y -= 1;
      if (down) thrustInput.y += 1;
      if (left) thrustInput.x -= 1;
      if (right) thrustInput.x += 1;
    }

    const mag = Math.hypot(thrustInput.x, thrustInput.y);
    if (mag > 1e-6) {
      const norm = scale(thrustInput, 1 / mag);
      this.vel = add(this.vel, scale(norm, SHIP_THRUST_ACCEL * dt));
    }

    const drag = this.mode === "cruise" ? CRUISE_DRAG : RCS_DRAG;
    this.vel = scale(this.vel, Math.max(0, 1 - drag * dt));
    this.pos = add(this.pos, scale(this.vel, dt));
  }

  takeImpact(damage: number) {
    this.hull = clamp(this.hull - damage, 0, MAX_HULL);
  }

  addCargo(value: number): number {
    const room = this.cargoCapacity - this.cargoUsed;
    const taken = Math.min(room, value);
    this.cargoUsed += taken;
    return taken;
  }

  addSignature(amount: number) {
    this.signature = clamp(this.signature + amount, 0, 100);
  }

  decaySignature(dt: number, perSec: number) {
    this.signature = clamp(this.signature - perSec * dt, 0, 100);
  }
}
