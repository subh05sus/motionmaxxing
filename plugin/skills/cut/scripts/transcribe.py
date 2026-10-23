#!/usr/bin/env python3
"""Verbatim word-level transcription of a take, on this computer. Writes the words and the edit's language.

    python transcribe.py <media> <out.json> [--engine auto|whispercpp|whisper] [--lang auto|de|en|hi|hinglish|...]
                         [--script script.md] [--keyterm TERM ...]
    python transcribe.py <media> --pre        the studio, the moment a clip is added (before Make): the same
                                              transcription into the cache
    python transcribe.py refine <edit dir> <start> <end> [--source <media>]
                                              hear one stretch of the take again on its own and patch words.raw.json
                                              when it holds more words (verify_cut's SURVIVED with "a word label is
                                              off": a repeat the first pass wrote once)
    python transcribe.py heal <edit dir> [--ranges A-B,C-D] [--source <media>]
                                              hear the take again island by island (each stretch of speech between two
                                              pauses on its own, verbatim) and take those words where
                                              the first pass was wrong: a retake it wrote once, words it squeezed into
                                              a frame or two. --ranges adds stretches (source seconds) verify_cut heard
                                              in the cut. Run it right after transcribing, before retakes.py propose.
    python transcribe.py demo                 self-check (no model needed)

Engines:
  whispercpp  whisper.cpp on the Mac's GPU, Whisper large-v3-turbo. The default once `whisper-cli` and the model
              are installed (setup.py model). MM_WHISPER_MODEL picks another ggml model by name. The take is heard
              in one pass (the steadiest word times); MM_WHISPER_WINDOWS=1 hears it in 30 s windows overlapping by
              4 s instead, which keeps more quick repeats but blurs times at the windows' edges. A repeat the pass
              wrote once is found by verify_cut and fixed with `refine`. No voice detector: whisper.cpp 1.9 leaves
              token times on the shortened timeline after it and drops lines.
  whisper     faster-whisper on the CPU, the small model: the fallback when whisper.cpp is missing.

Language: --lang auto (the default, or MM_LANG) detects it first, so Whisper is prompted in that language with the
hesitations it should keep ("Ähm, äh, also ..." for German): the fillers are the evidence the cut acts on. The
language goes into <edit>/meta.json (lib/mm/lang.py) and every later step reads the edit in it.

Keyterms: --script picks the names, products and jargon from the user's script (lang.keyterms), --keyterm adds one by
hand. Whisper gets them in its prompt, so they come back spelled right ("Claude Code", not "Klaus Kot").

Output (the transcription contract):
    [{"text": "so", "start": 0.12, "end": 0.31, "type": "word"},
     {"text": " ", "start": 0.31, "end": 0.40, "type": "spacing"}, ...]

Audio is pulled out with ffmpeg first (16 kHz mono WAV), so a multi-GB 4K file costs one fast audio demux.
Cache: $MM_HOME/cache/transcripts/ for CACHE_DAYS, keyed by the file (path, size, modified time), the engine, its
model, the language and the keyterms. The run after Make reuses what --pre made, or waits for it.
Models never download during an edit: a missing one exits 4 (setup.py model downloads it, its size said first).
Exit codes: 0 ok, 1 error, 2 usage, 4 that model is not installed
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "lib"))
from mm import lang as L, models, progress  # noqa: E402

HOME = models.HOME
DEFAULT_CPP_MODEL = "large-v3-turbo"
DEFAULT_FW_MODEL = "small"
# Whisper's prompt holds about 224 tokens: the filler line plus this many terms.
MAX_KEYTERMS, MAX_KEYTERM_CHARS, PROMPT_TERMS = 100, 49, 40
CACHE_DAYS = 7
LOCK_STALE_S = 1800   # a --pre that died without removing its lock
BRACKETED = re.compile(r"^[\[(\*].*[\])\*]$")   # "[Musik]", "(lacht)", "*hustet*": a sound, not a word


def clean_keyterms(terms):
    """Deduplicated terms of at most 5 words and MAX_KEYTERM_CHARS, at most MAX_KEYTERMS."""
    out, seen = [], set()
    for t in (" ".join(t.split()) for t in terms):
        if (t and t.lower() not in seen and len(t) <= MAX_KEYTERM_CHARS and len(t.split()) <= 5
                and not set(t) & set("<>{}[]\\")):
            seen.add(t.lower())
            out.append(t)
    return out[:MAX_KEYTERMS]


def prompt_for(code, terms):
    """Whisper reads its prompt as text said before the take: hesitations in it make it keep the take's own, and
    names in it come back spelled that way."""
    P = L.pack(code)
    return P.filler_prompt + (" " + ", ".join(terms[:PROMPT_TERMS]) + "." if terms else "")


def extract_audio(src, dst):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1",
                        "-ar", "16000", "-c:a", "pcm_s16le", str(dst)])
    if r.returncode:
        sys.exit(f"ERROR: ffmpeg could not read audio from {src}")


def with_spacing(words):
    """Insert spacing tokens for the gaps, so every engine gives the same shape."""
    out = []
    for w in words:
        if out and w["start"] - out[-1]["end"] > 0.001:
            out.append({"text": " ", "start": out[-1]["end"], "end": w["start"], "type": "spacing"})
        out.append(w)
    return out


def missing_model(what, fix):
    print(f"ERROR: {what} is not installed, and models never download during an edit. {fix}", file=sys.stderr)
    sys.exit(4)


# --- whisper.cpp ----------------------------------------------------------------------------------------------

def whisper_cli():
    return os.environ.get("MM_WHISPER_CLI") or shutil.which("whisper-cli")


def cpp_model():
    name = os.environ.get("MM_WHISPER_MODEL", DEFAULT_CPP_MODEL)
    f = models.whispercpp(name)
    if not f:
        missing_model(f"the {name} transcription model", "Run setup (setup.py model), which says its size first.")
    return f, name


def cpp_words(payload):
    """whisper.cpp's full JSON -> words. A token with a leading space starts a word; one without continues it
    ("ze" "ige" -> "zeige", "euch" "," -> "euch,"). A new segment always starts a new word. Special tokens
    ([_BEG_], [_TT_n]) are skipped; a bracketed sound ("[Musik]") is an audio_event. With DTW times (t_dtw, Hindi)
    those are the times; snap() then holds them to the audio."""
    words, prev = [], None
    for seg in payload.get("transcription", []):
        fresh = True
        for tok in seg.get("tokens", []):
            t = tok.get("text", "")
            if t.startswith("[_") or not t.strip():
                continue
            a, b = tok["offsets"]["from"] / 1000, tok["offsets"]["to"] / 1000
            if tok.get("t_dtw", -1) >= 0:
                # DTW: the token ends here; it started its own length earlier, never before the token before it ended
                b = tok["t_dtw"] / 100
                a = b - min(tok_s(t), max(0.02, b - prev)) if prev is not None else b - tok_s(t)
                prev = b
            if fresh or t.startswith(" ") or not words:
                words.append({"text": t.strip(), "start": round(a, 3), "end": round(b, 3), "type": "word"})
            else:
                words[-1]["text"] += t
                words[-1]["end"] = round(max(words[-1]["end"], b), 3)
            fresh = False
    out = []
    for w in words:
        if BRACKETED.match(w["text"]):
            w["type"] = "audio_event"
        if w["end"] < w["start"]:
            w["end"] = w["start"]
        if out and not any(c.isalnum() for c in w["text"]) and w["type"] == "word":   # a stray mark: onto the last
            out[-1]["text"] += w["text"]
            continue
        out.append(w)
    return out


CHUNK_S, OVERLAP_S = 30.0, 4.0   # whisper.cpp hears a take in 30 s windows that overlap by 4 s


def wav_seconds(wav):
    import wave
    with wave.open(str(wav), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def whisper_code(code):
    """The language Whisper is run with: Hinglish is heard as Hindi ("hi" writes the Hindi in Devanagari and keeps
    English words in Latin letters; "en" would translate the Hindi into English)."""
    return "auto" if not code or code == "auto" else L.pack(code).whisper


def uses_dtw(code):
    """Word times from Whisper's DTW alignment: Hindi and Hinglish. Their default times ran up to a second early on a
    test take (a restart's first word put inside the pause before it); DTW lands within 0.1 s once each word's start
    is set back by its first token's length (tok_s). English and German keep the default times (within 0.05 s)."""
    return bool(code) and code != "auto" and L.pack(code).dtw


def dtw_preset(model_name):
    """whisper.cpp's DTW preset for a model: large-v3-turbo -> large.v3.turbo."""
    return model_name.replace("-", ".")


def tok_s(text):
    """How long a token is said, for setting a word's start back from its DTW time (the end of its first token):
    about 0.065 s a letter or Devanagari sign, 0.04-0.35 s."""
    n = len(re.sub(r"[^A-Za-z0-9\u0900-\u097f]", "", text)) or 1
    return max(0.04, min(0.35, 0.065 * n))


QUIET_RUN_S = 0.25   # DTW gives a pause to the word before it: a silent run this long inside a word is where it ends
SOFT_REACH_S = 0.25  # a word's soft edge (the "s" of "Step", the "f" of "sirf") is followed this far past its DTW time
SOFT_DIP_S = 0.06    # ... across a gap this short (the closure in "st")


def levels(wav):
    """(20 ms levels, the soft line): a sound above the soft line is a sound, even a fricative under the speech
    threshold ("s" at -50 dB in a take whose threshold is -39 dB and floor -89 dB); below it is silence."""
    import build_timeline as B
    lvl = B.window_rms_db(wav)
    noise, diag = B.derive_noise_db(lvl)
    if noise is None:
        return lvl, None
    floor = diag.get("floor", noise - 20)
    return lvl, (floor + noise) / 2


def quiet_runs(lvl, soft):
    """[(a, b)] seconds of silence (under the soft line) for QUIET_RUN_S or longer."""
    import build_timeline as B
    runs, a = [], None
    for i, v in enumerate(list(lvl) + [0.0]):
        if i < len(lvl) and v <= soft:
            a = i if a is None else a
        elif a is not None:
            if (i - a) * B.RMS_WIN_S >= QUIET_RUN_S:
                runs.append((a * B.RMS_WIN_S, i * B.RMS_WIN_S))
            a = None
    return runs


def soft_edge(t, lvl, soft, step, limit):
    """Where the sound around t really starts (step -1) or ends (step +1): past soft sound (a fricative, an
    aspiration) and gaps of up to SOFT_DIP_S, at most SOFT_REACH_S, never past limit (the next word's edge)."""
    import build_timeline as B
    w = B.RMS_WIN_S
    k = int(t / w) - 1 if step < 0 else int(t / w)
    best, dip = t, 0
    while 0 <= k < len(lvl) and abs(k * w - t) <= SOFT_REACH_S and (k * w > limit if step < 0 else k * w < limit):
        if lvl[k] > soft:
            best, dip = (k * w if step < 0 else (k + 1) * w), 0
        else:
            dip += 1
            if dip * w > SOFT_DIP_S:
                break
        k += step
    return best


def snap(words, audio):
    """DTW-timed words held to the audio (audio: levels(wav)): a word ends where a silence inside it begins, a start
    inside a silence moves to where the speech resumes, and each edge takes in the soft sound next to it (DTW starts
    a word at its first loud sound: "Step" lost its "s" to a pause trim). Spacing tokens come back with_spacing."""
    lvl, soft = audio
    if soft is None:
        return words
    runs = quiet_runs(lvl, soft)
    ws = [dict(w) for w in words]
    idx = [i for i, w in enumerate(ws) if w.get("type") == "word"]
    for n, i in enumerate(idx):
        w = ws[i]
        st, en = w["start"], w["end"]
        for a, b in runs:
            if a <= st < b - 0.02:
                st = b
            if st + 0.05 <= a < en:
                en = a + 0.02
                break
        prev_end = ws[idx[n - 1]]["end"] if n else 0.0
        nxt = ws[idx[n + 1]]["start"] if n + 1 < len(idx) else en + SOFT_REACH_S
        st = min(st, soft_edge(st, lvl, soft, -1, prev_end))
        en = max(en, soft_edge(en, lvl, soft, +1, max(en, nxt)))
        w.update(start=round(st, 3), end=round(max(en, st + 0.04), 3))
    return ws


def decide(asked, heard, words):
    """The edit's language: the one asked for, else the one Whisper heard. Heard Hindi is Hinglish when English
    words in Latin letters make a share of it (lang.LATIN_SHARE_HINGLISH): its captions are then in Roman letters."""
    if asked and asked != "auto":
        return L.pack(asked).code
    p = L.pack(heard)
    if p.numbers == "hi":
        share = L.latin_share([w for w in words if w.get("type", "word") == "word"])
        return "hinglish" if share >= L.LATIN_SHARE_HINGLISH else "hi"
    return p.code if heard else L.DEFAULT


def cpp_files(wavs, code, prompt):
    """One whisper-cli call over several wav files (the model loads once) -> [payload per file]."""
    model, _ = cpp_model()
    cmd = [whisper_cli(), "-m", str(model), "-l", whisper_code(code), "-ojf", "-np", "--prompt", prompt]
    if uses_dtw(code):
        cmd += ["-nfa", "-dtw", dtw_preset(cpp_model()[1])]   # DTW needs flash attention off
    for w in wavs:
        cmd += ["-f", str(w)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = []
    for w in wavs:
        f = Path(f"{w}.json")
        if r.returncode or not f.exists():
            sys.exit(f"ERROR: whisper.cpp failed (exit {r.returncode}): {(r.stderr or r.stdout).strip()[-400:]}")
        out.append(json.loads(f.read_text(encoding="utf-8", errors="replace")))
    return out


def cut_wav(wav, start, length, dest):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(wav),
                    "-c:a", "pcm_s16le", str(dest)], check=True)


