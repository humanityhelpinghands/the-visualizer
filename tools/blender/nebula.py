# The sky's nebula, rendered in Blender's Cycles (run headless):
#   blender --background --factory-startup --python tools/blender/nebula.py
# A real volume of glowing gas (billows, wisps, dark lanes) rendered once from the room's
# centre with a 360° camera into a greyscale map: assets/textures/nebula.png. Only the
# gas's density is baked; the Loft colours it live in the song's own colours.
import bpy, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'textures', 'nebula.png')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.device = 'CPU'
PREVIEW = bool(os.environ.get('NEB_PREVIEW'))
sc.render.resolution_x, sc.render.resolution_y = (1024, 512) if PREVIEW else (4096, 2048)
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
nt.links.new(m3.outputs[0], m4.inputs[0]); m4.inputs[1].default_value = 0.022
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
