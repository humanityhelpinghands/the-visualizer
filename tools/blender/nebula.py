# The sky's nebula, rendered in Blender's Cycles (run headless):
# A real volume of glowing gas (billows, wisps, dark lanes) rendered once from the room's
# centre with a 360° camera into a greyscale map: assets/textures/nebula.png. Only the
# gas's density is baked; the Loft colours it live in the song's own colours.
import bpy, os, math

STYLE = os.environ.get('NEB_STYLE', '')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'textures', 'nebula%s.png' % ('-' + STYLE if STYLE else ''))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.device = 'CPU'
PREVIEW = bool(os.environ.get('NEB_PREVIEW'))
sc.render.resolution_x, sc.render.resolution_y = (1024, 512) if PREVIEW else ((2048, 1024) if STYLE else (4096, 2048))
if STYLE: sc.cycles.samples = 24
if PREVIEW: sc.cycles.samples = 8
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'BW'
sc.render.image_settings.color_depth = '16'
sc.view_settings.view_transform = 'Standard'
sc.world = bpy.data.worlds.new('void'); sc.world.color = (0, 0, 0)

# A shell of gas around the camera: thick in a band (the galaxy's plane), billowing, torn by dark lanes.
bpy.ops.mesh.primitive_uv_sphere_add(radius=100, segments=64, ring_count=32)
gas = bpy.context.active_object
mat = bpy.data.materials.new('gas'); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
vol = nt.nodes.new('ShaderNodeEmission')
coord = nt.nodes.new('ShaderNodeTexCoord')
# billows: large soft noise, distorted
n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 0.018; n1.inputs['Detail'].default_value = 12; n1.inputs['Roughness'].default_value = 0.62; n1.inputs['Distortion'].default_value = 1.6
# wisps: finer, sharper
n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 0.06; n2.inputs['Detail'].default_value = 15; n2.inputs['Roughness'].default_value = 0.7; n2.inputs['Distortion'].default_value = 3.0
# dark lanes
n3 = nt.nodes.new('ShaderNodeTexNoise'); n3.inputs['Scale'].default_value = 0.03; n3.inputs['Detail'].default_value = 6
for n in (n1, n2, n3): nt.links.new(coord.outputs['Object'], n.inputs['Vector'])
r1 = nt.nodes.new('ShaderNodeMapRange'); r1.inputs['From Min'].default_value = 0.56; r1.inputs['From Max'].default_value = 0.78
nt.links.new(n1.outputs['Fac'], r1.inputs['Value'])
r2 = nt.nodes.new('ShaderNodeMapRange'); r2.inputs['From Min'].default_value = 0.6; r2.inputs['From Max'].default_value = 0.82
nt.links.new(n2.outputs['Fac'], r2.inputs['Value'])
r3 = nt.nodes.new('ShaderNodeMapRange'); r3.inputs['From Min'].default_value = 0.5; r3.inputs['From Max'].default_value = 0.6; r3.inputs['To Min'].default_value = 1.0; r3.inputs['To Max'].default_value = 0.0
nt.links.new(n3.outputs['Fac'], r3.inputs['Value'])
# band: denser near the galaxy's plane (z ~ 0)
sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
band = nt.nodes.new('ShaderNodeMapRange'); band.inputs['From Min'].default_value = 0.0; band.inputs['From Max'].default_value = 38.0; band.inputs['To Min'].default_value = 1.0; band.inputs['To Max'].default_value = 0.08
ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'
nt.links.new(sep.outputs['Z'], ab.inputs[0]); nt.links.new(ab.outputs[0], band.inputs['Value'])
m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'
m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = 0.55
m3 = nt.nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'
m4 = nt.nodes.new('ShaderNodeMath'); m4.operation = 'MULTIPLY'
nt.links.new(r2.outputs['Result'], m2.inputs[0]); nt.links.new(r1.outputs['Result'], m2.inputs[2])   # billows + 0.55 * wisps
nt.links.new(m2.outputs[0], m1.inputs[0]); nt.links.new(r3.outputs['Result'], m1.inputs[1])        # torn by the lanes
nt.links.new(m1.outputs[0], m3.inputs[0]); nt.links.new(band.outputs['Result'], m3.inputs[1])      # thick in the band
dens = m3
if STYLE == 'band':
    # A thick river of gas wound round the whole horizon: every direction past the bars has some.
    band.inputs['From Max'].default_value = 16.0; band.inputs['To Max'].default_value = 0.0
    # ...its hottest strip lifted about 16 degrees above the horizon: a river just over the bars,
    # so in a level shot the core keeps a darker sky right behind it.
    lift = nt.nodes.new('ShaderNodeMath'); lift.operation = 'SUBTRACT'; lift.inputs[1].default_value = 28.0
    nt.links.new(sep.outputs['Z'], lift.inputs[0]); nt.links.new(lift.outputs[0], ab.inputs[0])
    r1.inputs['From Min'].default_value = 0.42; r2.inputs['From Min'].default_value = 0.5
