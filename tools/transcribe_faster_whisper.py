"""Local transcription worker. Install with: python -m pip install faster-whisper"""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--input')
parser.add_argument('--output')
parser.add_argument('--model', default='small')
parser.add_argument('--language', default=None)
parser.add_argument('--device', choices=['cpu','cuda','auto'], default='cpu')
parser.add_argument('--self-test', action='store_true')
args = parser.parse_args()

try:
    from faster_whisper import WhisperModel
except ImportError as exc:
    raise SystemExit('Missing faster-whisper: python -m pip install faster-whisper') from exc

if args.self_test:
    import tempfile
    import wave
    with tempfile.TemporaryDirectory() as tmp:
        sample = Path(tmp) / 'smoke.wav'
        with wave.open(str(sample), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b'\x00\x00' * 16000)
        model = WhisperModel(args.model, device=args.device,
                             compute_type='float16' if args.device == 'cuda' else 'int8')
        segments, _ = model.transcribe(str(sample), language='en', vad_filter=False)
        list(segments)  # Force lazy inference, including CUDA library loading.
        print(json.dumps({'ok': True, 'device': args.device, 'model': args.model}))
    raise SystemExit(0)

if not args.input or not args.output:
    parser.error('--input and --output are required for transcription')

model = WhisperModel(args.model, device=args.device,
                     compute_type='float16' if args.device == 'cuda' else 'int8')
segments, info = model.transcribe(args.input, vad_filter=True, word_timestamps=True, language=args.language)
data = {'language': info.language, 'segments': [
    {'start': s.start, 'end': s.end, 'text': s.text.strip(),
     'words': [{'start': w.start, 'end': w.end, 'word': w.word} for w in (s.words or [])]}
    for s in segments
]}
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
Path(args.output).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
