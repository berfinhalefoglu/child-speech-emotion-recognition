from inference_engine import EmotionEngine

engine = EmotionEngine()

audio_path = "data/BESD/ENGLISH/ANGER/1.EF_12 Angry_1.wav"

result = engine.predict(audio_path)

print("\nSONUÇ:")
print(result)