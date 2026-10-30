# Prints the camera shots in a video as JSON [{"start": s, "end": s}, ...] using PySceneDetect's adaptive detector.
# Usage: python -P -E scripts/setups.py <video>
import json, sys
from scenedetect import detect, AdaptiveDetector

scenes = detect(sys.argv[1], AdaptiveDetector())
print(json.dumps([{"start": round(a.get_seconds(), 2), "end": round(b.get_seconds(), 2)} for a, b in scenes]))
