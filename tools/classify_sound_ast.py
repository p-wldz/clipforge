"""Local audio event labeling. Labels are noisy AudioSet model predictions, not verified game events."""
import argparse
import json
import math
import wave

import numpy as np
import torch
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
from audio_windowing import ast_windows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--model', default='MIT/ast-finetuned-audioset-10-10-0.4593')
    parser.add_argument('--window', type=float, default=5)
    parser.add_argument('--hop', type=float, default=2.5)
    parser.add_argument('--threshold', type=float, default=0.12)
    parser.add_argument('--max-events', type=int, default=60)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if not args.self_test and not args.input:
        parser.error('--input is required unless --self-test')
    torch.set_num_threads(min(4, torch.get_num_threads()))
    extractor = AutoFeatureExtractor.from_pretrained(args.model)
    model = AutoModelForAudioClassification.from_pretrained(args.model, use_safetensors=True).eval()

    if args.self_test:
        audio = np.zeros(16000 * 3, dtype=np.float32)
    else:
        with wave.open(args.input, 'rb') as f:
            if f.getframerate() != 16000 or f.getnchannels() != 1 or f.getsampwidth() != 2:
                raise ValueError('Expected mono 16 kHz 16-bit PCM WAV (convert with ffmpeg first)')
            audio = np.frombuffer(f.readframes(f.getnframes()), dtype='<i2').astype(np.float32) / 32768.0

    window = int(args.window * 16000)
    hop = int(args.hop * 16000)
    if not args.self_test and (window <= 0 or hop <= 0):
        raise ValueError('Window and hop must be positive')
    events = []
    for start, end in ast_windows(len(audio), window, hop if not args.self_test else len(audio)):
        raw = audio[start:end]
        if not len(raw):
            continue
        # Suppress obviously silent windows to avoid false positives.
        if not args.self_test and np.sqrt(np.mean(raw * raw)) < 0.002:
            continue
        features = extractor(raw, sampling_rate=16000, return_tensors='pt')
        with torch.inference_mode():
            logits = model(**features).logits[0]
        # AudioSet AST is multi-label, so use sigmoid rather than softmax.
        scores = torch.sigmoid(logits)
        values, indices = torch.topk(scores, min(5, len(scores)))
        for value, index in zip(values.tolist(), indices.tolist()):
            if not args.self_test and value < args.threshold:
                continue
            events.append({
                'start': round(start / 16000, 3),
                'end': round(end / 16000, 3),
                'label': model.config.id2label[int(index)],
                'confidence': round(float(value), 4),
                'provider': 'ast',
            })
        if args.self_test:
            print(json.dumps({'ok': True, 'model': args.model, 'predictions': len(events)}))
            return
    # Keep the highest-scoring events without mixing classes or claiming precision beyond window size.
    events.sort(key=lambda x: x['confidence'], reverse=True)
    events = events[:args.max_events]
    events.sort(key=lambda x: (x['start'], -x['confidence']))
    print(json.dumps({'events': events}))


if __name__ == '__main__':
    main()