def windows(total, chunk=CHUNK_S, overlap=OVERLAP_S):
    """[(start, length, core_start, core_end)]: windows of `chunk` s overlapping by `overlap` s; a word belongs to the
    window whose core holds its middle, so the overlap is never heard twice and no word is cut at a window's edge."""
    if total <= chunk + overlap:
        return [(0.0, total, 0.0, total)]
    out, a, step = [], 0.0, chunk - overlap
    while a < total:
        length = min(chunk, total - a)
        last = a + length >= total - 1e-6
        core_a = 0.0 if a == 0 else a + overlap / 2
        core_b = total if last else a + length - overlap / 2
        out.append((a, length, core_a, core_b))
        if last:
            break
        a += step
    return out


REFINE_S, REFINE_OVERLAP_S = 10.0, 2.0   # refine hears a stretch in 10 s pieces: short enough that nothing is merged


def cpp_pieces(wav, code, prompt, start, end, chunk=REFINE_S, overlap=REFINE_OVERLAP_S):
    """The words of [start, end] (with 1.5 s of audio either side), heard in short overlapping pieces."""
    a0 = max(0.0, start - 1.5)
    total = end + 1.5 - a0
    wins = windows(total, chunk, overlap)
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for i, (a, length, _, _) in enumerate(wins):
            f = Path(tmp) / f"p{i:03d}.wav"
            cut_wav(wav, a0 + a, length, f)
            files.append(f)
        payloads = cpp_files(files, code, prompt)
    words = []
    for k, ((a, _, core_a, core_b), payload) in enumerate(zip(wins, payloads)):
        for w in cpp_words(payload):
            w = dict(w, start=round(w["start"] + a + a0, 3), end=round(w["end"] + a + a0, 3), _win=k)
            if core_a <= (w["start"] + w["end"]) / 2 - a0 < core_b:
                words.append(w)
    words.sort(key=lambda w: w["start"])
    return seam_dedupe(words)


