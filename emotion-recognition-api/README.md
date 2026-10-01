# Emotion Recognition API

This project is an Emotion Recognition API built using FastAPI. It allows users to upload audio files for emotion analysis and provides predictions based on the content of the audio.

## Project Structure

```
emotion-recognition-api
├── app_api.py            # FastAPI application for emotion recognition
├── inference_engine.py    # Contains the EmotionEngine class for processing audio files
├── requirements.txt       # Lists the project dependencies
└── README.md              # Documentation for the project
```

## Installation

To set up the project, you need to install the required dependencies. You can do this by running the following command:

```
pip install -r requirements.txt
```

## Usage

1. Start the FastAPI application by running:

```
uvicorn app_api:app --reload
```

2. Once the server is running, you can access the API at `http://127.0.0.1:8000`.

3. Use the `/predict` endpoint to upload an audio file for emotion prediction. You can test the API using tools like Postman or cURL.

## API Endpoints

- `GET /`: Returns a message indicating that the Emotion API is running.
- `POST /predict`: Accepts an audio file upload and returns the predicted emotion.

## Contributing

Contributions are welcome! If you have suggestions for improvements or new features, feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.