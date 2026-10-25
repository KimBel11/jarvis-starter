"""Render a still preview (PNG) of a .blend headlessly, working around the known issues of big studio scenes.
Run:  Blender -b --factory-startup -noaudio file.blend --python render_preview.py -- OUT.png [--size 1280x720] [--samples 24] [--angle front|rear|side|top|three_quarter]
CPU Cycles only (no GPU in headless). Never saves the .blend. Prints JSON between JARVIS_JSON_START / JARVIS_JSON_END."""
import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: -- OUT.png [--size WxH] [--samples N] [--angle name]")
out = os.path.abspath(argv[0])
def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default
w, h = [int(v) for v in opt("--size", "1280x720").lower().split("x")]
samples = int(opt("--samples", "24"))
angle = opt("--angle", "three_quarter")
os.makedirs(os.path.dirname(out), exist_ok=True)

scene = bpy.context.scene
for vl in scene.view_layers:
    vl.use = True                      # otherwise every render is empty
scene.timeline_markers.clear()         # markers switch cameras behind our back
scene.animation_data_clear()
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.color_management = "FOLLOW_SCENE"   # OVERRIDE crashes on write in some files

# frame the model: ignore huge helper meshes (studios/floors > 7 m)
pts = []
for o in scene.objects:
    if o.type == "MESH" and not o.hide_render and max(o.dimensions) < 7.0:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
if not pts:
    pts = [Vector((-1, -1, 0)), Vector((1, 1, 2))]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center, size = (mn + mx) / 2, max((mx - mn).length, 0.5)

cam_data = bpy.data.cameras.new("JarvisCam"); cam = bpy.data.objects.new("JarvisCam", cam_data); scene.collection.objects.link(cam)
dirs = {"front": (0, -1, 0.25), "rear": (0, 1, 0.25), "side": (1, 0, 0.2), "top": (0, -0.05, 1), "three_quarter": (0.8, -1, 0.45)}
d = Vector(dirs.get(angle, dirs["three_quarter"])).normalized()
cam.location = center + d * size * 1.25
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_data.lens = 40
scene.camera = cam

sun_data = bpy.data.lights.new("JarvisSun", "SUN"); sun_data.energy = 3.0
sun = bpy.data.objects.new("JarvisSun", sun_data); sun.rotation_euler = (math.radians(50), 0, math.radians(35)); scene.collection.objects.link(sun)
if scene.world is None:
    scene.world = bpy.data.worlds.new("JarvisWorld")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.82, 0.86, 0.92, 1.0); bg.inputs[1].default_value = 0.9
scene.render.filepath = out

result = {"ok": False, "out": out}
try:
    bpy.ops.render.render(write_still=True)
    result["ok"] = os.path.exists(out)
    result["size"] = os.path.getsize(out) if result["ok"] else 0
except Exception as e:
    result["error"] = str(e)[:400]
print("JARVIS_JSON_START")
print(json.dumps(result))
print("JARVIS_JSON_END")