def cpp_run(wav, code, prompt):
    """The whole take, heard window by window. Whisper conditions on what it has written so far: over a whole
    take that context makes it write a line said twice once ("Schritt 4, Schritt 4, gib ihm Skills" came back as
    one), and the repeats are the retakes. Short windows, each with the prompt, keep them. -> (words, language)."""
    total = wav_seconds(wav)
    # One pass over the whole take by default: its word times are the steadiest. A line said twice in a row can come
    # back once; verify_cut hears it in the cut and `transcribe.py refine` re-hears that stretch alone. Windows
    # (MM_WHISPER_WINDOWS=1) keep more repeats but blur the times of words near a window's edge.
    wins = windows(total) if os.environ.get("MM_WHISPER_WINDOWS") == "1" else [(0.0, total, 0.0, total)]
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for i, (a, length, _, _) in enumerate(wins):
            f = Path(tmp) / f"w{i:03d}.wav"
            cut_wav(wav, a, length, f)
            files.append(f)
        payloads = cpp_files(files, code, prompt)
    words, heard = [], None
    for k, ((a, _, core_a, core_b), payload) in enumerate(zip(wins, payloads)):
        heard = heard or (payload.get("result") or {}).get("language")
        for w in cpp_words(payload):
            w = dict(w, start=round(w["start"] + a, 3), end=round(w["end"] + a, 3), _win=k)
            if core_a <= (w["start"] + w["end"]) / 2 < core_b:
                words.append(w)
    words.sort(key=lambda w: w["start"])
    return seam_dedupe(words), heard


