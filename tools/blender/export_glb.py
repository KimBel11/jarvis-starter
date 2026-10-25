"""Export the visible scene of a .blend to a GLB (web-ready). Never saves the .blend.
Run:  Blender -b --factory-startup -noaudio file.blend --python export_glb.py -- OUT.glb [--draco]
Prints JSON between JARVIS_JSON_START / JARVIS_JSON_END."""
import bpy, sys, os, json

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: -- OUT.glb [--draco]")
out_path = os.path.abspath(argv[0])
draco = "--draco" in argv
os.makedirs(os.path.dirname(out_path), exist_ok=True)

for sc in bpy.data.scenes:
    for vl in sc.view_layers:
        vl.use = True  # a view layer with 'Use for Rendering' off exports nothing

result = {"ok": False, "out": out_path, "draco": draco}
try:
    kw = dict(filepath=out_path, export_format="GLB", use_visible=True, export_apply=True, export_animations=True, export_yup=True)
    if draco:
        kw.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    bpy.ops.export_scene.gltf(**kw)
    result["ok"] = os.path.exists(out_path)
    result["size"] = os.path.getsize(out_path) if result["ok"] else 0
except Exception as e:  # keep the JSON contract even on failure
    result["error"] = str(e)[:400]

print("JARVIS_JSON_START")
print(json.dumps(result))
print("JARVIS_JSON_END")
