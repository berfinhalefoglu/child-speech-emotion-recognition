from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from pathlib import Path
import shutil, uuid, traceback
import librosa
import numpy as np
from inference_engine import EmotionEngine
from config import SAMPLE_RATE, DURATION

app = FastAPI(title="Emotion Recognition API")

TEMP_DIR = Path("temp_uploads")
TEMP_DIR.mkdir(exist_ok=True)

engine = EmotionEngine()

@app.get("/")
def root():
    return {"message": "Emotion API çalışıyor."}

@app.post("/predict")
async def predict_emotion(file: UploadFile = File(...)):
    temp_path = None
    try:
        suffix = Path(file.filename).suffix.lower() if file.filename else ".m4a"
        if suffix == "":
            suffix = ".m4a"

        temp_path = TEMP_DIR / f"{uuid.uuid4().hex}{suffix}"

        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        print(f"[INFO] Dosya kaydedildi: {temp_path}")

        audio, _ = librosa.load(str(temp_path), sr=SAMPLE_RATE, mono=True)
        audio = librosa.util.normalize(audio)

        target_len = int(SAMPLE_RATE * DURATION)
        if len(audio) >= target_len:
            audio = audio[:target_len]
        else:
            audio = np.pad(audio, (0, target_len - len(audio)))

        result = engine.predict(audio)
        print(f"[INFO] Sonuç: {result}")
        return JSONResponse(content=result)

    except Exception as e:
        print("[ERROR]")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

    finally:
        if temp_path and Path(temp_path).exists():
            Path(temp_path).unlink()