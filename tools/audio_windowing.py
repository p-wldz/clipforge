"""Pure helpers for avoiding impossible-to-classify trailing AST audio windows.

AST's torchaudio Kaldi fbank extractor requires at least 400 samples at 16 kHz
(25 ms). Very short final fragments must never be passed to the extractor.
"""


def ast_windows(total_samples: int, window_samples: int, hop_samples: int, min_samples: int = 400):
    if window_samples <= 0 or hop_samples <= 0 or min_samples < 2:
        raise ValueError('Audio window, hop and minimum must be positive')
    if total_samples < min_samples:
        return
    for start in range(0, total_samples, hop_samples):
        end = min(total_samples, start + window_samples)
        if end - start < min_samples:
            continue
        yield start, end
