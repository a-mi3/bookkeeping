import os
import sys
from pathlib import Path

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("ERROR: GEMINI_API_KEY is not set")
    sys.exit(1)

print("GEMINI_API_KEY is loaded (value hidden)")

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Installing google-genai...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "google-genai", "-q"])
    from google import genai
    from google.genai import types

client = genai.Client(api_key=api_key)

response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="Say 'Hello from Gemini!' in one sentence.",
)

print(f"Gemini response: {response.text}")
print("bws secret injection verified successfully!")
