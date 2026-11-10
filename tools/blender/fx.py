# The Loft's phenomena, made in Blender (run headless):
#   blender --background --factory-startup --python tools/blender/fx.py [-- only=fire,bolt,...]
# Everything is greyscale (how much light or matter, never colour): the Loft colours it
# live in the song's own colours, so the never-orange/gold/green rules always hold.
#   fire.png      4x4 flipbook of a burst of volumetric fire and smoke (Cycles volume), for screams
#   bolt.png      2x2 branching lightning strikes (emissive curves, Cycles), for the storm's horizon
#   caustics.png  the light nets under moving water (Cycles), tileable by mirroring, for the floor's waves
#   ripple.png    4x4 flipbook of a drop hitting water (a 2D wave-equation simulation), for the rain
#   galaxy.png    a spiral galaxy seen face-on (arms, dust lanes, a glowing core; Cycles), for the far sky
import bpy, os, sys, math, random
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, '..', '..', 'assets', 'textures')
TMP = os.path.join(OUTDIR, '_tmp.png')
os.makedirs(OUTDIR, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = set(argv[0].split('=', 1)[1].split(',')) if argv and argv[0].startswith('only=') else None
want = lambda k: ONLY is None or k in ONLY

def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'BW'
    w = bpy.data.worlds.new('void'); w.use_nodes = True; sc.world = w
    for n in w.node_tree.nodes:
        if n.type == 'BACKGROUND': n.inputs['Color'].default_value = (0, 0, 0, 1); n.inputs['Strength'].default_value = 0.0
    sc.render.film_transparent = False
    return sc

def ortho_cam(sc, size, z=10.0):
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = size; cam.clip_end = 100
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    co.location = (0, 0, z); co.rotation_euler = (0, 0, 0)
    return co

def render(sc, w, h, samples):
    sc.render.resolution_x, sc.render.resolution_y = w, h; sc.cycles.samples = samples
    sc.render.filepath = TMP
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(TMP, check_existing=False)
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[:, :, 0].copy()   # rows bottom-up, as Blender stores them

def save(name, arr):
    """arr: float 0..1, rows bottom-up (Blender's order). Saved 8-bit greyscale PNG."""
    h, w = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    rgba = np.ones((h, w, 4), dtype=np.float32); a = np.clip(arr, 0, 1)
    rgba[:, :, 0] = a; rgba[:, :, 1] = a; rgba[:, :, 2] = a
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(OUTDIR, name); img.file_format = 'PNG'
    img.save()
    print(f'FX {name} {w}x{h} mean={a.mean():.3f} max={a.max():.3f}')

def atlas(frames, n):
    """frames: list of n*n arrays (same size, rows bottom-up). Frame 0 sits top-left of the atlas."""
    fh, fw = frames[0].shape
    out = np.zeros((fh * n, fw * n), dtype=np.float32)
    for i, f in enumerate(frames):
        cx, cy = i % n, i // n
        r0 = (n - 1 - cy) * fh                 # bottom-up rows: the first row of frames is the top band
        out[r0:r0 + fh, cx * fw:(cx + 1) * fw] = f
    return out

def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items(): n.inputs[k].default_value = v
    return n

# ── 1. fire: a burst of fire and smoke, 16 frames ────────────────────────────
# (Built from Blender's turbulence noise, domain-warped: a Cycles volume render averaged
# the flame's tongues away into soft puffs, so the burst is shaped directly instead.)
if want('fire'):
    from mathutils import noise as mn, Vector
    S = 256
    ys, xs = np.mgrid[0:S, 0:S]
    X = (xs / (S - 1)) * 2 - 1; Y = (ys / (S - 1)) * 2 - 1
    def fbm(x, y, z, w):
        out = np.empty(x.shape, dtype=np.float32)
        it = np.nditer([x, y, z], flags=['multi_index'])
        for a_, b_, c_ in it:
            out[it.multi_index] = mn.turbulence(Vector((float(a_), float(b_), float(c_) + w)), 5, False, noise_basis='PERLIN_ORIGINAL', amplitude_scale=0.55, frequency_scale=2.1)
        return out
    frames = []
    for i in range(16):
        k = i / 15.0                                          # 0 a fresh flare .. 1 thin smoke
        R = 0.18 + 0.68 * (k ** 0.55)                         # it billows out
        # domain warp: the flame's tongues curl
        wx = fbm(X * 1.6, Y * 1.6, np.zeros_like(X), 3.1 + k * 1.4)
        wy = fbm(X * 1.6 + 5.2, Y * 1.6 + 1.3, np.zeros_like(X), 7.7 + k * 1.4)
        Xw, Yw = X + (wx - 0.5) * 0.55, Y + (wy - 0.5) * 0.55
        r = np.hypot(Xw, Yw) / R
        t = fbm(Xw * 3.4, Yw * 3.4, np.full_like(X, 0.0), k * 2.0)        # torn edges, fine wisps
        t = (t - t.mean()) / (t.std() + 1e-6)                 # (turbulence is unbounded: normalise each frame)
        body = np.clip(1.0 - r, 0, 1)
        d = np.clip(body * 1.25 + t * 0.32 * (0.4 + body), 0, 1)
        d = d ** 1.4 * (1.0 - 0.75 * k) + 0.15 * k * body       # the fire fades and a thin smoke is left
        d *= np.clip((0.97 - np.hypot(X, Y)) / 0.2, 0, 1)      # always inside its own frame
        frames.append(d.astype(np.float32))
    f = atlas(frames, 4); f = f / max(1e-4, f.max())
    save('fire.png', f)

# ── 2. lightning: four branching strikes ─────────────────────────────────────
if want('bolt'):
    random.seed(3)
    sc = fresh(); ortho_cam(sc, 2.0)
    def strike(x0, y0, x1, y1, depth, width, objs):
        pts = [(x0, y0), (x1, y1)]
        off = 0.22
        for _ in range(7):                                # midpoint displacement: a jagged natural path
            np_ = [pts[0]]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                mx, my = (ax + bx) / 2, (ay + by) / 2
                dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1
                s = random.gauss(0, off) * L
                np_ += [(mx - dy / L * s, my + dx / L * s), (bx, by)]
            pts = np_; off *= 0.62
        cu = bpy.data.curves.new('b', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = width; cu.bevel_resolution = 2
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for p, (x, y) in zip(sp.points, pts): p.co = (x, y, 0, 1)
        ob = bpy.data.objects.new('b', cu); sc.collection.objects.link(ob); objs.append(ob)
        if depth > 0:                                     # branches fork off and fade thinner
            for _ in range(random.randint(1, 3)):
                j = random.randint(len(pts) // 5, len(pts) * 4 // 5)
                bx, by = pts[j]; ang = random.uniform(-1.1, 1.1); L = random.uniform(0.25, 0.6) * (y0 - y1)
                strike(bx, by, bx + math.sin(ang) * L, by - abs(math.cos(ang)) * L, depth - 1, width * 0.55, objs)
    mat = bpy.data.materials.new('bolt'); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 6.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    frames = []
    for i in range(4):
        for o in list(sc.collection.objects):
            if o.type == 'CURVE': bpy.data.objects.remove(o)
        objs = []
        strike(random.uniform(-0.15, 0.15), 0.98, random.uniform(-0.3, 0.3), -0.98, 2, 0.006, objs)
        for o in objs: o.data.materials.append(mat)
        img = render(sc, 512, 512, 16)
        # the glow around the channel (a soft halo, as air ionises)
        from numpy.fft import fft2, ifft2
        yy, xx = np.mgrid[-256:256, -256:256]; g = np.exp(-(xx ** 2 + yy ** 2) / (2 * 9.0 ** 2)); g = np.fft.ifftshift(g / g.sum())
        halo = np.real(ifft2(fft2(img) * fft2(g)))
        frames.append(np.clip(img + halo * 3.0, 0, 1))
    save('bolt.png', atlas(frames, 2))

# ── 3. caustics: light through rippling water, onto a floor ─────────────────
if want('caustic'):
    sc = fresh(); ortho_cam(sc, 4.0)
    bpy.ops.mesh.primitive_plane_add(size=4.0); pl = bpy.context.active_object
    mat = bpy.data.materials.new('c'); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); tc = nt.nodes.new('ShaderNodeTexCoord')
    warp = node(nt, 'ShaderNodeTexNoise', Scale=1.4, Detail=3.0); nt.links.new(tc.outputs['Object'], warp.inputs['Vector'])
    mix = nt.nodes.new('ShaderNodeVectorMath'); mix.operation = 'MULTIPLY_ADD'; mix.inputs[1].default_value = (0.35, 0.35, 0.35)
    nt.links.new(warp.outputs['Color'], mix.inputs[0]); nt.links.new(tc.outputs['Object'], mix.inputs[2])
    layers = []
    for sc_ in (3.2, 5.1):
        v = node(nt, 'ShaderNodeTexVoronoi', Scale=sc_); v.feature = 'DISTANCE_TO_EDGE'
        nt.links.new(mix.outputs['Vector'], v.inputs['Vector'])
        r = node(nt, 'ShaderNodeMapRange'); r.inputs['From Min'].default_value = 0.0; r.inputs['From Max'].default_value = 0.09
        r.inputs['To Min'].default_value = 1.0; r.inputs['To Max'].default_value = 0.0
        nt.links.new(v.outputs['Distance'], r.inputs['Value']); layers.append(r)
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MAXIMUM'
    nt.links.new(layers[0].outputs['Result'], mul.inputs[0]); nt.links.new(layers[1].outputs['Result'], mul.inputs[1])
    pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 2.2
    nt.links.new(mul.outputs[0], pw.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(pw.outputs[0], em.inputs['Strength'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface']); pl.data.materials.append(mat)
    save('caustics.png', render(sc, 1024, 1024, 16))

# ── 4. ripple: a raindrop hitting water, a real wave-equation simulation ─────
if want('ripple'):
    N, steps = 192, 16
    u = np.zeros((N, N)); up = np.zeros((N, N))
    yy, xx = np.mgrid[0:N, 0:N] - N / 2
    u -= 1.2 * np.exp(-(xx ** 2 + yy ** 2) / (2 * 2.2 ** 2))        # the drop's impact: a sharp dent
    up[:] = u
    c2, damp = 0.24, 0.996
    frames = []
    per = 9                                                         # simulation steps per frame
    for f in range(steps):
        for _ in range(per):
            lap = np.roll(u, 1, 0) + np.roll(u, -1, 0) + np.roll(u, 1, 1) + np.roll(u, -1, 1) - 4 * u
            un = (2 * u - up + c2 * lap) * damp
            un[0, :] = un[-1, :] = un[:, 0] = un[:, -1] = 0          # open water: the edges stay still
            up, u = u, un
        # brightness of the light on the rings: the surface's slope (how the water bends the light)
        gy, gx = np.gradient(u)
        frames.append(np.hypot(gx, gy))
    m = max(fr.max() for fr in frames)
    frames = [np.clip(fr / m * 1.6, 0, 1) for fr in frames]
    save('ripple.png', atlas(frames, 4))

# ── 5. galaxy: a spiral galaxy, face-on ──────────────────────────────────────
if want('galaxy'):
    sc = fresh(); ortho_cam(sc, 2.2)
    bpy.ops.mesh.primitive_plane_add(size=2.2); pl = bpy.context.active_object
    mat = bpy.data.materials.new('g'); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    # polar coordinates, computed in a small script-free node chain
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sep.inputs['Vector'])
    r = nt.nodes.new('ShaderNodeVectorMath'); r.operation = 'LENGTH'; nt.links.new(tc.outputs['Object'], r.inputs[0])
    th = nt.nodes.new('ShaderNodeMath'); th.operation = 'ARCTAN2'
    nt.links.new(sep.outputs['Y'], th.inputs[0]); nt.links.new(sep.outputs['X'], th.inputs[1])
    lr = nt.nodes.new('ShaderNodeMath'); lr.operation = 'LOGARITHM'; lr.inputs[1].default_value = 2.718
    rr = nt.nodes.new('ShaderNodeMath'); rr.operation = 'MAXIMUM'; rr.inputs[1].default_value = 0.01
    nt.links.new(r.outputs['Value'], rr.inputs[0]); nt.links.new(rr.outputs[0], lr.inputs[0])
    # two logarithmic arms: sin(2θ - k ln r), turned into soft ridges
    k = nt.nodes.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = -5.5; nt.links.new(lr.outputs[0], k.inputs[0])
    t2 = nt.nodes.new('ShaderNodeMath'); t2.operation = 'MULTIPLY_ADD'; t2.inputs[1].default_value = 2.0
    nt.links.new(th.outputs[0], t2.inputs[0]); nt.links.new(k.outputs[0], t2.inputs[2])
    # the arms are clumpy: noise warps the phase
    nz = node(nt, 'ShaderNodeTexNoise', Scale=6.0, Detail=10.0, Roughness=0.6); nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    wp = nt.nodes.new('ShaderNodeMath'); wp.operation = 'MULTIPLY_ADD'; wp.inputs[1].default_value = 1.6
    nt.links.new(nz.outputs['Fac'], wp.inputs[0]); nt.links.new(t2.outputs[0], wp.inputs[2])
    sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'; nt.links.new(wp.outputs[0], sn.inputs[0])
    arm = node(nt, 'ShaderNodeMapRange'); arm.inputs['From Min'].default_value = 0.55; arm.inputs['From Max'].default_value = 1.0
    nt.links.new(sn.outputs[0], arm.inputs['Value'])
    # stars in the arms (fine noise), dust lanes along their inner edges
    st = node(nt, 'ShaderNodeTexNoise', Scale=60.0, Detail=4.0); nt.links.new(tc.outputs['Object'], st.inputs['Vector'])
    stc = node(nt, 'ShaderNodeMapRange'); stc.inputs['From Min'].default_value = 0.5; stc.inputs['From Max'].default_value = 0.75
    nt.links.new(st.outputs['Fac'], stc.inputs['Value'])
    body = nt.nodes.new('ShaderNodeMath'); body.operation = 'MULTIPLY_ADD'; body.inputs[1].default_value = 0.55
    nt.links.new(stc.outputs['Result'], body.inputs[0]); nt.links.new(arm.outputs['Result'], body.inputs[2])
    a2 = nt.nodes.new('ShaderNodeMath'); a2.operation = 'MULTIPLY'; nt.links.new(arm.outputs['Result'], a2.inputs[0]); nt.links.new(body.outputs[0], a2.inputs[1])
    # fades out with radius; a bright bulge at the heart
    fall = node(nt, 'ShaderNodeMapRange'); fall.inputs['From Min'].default_value = 0.15; fall.inputs['From Max'].default_value = 1.0
    fall.inputs['To Min'].default_value = 1.0; fall.inputs['To Max'].default_value = 0.0
    nt.links.new(r.outputs['Value'], fall.inputs['Value'])
    disk = nt.nodes.new('ShaderNodeMath'); disk.operation = 'MULTIPLY'; nt.links.new(a2.outputs[0], disk.inputs[0]); nt.links.new(fall.outputs['Result'], disk.inputs[1])
    bul = nt.nodes.new('ShaderNodeMath'); bul.operation = 'MULTIPLY'; bul.inputs[1].default_value = -30.0
    sq = nt.nodes.new('ShaderNodeMath'); sq.operation = 'POWER'; sq.inputs[1].default_value = 2.0; nt.links.new(r.outputs['Value'], sq.inputs[0])
    nt.links.new(sq.outputs[0], bul.inputs[0])
    ex = nt.nodes.new('ShaderNodeMath'); ex.operation = 'EXPONENT'; nt.links.new(bul.outputs[0], ex.inputs[0])
    tot = nt.nodes.new('ShaderNodeMath'); tot.operation = 'MULTIPLY_ADD'; tot.inputs[1].default_value = 1.4
    nt.links.new(ex.outputs[0], tot.inputs[0]); nt.links.new(disk.outputs[0], tot.inputs[2])
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(tot.outputs[0], em.inputs['Strength'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface']); pl.data.materials.append(mat)
    save('galaxy.png', render(sc, 1024, 1024, 32))

if os.path.exists(TMP): os.remove(TMP)
print('FX done')