elif STYLE == 'pillars':
    # Towering columns rising out of the horizon (stretched tall), dark sky between them.
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 1.0, 0.22)
    nt.links.new(coord.outputs['Object'], mp.inputs['Vector'])
    for n in (n1, n2): nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    r1.inputs['From Min'].default_value = 0.5
    rise = nt.nodes.new('ShaderNodeMapRange'); rise.inputs['From Min'].default_value = -6.0; rise.inputs['From Max'].default_value = 60.0; rise.inputs['To Min'].default_value = 1.0; rise.inputs['To Max'].default_value = 0.0
    nt.links.new(sep.outputs['Z'], rise.inputs['Value'])
    mr = nt.nodes.new('ShaderNodeMath'); mr.operation = 'MULTIPLY'
    nt.links.new(m1.outputs[0], mr.inputs[0]); nt.links.new(rise.outputs['Result'], mr.inputs[1]); dens = mr
elif STYLE == 'veil':
    # A supernova's veil: thin glowing sheets of filament across the whole sky.
    wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'DIAGONAL'
    wv.inputs['Scale'].default_value = 0.02; wv.inputs['Distortion'].default_value = 22.0; wv.inputs['Detail'].default_value = 8; wv.inputs['Detail Scale'].default_value = 1.6
    nt.links.new(coord.outputs['Object'], wv.inputs['Vector'])
    wr = nt.nodes.new('ShaderNodeMapRange'); wr.inputs['From Min'].default_value = 0.82; wr.inputs['From Max'].default_value = 1.0
    nt.links.new(wv.outputs['Fac'], wr.inputs['Value'])
    mv = nt.nodes.new('ShaderNodeMath'); mv.operation = 'MULTIPLY_ADD'; mv.inputs[1].default_value = 1.4
    nt.links.new(wr.outputs['Result'], mv.inputs[0]); nt.links.new(m1.outputs[0], mv.inputs[2])
    sm = nt.nodes.new('ShaderNodeMath'); sm.operation = 'MULTIPLY'; sm.inputs[1].default_value = 0.7
    nt.links.new(mv.outputs[0], sm.inputs[0]); dens = sm
nt.links.new(dens.outputs[0], m4.inputs[0]); m4.inputs[1].default_value = 0.022 * {'band': 0.35, 'pillars': 0.6}.get(STYLE, 1.0)   # (the variants' gas is thicker: dimmed to sit with the locked nebula, never a wall of light behind the core)
nt.links.new(m4.outputs[0], vol.inputs['Strength'])
vol.inputs['Color'].default_value = (1, 1, 1, 1)
nt.links.new(vol.outputs['Emission'], out.inputs['Volume'])
gas.data.materials.append(mat)
sc.cycles.volume_step_rate = 4.0
sc.cycles.volume_max_steps = 256

# The 360° camera at the room's centre.
cam = bpy.data.cameras.new('eye'); cam.type = 'PANO'
try:
    cam.panorama_type = 'EQUIRECTANGULAR'
except AttributeError:
    cam.cycles.panorama_type = 'EQUIRECTANGULAR'
co = bpy.data.objects.new('eye', cam); sc.collection.objects.link(co); sc.camera = co
co.rotation_euler = (math.pi / 2, 0, 0)
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('NEBULA ok ->', OUT)