def seam_dedupe(words):
    """A word on a window's edge can be heard by both windows with times a little apart, so it lands twice
    ("Zuhause. Zuhause."). Two neighbours with the same letters, from different windows, overlapping in time (or
    under 0.3 s apart): the second goes. A real repeat comes from one window, so it stays."""
    import re as _re
    key = lambda w: _re.sub(rf"[^{L.WCH}]|_", "", w["text"].lower())   # noqa: E731  (\\W: का and की were one word)
    out = []
    for w in words:
        p = out[-1] if out else None
        if p and p.get("_win") != w.get("_win") and key(p) == key(w) and w["start"] < p["end"] + 0.3:
            continue
        out.append(w)
    for w in out:
        w.pop("_win", None)
    return out


def cpp_stretch(wav, code, prompt, start, end, pad=(0.2, 0.4)):
    """The words in one stretch, heard on its own (its own file, so its times are exact). pad: seconds of audio
    heard before and after it, so a word on the edge is heard whole."""
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "s.wav"
        a = max(0.0, start - pad[0])
        cut_wav(wav, a, end - a + pad[1], f)
        payload = cpp_files([f], code, prompt)[0]
    return [dict(w, start=round(w["start"] + a, 3), end=round(w["end"] + a, 3)) for w in cpp_words(payload)]


def cpp_detect(wav):
    """The take's language from its opening (whisper.cpp -dl), else None."""
    model, _ = cpp_model()
    # no -np here: it would also hide the "auto-detected language" line this reads
    r = subprocess.run([whisper_cli(), "-m", str(model), "-f", str(wav), "-l", "auto", "-dl"],
                       capture_output=True, text=True)
    m = re.search(r"auto-detected language:\s*([a-z]{2,3})", (r.stdout or "") + (r.stderr or ""))
    return m.group(1) if m else None


def run_cpp(wav, code, terms):
    prompt = prompt_for(code, terms)
    print(f"whisper.cpp {cpp_model()[1]} (GPU), language {code}" + (", DTW word times" if uses_dtw(code) else ""),
          flush=True)
    words, heard = cpp_run(wav, code, prompt)
    audio = levels(wav) if uses_dtw(code) else None
    if audio is not None:
        words = snap(words, audio)

    def again(start, end):   # a stretch one label holds, heard on its own
        got = cpp_stretch(wav, code, prompt, start, end)
        got = snap(got, audio) if audio is not None else got
        return [w for w in got if w["start"] >= start - 0.05 and w["end"] <= end + 0.25]

    return recheck(wav, with_spacing(words), again), heard or code


# --- faster-whisper (CPU fallback) ------------------------------------------------------------------------------

def fw_model():
    name = os.environ.get("MM_FW_MODEL", DEFAULT_FW_MODEL)
    got = models.whisper_dir(name)
    if not got:
        missing_model(f"the {name} CPU transcription model", "Install whisper.cpp (brew install whisper-cpp) and run "
                      "setup.py model, or setup.py model --cpu for the CPU model.")
    return got, name


