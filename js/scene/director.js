// Camera director. A shot is a little function of time-since-cut; the director
// cuts between them on musical boundaries (the World decides when), and layers
// kick shake, FOV punches, build-up push-ins and drop roll on top. Two rules hold
// whatever the shot: a glide between shots orbits around the core (it never flies
// through it), and the core with its halo never fills more than ~45% of the
// frame's height, however close a shot sits or a build leans in.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const MAX_CORE = 0.45;   // the core's (and halo's) share of the frame height, at most

// Glide from a to b around the origin: the direction turns along the great circle,
// the distance eases between the two. (A straight line between two shots on
// opposite sides used to pass through the core and fill the frame with it.)
const _ua = new THREE.Vector3(), _ub = new THREE.Vector3(), _ax = new THREE.Vector3();
function orbitLerp(a, b, k, out) {
  const ra = a.length(), rb = b.length();
  if (ra < 1e-3 || rb < 1e-3) return out.lerpVectors(a, b, k);
  _ua.copy(a).divideScalar(ra); _ub.copy(b).divideScalar(rb);
  const dot = Math.max(-1, Math.min(1, _ua.dot(_ub)));
  if (dot > 0.9995) return out.lerpVectors(a, b, k);
  const r = ra + (rb - ra) * k;
  if (dot < -0.9995) {                                   // opposite sides: go over the top
    _ax.crossVectors(_ua, Math.abs(_ua.y) < 0.9 ? THREE.Object3D.DEFAULT_UP : _ax.set(1, 0, 0)).normalize();
    return out.copy(_ua).applyAxisAngle(_ax, Math.PI * k).multiplyScalar(r);
  }
  const om = Math.acos(dot), so = Math.sin(om);
  return out.copy(_ua).multiplyScalar(Math.sin((1 - k) * om) / so).addScaledVector(_ub, Math.sin(k * om) / so).multiplyScalar(r);
}

const SHOTS = {
  orbit: {
    family: 'wide',
    make: (R) => ({ a0: R() * TAU, dir: R() < 0.5 ? -1 : 1, r: 13 + R() * 5, h: 0.5 + R() * 3.5, sp: 0.07 + R() * 0.06 }),
    at(u, p, o) {
      const a = p.a0 + u * p.sp * p.dir;
      o.pos.set(Math.cos(a) * p.r, p.h + Math.sin(u * 0.35) * 0.6, Math.sin(a) * p.r);
      o.look.set(0, 0, 0); o.fov = 48;
    },
  },
  close: {
    family: 'wide',
    make: (R) => ({ a0: R() * TAU, dir: R() < 0.5 ? -1 : 1, r: 7 + R() * 2, h: R() * 1.6, sp: 0.16 + R() * 0.14 }),
    at(u, p, o) {
      const a = p.a0 + u * p.sp * p.dir;
      o.pos.set(Math.cos(a) * p.r, p.h, Math.sin(a) * p.r);
      o.look.set(0, 0.3, 0); o.fov = 56;
    },
  },
  crane: {
    family: 'wide',
    make: (R) => ({ a0: R() * TAU, r: 11 + R() * 3, up: R() < 0.6 }),
    at(u, p, o) {
      const k = ease(u / 9), y = p.up ? -2 + k * 12 : 10 - k * 12, a = p.a0 + u * 0.05;
      o.pos.set(Math.cos(a) * p.r, y, Math.sin(a) * p.r);
      o.look.set(0, 0, 0); o.fov = 50;
    },
  },
  top: {
    family: 'wide',
    make: (R) => ({ a0: R() * TAU, dir: R() < 0.5 ? -1 : 1, h: 18 + R() * 6 }),
    at(u, p, o) {
      const a = p.a0 + u * 0.1 * p.dir;
      o.pos.set(Math.cos(a) * 2.5, p.h - u * 0.25, Math.sin(a) * 2.5);
      o.look.set(0, -1, 0); o.fov = 58;
    },
  },
  dolly: {
    family: 'wide',
    make: (R) => ({ a0: R() * TAU, h: R() * 2 - 0.5, far: 18 + R() * 4 }),
    at(u, p, o) {
      const d = p.far + (7.5 - p.far) * (1 - Math.exp(-u * 0.22));
      o.pos.set(Math.cos(p.a0) * d, p.h, Math.sin(p.a0) * d);
      o.look.set(0, 0, 0); o.fov = 46;
    },
  },
  fly: {
    // A flyby that skims around the core, banking as it goes.
    family: 'wide',
    make: (R) => ({ a0: R() * TAU, b0: R() * TAU, dir: R() < 0.5 ? -1 : 1 }),
    at(u, p, o) {
      const a = p.a0 + u * 0.32 * p.dir, r = 11 + Math.sin(u * 0.4 + p.b0) * 1.5;
      o.pos.set(Math.cos(a) * r, Math.sin(u * 0.23 + p.b0) * 2.6 + 0.5, Math.sin(a) * r);
      o.look.set(0, 0, 0);
      o.fov = 64;
    },
  },
  // Awe: far back inside the room, slowly circling, the core a lone star in the dark.
  vast: {
    family: 'vast',
    make: (R) => ({ a0: R() * TAU, dir: R() < 0.5 ? -1 : 1, r: 20 + R() * 2.5, h: 2.5 + R() * 2 }),   // low enough (with its sway, 14° down at most against a 17° half-view) that the horizon always shows
    at(u, p, o) {
      const a = p.a0 + u * 0.025 * p.dir;
      o.pos.set(Math.cos(a) * p.r, p.h + Math.sin(u * 0.08) * 0.5, Math.sin(a) * p.r);
      o.look.set(0, 0, 0); o.fov = 34;
    },
  },
};

