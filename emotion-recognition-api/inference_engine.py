import torch
import numpy as np
from transformers import WavLMModel, AutoFeatureExtractor
from config import CLASSES, SAMPLE_RATE, MODEL_NAME, MODEL_PATH


class EmotionEngine:
    def __init__(self):
        print("[INFO] Feature extractor yükleniyor...")
        self.fe = AutoFeatureExtractor.from_pretrained(MODEL_NAME)
        print("[INFO] WavLM yükleniyor...")
        self.wavlm = WavLMModel.from_pretrained(MODEL_NAME)
        self.wavlm.eval()
        print("[INFO] Classifier yükleniyor...")
        self.clf = torch.nn.Linear(768, len(CLASSES))
        self.clf.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
        self.clf.eval()
        print("[INFO] EmotionEngine hazır.")

    def predict(self, audio: np.ndarray) -> dict:
        inputs = self.fe(
            audio,
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
            padding=True
        )
        with torch.no_grad():
            outputs = self.wavlm(**inputs).last_hidden_state
            embedding = outputs.mean(dim=1)
            logits = self.clf(embedding)
            probs = torch.softmax(logits, dim=1)[0]

        pred_idx = int(torch.argmax(probs).item())
        scores = {CLASSES[i]: float(probs[i]) for i in range(len(CLASSES))}

        return {
            "label": CLASSES[pred_idx],
            "confidence": float(probs[pred_idx]),
            "scores": scores,
            "is_anomaly": float(probs[pred_idx]) < 0.40
        }