def run_fw(wav, code, terms):
    os.environ.setdefault("HF_HOME", str(HOME / "models"))
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("ERROR: faster-whisper missing. Run this with python3 <plugin>/lib/mm/run.py, which uses the "
                 "engine's venv (setup installs it).")
    path, name = fw_model()
    print(f"faster-whisper {name} (CPU), language {code}", flush=True)
    model = WhisperModel(str(path), device="cpu", compute_type="int8", local_files_only=True)
    prompt = prompt_for(code, terms)
    # condition_on_previous_text=False: with it on, Whisper collapses a repeated line into one, and repeated lines
    # are the retakes. vad_filter=True: without it, word times drift after a long silence.
    segs, info = model.transcribe(str(wav), language=None if code == "auto" else whisper_code(code), word_timestamps=True,
                                  initial_prompt=prompt, beam_size=5, condition_on_previous_text=False,
                                  vad_filter=True, vad_parameters={"min_silence_duration_ms": 500})

    def words_of(segs):
        return [{"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "type": "word"}
                for s in segs for w in (s.words or []) if w.word.strip()]

    words = words_of(segs)
    heard = getattr(info, "language", None) or code

    def again(start, end):
        segs, _ = model.transcribe(str(wav), language=heard, word_timestamps=True, initial_prompt=prompt,
                                   beam_size=5, condition_on_previous_text=False, clip_timestamps=[start, end])
        return [w for w in words_of(segs) if w["start"] >= start - 0.05 and w["end"] <= end + 0.05]

    return recheck(wav, with_spacing(words), again), heard


def recheck(wav, words, again=None):
    """A label holding far more speech than its word (build_timeline.unheard) is transcribed again on its own; the
    new words replace it when there are more of them, one word means a drawn-out word. With no words back the label
    keeps "unheard_s" (the voiced seconds), which transcript.txt shows so the cut can see the gap."""
    import build_timeline as B
    lvl = B.window_rms_db(wav)
    noise, _ = B.derive_noise_db(lvl)
    toks = [w for w in words if w["type"] != "spacing"]
    found = B.unheard(toks, lvl, noise) if noise is not None else []
    if not found:
        return words
    filled = marked = 0
    for i, voiced in reversed(found):
        w = toks[i]
        got = again(w["start"], w["end"]) if again else []
        if len(got) > 1:
            toks[i:i + 1] = got
            filled += 1
        elif not got:
            w["unheard_s"] = voiced
            marked += 1
    print(f"{len(found)} place(s) where one word held more speech: {filled} heard again"
          + (f", {marked} marked in transcript.txt" if marked else ""))
    return with_spacing(toks)


# --- engine, cache, main ----------------------------------------------------------------------------------------

def pick_engine(want):
    if want in ("whispercpp", "whisper"):
        return want
    if whisper_cli() and models.whispercpp(os.environ.get("MM_WHISPER_MODEL", DEFAULT_CPP_MODEL)):
        return "whispercpp"
    return "whisper"


def detect(wav, engine):
    if engine == "whispercpp":
        return cpp_detect(wav) or L.DEFAULT
    return "auto"   # faster-whisper detects while it transcribes


def cache_dir():
    return HOME / "cache" / "transcripts"


WORDS_VERSION = 3   # bumped when the same settings give other words: 2 Hindi's prompt and DTW times, 3 soft edges


def cache_key(media, engine, code, terms):
    """The take (path, size, modified time) and every setting that changes the words."""
    st = Path(media).stat()
    model = os.environ.get("MM_WHISPER_MODEL", DEFAULT_CPP_MODEL) if engine == "whispercpp" else \
        os.environ.get("MM_FW_MODEL", DEFAULT_FW_MODEL)
    raw = json.dumps([str(Path(media).resolve()), st.st_size, st.st_mtime_ns, engine, model, code, list(terms),
                      WORDS_VERSION])
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def cached(key):
    """{"lang", "words"} a run with these settings already wrote, while fresh; else None. Old entries go."""
    d, now = cache_dir(), time.time()
    for f in d.glob("*.json") if d.is_dir() else []:
        try:
            if now - f.stat().st_mtime > CACHE_DAYS * 86400:
                f.unlink()
        except OSError:
            pass
    try:
        got = json.loads((d / f"{key}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return got if isinstance(got, dict) else {"lang": None, "words": got}


def keep(key, lang_code, words):
    d = cache_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{key}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps({"lang": lang_code, "words": words}, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, d / f"{key}.json")


def running(lock):
    """A --pre is transcribing this take now (its lock names a live process)."""
    try:
        pid, age = int(lock.read_text(encoding="utf-8") or 0), time.time() - lock.stat().st_mtime
    except (OSError, ValueError):
        return False
    if age > LOCK_STALE_S:
        return False
    if os.name == "nt":
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return True


def transcribe(media, engine, code, terms):
    """(words, the language heard) for one take."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "a.wav"
        extract_audio(media, wav)
        if code == "auto":
            code = detect(wav, engine)
            print(f"language   {code} (detected)", flush=True)
            if L.pack(code).numbers == "hi":
                code = "hinglish"   # heard as Hindi with the prompt that keeps English words in Latin letters
        if terms:
            print(f"keyterms   {len(terms)}: " + ", ".join(terms[:8]), flush=True)
        run = run_cpp if engine == "whispercpp" else run_fw
        return run(wav, code, terms)


def write(out, words, lang_code, engine, heard=None):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(words, indent=1, ensure_ascii=False), encoding="utf-8")
    model = os.environ.get("MM_WHISPER_MODEL", DEFAULT_CPP_MODEL) if engine == "whispercpp" else \
        os.environ.get("MM_FW_MODEL", DEFAULT_FW_MODEL)
    L.set_meta(out.parent, lang=L.pack(lang_code).code if lang_code else None, heard=heard or lang_code, engine=engine,
               model=model)
    n = sum(1 for w in words if w["type"] == "word")
    print(f"{n} words -> {out} (language {lang_code})")
    progress.step("Finding retakes and pauses", key=out.parent)


def squeezed(ws):
    """The words of a run that sit in a frame or two each: Whisper's times for them are not where they were said."""
    ws = [w for w in ws if w.get("type", "word") == "word"]
    out = []
    for i, w in enumerate(ws):
        near = [x for x in ws[max(0, i - 2):i + 3] if x is not w]
        tight = w["end"] - w["start"] <= SQUEEZE_S
        packed = sum(1 for x in near if abs(x["start"] - w["start"]) < SQUEEZE_S * 2) >= 2
        if tight and (packed or any(x["end"] - x["start"] <= SQUEEZE_S and abs(x["start"] - w["end"]) < 0.1 for x in near)):
            out.append(w)
    return out


def patch(words, start, end, new, times=False):
    """words with the ones inside [start, end] replaced by `new` when `new` has more words, or (times) as many with
    fewer squeezed into a frame or two; (words, replaced)."""
    toks = [w for w in words if w["type"] != "spacing"]
    inside = [w for w in toks if start <= (w["start"] + w["end"]) / 2 <= end]
    fresh = [w for w in new if start <= (w["start"] + w["end"]) / 2 <= end and w["type"] == "word"]
    n_new, n_old = len(fresh), sum(1 for w in inside if w["type"] == "word")
    better = n_new > n_old or (times and n_new >= n_old > 0 and len(squeezed(fresh)) < len(squeezed(inside)))
    if not better:
        return words, False
    keep = [dict(w, _win=0) for w in toks if not start <= (w["start"] + w["end"]) / 2 <= end]
    merged = sorted(keep + [dict(w, _win=1) for w in fresh], key=lambda w: w["start"])
    return with_spacing(seam_dedupe(merged)), True   # a word on the stretch's edge heard by both passes: once


def refine(edit, start, end, source=None):
    edit = Path(edit)
    raw = edit / "words.raw.json"
    words = json.loads(raw.read_text(encoding="utf-8"))
    meta = L.get_meta(edit)
    code = meta.get("lang") or L.DEFAULT
    src = Path(source) if source else next((edit / n for n in ("source.mp4", "joined.mp4") if (edit / n).exists()), None)
    if not src:
        sys.exit("ERROR: no source: pass --source <the raw take>")
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "a.wav"
        extract_audio(src, wav)
        # heard in 10 s pieces, 1.5 s past both edges: only words whose middle is inside [start, end] are taken
        new = cpp_pieces(wav, code, prompt_for(code, []), start, end) if pick_engine("auto") == "whispercpp" else []
        new = snap(new, levels(wav)) if uses_dtw(code) and new else new
    words, done = patch(words, start, end, new)
    if done:
        raw.write_text(json.dumps(words, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"refined {start:.2f}-{end:.2f}s: " + " ".join(w["text"] for w in new if start <= w["start"] <= end))
    else:
        print(f"kept {start:.2f}-{end:.2f}s: hearing it alone found no more words")


SQUEEZE_S = 0.04         # a word heard in this or less (with a neighbour as short) has times Whisper made up
HEAL_WIN_S = 6.0         # the take compared with its verbatim hearing in windows this long, half overlapping
HEAL_MORE = 2            # a window takes the verbatim words when they are this many more (a retake written once)


def voiced(wav, frame_s=0.05):
    """([bool] per frame_s: the voice is on, louder than the take's quiet floor by 12 dB), frame_s. Stdlib only."""
    import array
    import math
    import wave
    with wave.open(str(wav), "rb") as f:
        rate, n = f.getframerate(), f.getnframes()
        a = array.array("h", f.readframes(n))
    step = max(1, int(rate * frame_s))
    db = []
    for i in range(0, len(a), step):
        chunk = a[i:i + step:4]
        e = sum(x * x for x in chunk) / max(1, len(chunk))
        db.append(10 * math.log10(e + 1e-9))
    floor = sorted(db)[int(0.3 * (len(db) - 1))] if db else 0
    return [d > floor + 12 for d in db], frame_s


def islands(voice, frame_s, a=0.0, b=None, gap_s=0.25, longest=12.0):
    """[(start, end)] the voiced islands between a and b: speech parted by pauses of gap_s or more (a retake starts
    after one). An island over `longest` is split at its quietest-looking pause-free middle (it keeps its words)."""
    b = len(voice) * frame_s if b is None else b
    out, cur, gap = [], None, 0.0
    for k in range(int(a / frame_s), min(len(voice), int(b / frame_s) + 1)):
        t = k * frame_s
        if voice[k]:
            cur = [t, t + frame_s] if cur is None else [cur[0], t + frame_s]
            gap = 0.0
        elif cur is not None:
            gap += frame_s
            if gap >= gap_s:
                out.append(tuple(cur))
                cur, gap = None, 0.0
    if cur:
        out.append(tuple(cur))
    split = []
    for s_, e_ in out:
        n = max(1, int((e_ - s_) // longest) + 1)
        step = (e_ - s_) / n
        split += [(s_ + i * step, s_ + (i + 1) * step) for i in range(n)]
    return split


def cpp_islands(wav, code, prompt, voice, frame_s, a=0.0, b=None):
    """The words of [a, b], each voiced island heard on its own (Whisper cannot fold a retake into the take before
    it when it never hears them together): the most verbatim hearing, its times held inside each island."""
    isl = [(s_, e_) for s_, e_ in islands(voice, frame_s, a, b) if e_ - s_ >= 0.2]
    if not isl:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for i, (s_, e_) in enumerate(isl):
            f = Path(tmp) / f"i{i:04d}.wav"
            cut_wav(wav, max(0.0, s_ - 0.15), (e_ - s_) + 0.3, f)
            files.append(f)
        payloads = cpp_files(files, code, prompt)
    words = []
    for (s_, e_), payload in zip(isl, payloads):
        o = max(0.0, s_ - 0.15)
        for w in cpp_words(payload):
            st, en = w["start"] + o, w["end"] + o
            w = dict(w, start=round(min(max(st, s_), e_), 3), end=round(min(max(en, s_), e_ + 0.1), 3))
            words.append(w)
    words.sort(key=lambda w: w["start"])
    return words


def on_voice(w, voice, frame_s):
    """The word sits where the voice is on (a word Whisper heard in a silence is made up)."""
    i, j = int(w["start"] / frame_s), int(w["end"] / frame_s) + 1
    return any(voice[max(0, i - 2):min(len(voice), j + 2)])


def to_heal(words, verbatim, total, voice=None, frame_s=0.05):
    """[(a, b)] windows where the verbatim hearing is better: clearly more words (a line said twice that the
    whole-take pass wrote once), or as many with fewer squeezed into a frame or two (times Whisper made up)."""
    ws = [w for w in words if w.get("type", "word") == "word"]
    vs = [w for w in verbatim if w.get("type", "word") == "word" and (voice is None or on_voice(w, voice, frame_s))]
    out, t = [], 0.0
    while t < total:
        a, b = t, min(total, t + HEAL_WIN_S)
        old = [w for w in ws if a <= (w["start"] + w["end"]) / 2 < b]
        new = [w for w in vs if a <= (w["start"] + w["end"]) / 2 < b]
        if len(new) >= len(old) + HEAL_MORE or (len(new) >= len(old) > 0 and len(squeezed(new)) < len(squeezed(old))):
            if out and a <= out[-1][1]:
                out[-1] = (out[-1][0], b)
            else:
                out.append((a, b))
        t += HEAL_WIN_S / 2
    return out


def unsqueeze(words, voice, frame_s=0.05):
    """Words Whisper stamped on one moment ("Du ziehst die Datei in" all at 143.66 s) were said before or after it,
    in the voiced audio between the word before and the word after. Spread each squeezed run over that voice, by
    the words' lengths. -> (words, runs moved)."""
    toks = [w for w in words if w.get("type") != "spacing"]
    ws = [w for w in toks if w.get("type", "word") == "word"]
    moved, i = 0, 0
    while i < len(ws):
        j = i
        while j + 1 < len(ws) and ws[j + 1]["start"] - ws[i]["start"] <= SQUEEZE_S * 2 and ws[j]["end"] - ws[j]["start"] <= SQUEEZE_S * 2:
            j += 1
        run = ws[i:j + 1]
        if len(run) >= 2:
            lo = ws[i - 1]["end"] + 0.02 if i > 0 else 0.0
            hi = ws[j + 1]["start"] - 0.02 if j + 1 < len(ws) else len(voice) * frame_s
            frames = [k for k in range(int(lo / frame_s), min(len(voice), int(hi / frame_s) + 1)) if voice[k]]
            # the voiced stretch between the neighbours (fast speech: 0.06 s a word is enough), else that whole gap
            if frames and len(frames) * frame_s >= 0.06 * len(run):
                a, b = frames[0] * frame_s, (frames[-1] + 1) * frame_s
            elif hi - lo >= 0.1 * len(run):
                a, b = lo, hi
            else:
                a = b = None
            if a is not None:
                total = sum(max(1, len(w["text"])) for w in run)
                t = a
                for w in run:
                    d = (b - a) * max(1, len(w["text"])) / total
                    w["start"], w["end"] = round(t, 3), round(t + d * 0.92, 3)
                    t += d
                moved += 1
        i = j + 1
    return with_spacing(sorted(toks, key=lambda w: w["start"])), moved


def heal(edit, ranges=(), source=None):
    """Hear the whole take again in 10 s pieces (verbatim, a minute or two) and take those words wherever they are
    better; ranges (source seconds, verify_cut) are heard again on their own as well."""
    edit = Path(edit)
    raw = edit / "words.raw.json"
    words = json.loads(raw.read_text(encoding="utf-8"))
    meta = L.get_meta(edit)
    code = meta.get("lang") or L.DEFAULT
    src = Path(source) if source else next((edit / n for n in ("source.mp4", "joined.mp4") if (edit / n).exists()), None)
    if not src:
        sys.exit("ERROR: no source: pass --source <the raw take>")
    if pick_engine("auto") != "whispercpp":
        print("healed nothing: hearing again needs whisper.cpp (setup.py model)")
        return 0
    prompt = prompt_for(code, [])
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "a.wav"
        extract_audio(src, wav)
        total = wav_seconds(wav)
        voice, fs = voiced(wav)
        progress.step("Hearing the take again, word for word", key=str(edit))
        verbatim = [w for w in cpp_islands(wav, code, prompt, voice, fs, 0.0, total) if on_voice(w, voice, fs)]
        # Whole islands only: a stretch that ends inside an island would keep the first pass's words for part of it
        # and the island's own for the rest, and a phrase on the seam comes back twice ("und dann lässt du ihn
        # eine" heard by both, the cut then keeping the copy whose times were wrong).
        isl = islands(voice, fs)
        def snap(a, b):
            for s_, e_ in isl:
                if s_ <= a <= e_:
                    a = s_
                if s_ <= b <= e_:
                    b = e_
            return max(0.0, a - 0.05), b + 0.05
        todo = []
        for a, b in to_heal(words, verbatim, total, voice, fs):
            a, b = snap(a, b)
            if todo and a <= todo[-1][1]:
                todo[-1] = (todo[-1][0], max(todo[-1][1], b), verbatim, "verbatim")
            else:
                todo.append((a, b, verbatim, "verbatim"))
        for a, b in ranges:
            a, b = snap(a, b)
            todo.append((a, b, [w for w in cpp_islands(wav, code, prompt, voice, fs, a, b) if on_voice(w, voice, fs)], "heard in the cut"))
    fixed = 0
    for a, b, new, why in todo:
        words, done = patch(words, a, b, new, times=True)
        fixed += done
        heard = " ".join(w["text"] for w in new if a <= (w["start"] + w["end"]) / 2 <= b)
        print(f"{'healed' if done else 'kept  '} {a:7.2f}-{b:7.2f}s  {why:<16} {heard[:110]}")
    words, moved = unsqueeze(words, voice, fs)
    if moved:
        print(f"timed   {moved} run(s) of words Whisper had stamped on one moment, spread over the voice around them")
    if fixed or moved:
        raw.write_text(json.dumps(words, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{fixed} of {len(todo)} stretch(es) rewritten, {moved} run(s) re-timed in {raw.name}" if fixed or moved
          else "healed nothing: every stretch reads right")
    return 0


def main():
    if sys.argv[1:] == ["demo"]:
        return demo()
    if sys.argv[1:2] == ["heal"]:
        a = sys.argv[2:]
        if not a:
            sys.exit("usage: transcribe.py heal <edit dir> [--ranges A-B,C-D] [--source <media>]")
        rg = a[a.index("--ranges") + 1] if "--ranges" in a else ""
        ranges = [tuple(float(x) for x in r.split("-")) for r in rg.split(",") if "-" in r]
        src = a[a.index("--source") + 1] if "--source" in a else None
        return heal(a[0], ranges, src)
    if sys.argv[1:2] == ["refine"]:
        a = sys.argv[2:]
        if len(a) < 3:
            sys.exit("usage: transcribe.py refine <edit dir> <start> <end> [--source <media>]")
        src = a[a.index("--source") + 1] if "--source" in a else None
        return refine(a[0], float(a[1]), float(a[2]), src)
    ap = argparse.ArgumentParser()
    ap.add_argument("media")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--pre", action="store_true", help="into the cache only, before Make (the studio)")
    ap.add_argument("--engine", choices=["auto", "whispercpp", "whisper"], default="auto")
    ap.add_argument("--lang", default=os.environ.get("MM_LANG") or "auto")
    ap.add_argument("--script", help="the user's script: its names and jargon bias the transcription")
    ap.add_argument("--keyterm", action="append", default=[], help="one name or term to bias towards (repeatable)")
    a = ap.parse_args()
    if not a.pre and not a.out:
        ap.error("the output path is required (or --pre)")
    if not Path(a.media).exists():
        sys.exit(f"ERROR: no such file: {a.media}")
    if a.script and not Path(a.script).exists():
        sys.exit(f"ERROR: no such file: {a.script}")
    if not a.pre:
        progress.step("Writing down every word", key=Path(a.out).parent)
    engine = pick_engine(a.engine)
    code = a.lang.lower()
    if code == "auto" and a.out:      # the language the user picked in the studio, before the take was heard
        code = L.asked(Path(a.out).parent) or "auto"
    script_terms = L.keyterms(Path(a.script).read_text(encoding="utf-8"), None if code == "auto" else code) \
        if a.script else []
    terms = clean_keyterms(a.keyterm + script_terms)
    ck = cache_key(a.media, engine, code, terms)
    lock = cache_dir() / f"{ck}.lock"
    if a.pre:
        cache_dir().mkdir(parents=True, exist_ok=True)
        if cached(ck) is not None or running(lock):
            return
        lock.unlink(missing_ok=True)
        try:   # one --pre per take: the clip added twice starts one transcription
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
    else:
        if running(lock):
            print("the transcription started when the clip was added: waiting for it", flush=True)
            while running(lock):
                time.sleep(0.5)
        got = cached(ck)
        if got is not None:
            print(f"engine {engine}: reused the transcript made when the clip was added", flush=True)
            heard = got.get("lang") or code
            return write(a.out, got["words"], decide(code, heard, got["words"]), engine, heard)
    try:
        words, heard = transcribe(a.media, engine, code, terms)
        keep(ck, heard, words)
    finally:
        if a.pre:
            lock.unlink(missing_ok=True)
    if not a.pre:
        write(a.out, words, decide(code, heard, words), engine, heard)


# --- self-check -------------------------------------------------------------------------------------------------

def demo():
    global HOME
    old = HOME
    with tempfile.TemporaryDirectory() as t:
        HOME = Path(t)
        take = Path(t) / "take.mov"
        take.write_bytes(b"x")
        k = cache_key(take, "whispercpp", "de", [])
        assert cached(k) is None
        keep(k, "de", [{"text": "hallo", "start": 0, "end": 0.2, "type": "word"}])
        assert cached(k)["words"][0]["text"] == "hallo" and cached(k)["lang"] == "de"
        assert cache_key(take, "whispercpp", "de", ["Claude"]) != k, "keyterms change the words: another entry"
        assert cache_key(take, "whisper", "de", []) != k and cache_key(take, "whispercpp", "en", []) != k
        os.utime(take, (1, 1))
        assert cache_key(take, "whispercpp", "de", []) != k, "a changed file is another take"
        lock = cache_dir() / "x.lock"
        lock.write_text(str(os.getpid()), encoding="utf-8")
        assert running(lock)
        lock.write_text("999999999", encoding="utf-8")
        assert not running(lock), "a dead --pre's lock is ignored"
    HOME = old
    payload = {"result": {"language": "de"}, "transcription": [
        {"tokens": [{"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}},
                    {"text": " Heute", "offsets": {"from": 30, "to": 310}},
                    {"text": " ze", "offsets": {"from": 450, "to": 520}},
                    {"text": "ige", "offsets": {"from": 520, "to": 740}},
                    {"text": " euch", "offsets": {"from": 970, "to": 1180}},
                    {"text": ",", "offsets": {"from": 1390, "to": 1410}},
                    {"text": " [Musik]", "offsets": {"from": 1500, "to": 2000}},
                    {"text": "[_TT_100]", "offsets": {"from": 2000, "to": 2000}}]},
        {"tokens": [{"text": "App", "offsets": {"from": 2400, "to": 2700}},
                    {"text": " baue", "offsets": {"from": 2700, "to": 3000}},
                    {"text": ".", "offsets": {"from": 3000, "to": 3010}}]}]}
    w = cpp_words(payload)
    assert [x["text"] for x in w] == ["Heute", "zeige", "euch,", "[Musik]", "App", "baue."], w
    assert w[1]["start"] == 0.45 and w[1]["end"] == 0.74 and w[3]["type"] == "audio_event"
    assert w[4]["start"] == 2.4, "a new segment starts a new word even without a leading space"
    W = lambda t, a, b: {"text": t, "start": a, "end": b, "type": "word"}   # noqa: E731
    old = with_spacing([W("Schritt", 1.0, 1.2), W("4", 1.2, 1.4), W("Skills", 1.5, 1.9), W("Das", 2.0, 2.2)])
    new = [W("Schritt", 1.0, 1.2), W("4", 1.2, 1.4), W("Schritt", 1.45, 1.5), W("4", 1.5, 1.55), W("Skills", 1.6, 1.9)]
    got, done = patch(old, 0.9, 1.95, new)
    assert done and [w["text"] for w in got if w["type"] == "word"] == ["Schritt", "4", "Schritt", "4", "Skills", "Das"], got
    assert patch(old, 0.9, 1.95, new[:2])[1] is False, "fewer words heard: the old ones stay"
    seam = [dict(W("Zuhause.", 53.9, 54.5), _win=1), dict(W("Zuhause.", 54.0, 54.5), _win=2),
            dict(W("Dafür", 54.6, 54.9), _win=2), dict(W("dafür", 55.0, 55.2), _win=2)]
    assert [w["text"] for w in seam_dedupe(seam)] == ["Zuhause.", "Dafür", "dafür"], "a real repeat stays"
    wins = windows(100.0)
    assert wins[0][:2] == (0.0, 30.0) and wins[-1][0] + wins[-1][1] == 100.0, wins
    assert all(a[3] == b[2] for a, b in zip(wins, wins[1:])), "the cores tile the take with no gap or overlap"
    assert windows(20.0) == [(0.0, 20.0, 0.0, 20.0)]
    assert prompt_for("de", []).startswith("Ähm, äh") and prompt_for("en", ["Lumo"]).endswith(" Lumo.")
    assert clean_keyterms(["a<b", "x" * 50, "one two three four five six", "Lumo", "lumo", " Claude  Code "]) == \
        ["Lumo", "Claude Code"]
    try:
        os.environ["MM_WHISPER_MODEL"] = "no-such-size-demo"
        cpp_model()
        raise AssertionError("a missing model went on")
    except SystemExit as e:
        assert e.code == 4, e.code
    finally:
        os.environ.pop("MM_WHISPER_MODEL", None)
    print("transcribe demo ok")


if __name__ == "__main__":
    main()