export class Director {
  constructor(camera) {
    this.camera = camera;
    this.R = Math.random;
    this.shot = null; this.params = null; this.u = 0;
    this.o = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
    this.blend = 0; this.blendDur = 0;
    this.shake = 0; this.punch = 0; this.roll = 0; this.t = 0;
    this._look = new THREE.Vector3();
        this.minD = 0;   // how close the core lets the camera come (eased)
    this.cut('orbit');
    this.update(0); // place the camera now, so the first glide starts from a real shot
  }

  get family() { return this.shot ? SHOTS[this.shot].family : null; }

  // A shot by name, or any of a family ('wide', 'vast'). blend > 0 glides instead of cutting.
  cut(nameOrFamily = 'wide', blend = 0) {
    let name = nameOrFamily;
    if (!SHOTS[name]) {
      const pool = Object.keys(SHOTS).filter((k) => SHOTS[k].family === nameOrFamily && k !== this.shot);
      name = pool.length ? pool[Math.floor(this.R() * pool.length)] : this.shot || 'orbit';
    }
    if (blend > 0) {
      this.from.pos.copy(this.camera.position);
      this.from.look.copy(this._look);
      this.from.fov = this.camera.fov;
    }
    this.blend = 0; this.blendDur = blend;
    this.shot = name;
    this.params = SHOTS[name].make(this.R);
    this.u = 0;
  }

  // Arrive at once: no glide from wherever the camera was, no shake (a render's first shot).
  settle() { this.blend = this.blendDur; this.shake = 0; this.punch = 0; this.roll = 0; this.minD = 0; this.t = 0; }

  kick(amount) { this.shake = Math.min(1.5, this.shake + amount); this.punch = Math.min(6, this.punch + amount * 3); }

  // coreR: the core's visible radius with its halo (world units).
  // pace: how fast the shot itself moves (the part's and the feeling's tempo).
  update(dt, { build = 0, level = 0, time = 0, coreR = 0, pace = 1 } = {}) {
    this.t += dt; this.u += dt * pace;
    const o = this.o;
    SHOTS[this.shot].at(this.u, this.params, o);

    // Curiosity: over each shot the camera creeps toward the singularity, as if leaning
    // in to understand it; and it is held by someone breathing, never on a rail.
    o.pos.lerp(o.look, Math.min(0.14, this.u * 0.006));
    const bt = this.t;
    o.pos.x += Math.sin(bt * 0.31) * 0.22 + Math.sin(bt * 0.73 + 1.3) * 0.08;
    o.pos.y += Math.sin(bt * 0.27 + 2.1) * 0.16 + Math.sin(bt * 0.61) * 0.05;
    o.pos.z += Math.sin(bt * 0.23 + 0.7) * 0.22;
    o.look.x += Math.sin(bt * 0.19 + 0.4) * 0.12; o.look.y += Math.sin(bt * 0.21 + 1.7) * 0.1;
    // Build-up: lean in and tighten before the drop.
    if (build > 0) {
      o.pos.lerp(o.look, 0.32 * ease(build));
      o.fov -= 9 * build;
    }
    const cam = this.camera;
    if (this.blendDur > 0 && this.blend < this.blendDur) {
      this.blend += dt;
      const k = ease(this.blend / this.blendDur);
      orbitLerp(this.from.pos, o.pos, k, cam.position);
      this._look.lerpVectors(this.from.look, o.look, k);
      cam.fov = this.from.fov + (o.fov - this.from.fov) * k;
    } else {
      cam.position.copy(o.pos);
      this._look.copy(o.look);
      cam.fov = o.fov;
    }

    // The core keeps its place in the composition: never closer than the distance
    // at which it (with its halo) fills MAX_CORE of the frame. Eased, so a drop's
    // flare makes the camera recoil instead of jump.
    if (coreR > 0) {
      const tanH = Math.tan((cam.fov * Math.PI) / 360);
      const need = coreR / (MAX_CORE * tanH);
      this.minD += (need - this.minD) * Math.min(1, dt * (need > this.minD ? 10 : 2));
      const d = cam.position.length();
      if (d < this.minD && d > 1e-3) cam.position.multiplyScalar(this.minD / d);
    }
    // The camera stays inside the wall of bars (radius 25): no shot or glide passes through it.
    const hd = Math.hypot(cam.position.x, cam.position.z);
    if (hd > 22) { cam.position.x *= 22 / hd; cam.position.z *= 22 / hd; }
    // Never skim the floor (y -4.2): seen edge-on its grid fades out and the ground reads as empty blue haze.
    if (cam.position.y < -2.2) cam.position.y = -2.2;


    // Kick shake (decays fast), FOV punch, drop roll.
    this.shake *= Math.exp(-dt * 9);
    this.punch *= Math.exp(-dt * 7);
    const s = this.shake * 0.05, tt = this.t * 17;   // a small, smooth shake: a big fast one made the near floor lines jitter
    cam.position.x += Math.sin(tt * 1.3) * s;
    cam.position.y += Math.sin(tt * 1.7 + 1.1) * s;
    cam.position.z += Math.sin(tt * 1.1 + 2.3) * s;
    cam.fov -= this.punch;
    cam.lookAt(this._look);
    const rollTarget = level >= 3 ? Math.sin(time * 0.6) * 0.06 : 0;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 2);
    cam.rotateZ(this.roll);
    cam.updateProjectionMatrix();
  }
}
