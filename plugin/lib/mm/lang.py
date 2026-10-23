"""Language packs: every word list the editor reads speech with, per language. Stdlib only.

    from mm import lang
    P = lang.pack(lang.of(edit_dir))      # the edit's language (meta.json), MM_LANG, else "en"
    P.hard_fillers  P.soft_fillers  P.stop  P.meta  P.filler_prompt  P.common  P.hook_stop  P.hook_generic
    P.whisper  P.script                   # the code Whisper is run with; the captions' script ("latn"/"deva")
    lang.set_meta(edit_dir, lang="de")    # transcribe.py records what Whisper heard
    lang.key("करना", "hi") == lang.key("karna", "hi")   # words compared by sound in Hindi and Hinglish
    re.sub(rf"[^{lang.WCH}' ]+", " ", text)   # punctuation out, every script's words whole (Python's \\w drops
                                              # Devanagari vowel signs: नमस्ते would split into नमस + त)
    python3 lang.py demo

Languages: en English, de German, hi Hindi (captions in Devanagari), hinglish Hindi with English words (captions in
Roman letters, the way Hinglish creators write). Hindi and Hinglish are heard the same way (Whisper's "hi", which
writes Hindi in Devanagari and keeps most English words in Latin letters); they differ in the captions' script.
Auto-detected Hindi is Hinglish when English words make a share of it (latin_share).

A pack never decides a cut. It names the places to look (retakes.py candidates), how to fold two transcripts of
the same speech into the same tokens (textnorm), and what to prompt Whisper with so it keeps the hesitations the cut
needs as evidence.

German notes:
  - Every German noun is capitalised, so "a capitalised word is a name" (the English keyterm rule) is wrong here:
    keyterms() keeps words with digits, inner capitals (ChatGPT) or all caps (KI), plus words spelled in ways German
    rarely spells (a "c" outside ch/ck/sch, a y, a q without u: Claude, Cursor).
  - Number words are compounds ("fünfundzwanzig", "zweihundertfünfzig", "dreitausend"): fold_de() reads one word.
  - "eh" is not a filler in German ("das ist eh klar"); "ja", "so" and "nochmal" are ordinary words, so they are only
    candidates where they sit as a hesitation or restart.
"""
import json
import os
import re
from pathlib import Path

try:
    from mm import hindi  # noqa: E402
except ImportError:      # lang.py run on its own
    import hindi  # type: ignore  # noqa: E402

DEFAULT = "en"
# Word characters in every script the editor reads: \\w, plus Latin combining accents and the Devanagari vowel signs,
# nasal marks and digits (Python's \\w takes the signs for punctuation). The danda (।) stays punctuation.
WCH = r"\w\u0300-\u036f\u0900-\u0963\u0966-\u097f\ua8e0-\ua8ff\u1cd0-\u1cff"
LATIN_SHARE_HINGLISH = 0.12   # auto-detected Hindi with this share of words in Latin letters is Hinglish
# A sentence ends at . ? ! and at Hindi's danda (। ॥), which Whisper writes for Hindi; a clause at , ; : too
SENT_END = (".", "?", "!", "\u0964", "\u0965")
CLAUSE_END = SENT_END + (",", ";", ":")


class Pack:
    def __init__(self, code, **kw):
        self.code = code
        self.whisper = code
        self.script = "latn"
        self.numbers = None
        self.dtw = False      # Whisper's DTW word times (whisper.cpp -dtw): Hindi's default times run up to 1 s early
        for k, v in kw.items():
            setattr(self, k, v)


EN = Pack(
    "en",
    hard_fillers={"um", "uh", "umm", "uhh", "erm", "er", "hmm", "mm", "ah", "eh"},
    soft_fillers=["you know", "i mean", "like"],
    loose_soft={"like"},
    like_before={"and", "so", "but", "or", "um", "uh", "was", "were"},
    stop={"a", "an", "the", "and", "or", "but", "so", "of", "to", "in", "on", "at", "it", "is",
          "i", "you", "we", "that", "this", "for", "with", "be", "was", "are", "my", "me", "if",
          "it's", "it'll", "i'm", "they", "he", "she", "do", "not", "there", "then", "just"},
    meta=re.compile(r"\b(wait|sorry|hold on|shoot|oops|start (?:again|over)|one more time|"
                    r"let me (?:start|do (?:that|this|it)|try|say (?:that|it))(?: (?:again|over))?|"
                    r"take two|again)\b"),
    filler_prompt="Umm, uh, so, like, you know, I mean, uh, so, um, wait, sorry, let me start again.",
    common=set("""a an and are as at be but by can do for from have he her his how i if in is it its just
let me my no not now of on or our out so that the their then there these they this to up us was we
what when where which who why will with you your yes okay ok hey hi here today first next last one two
three four five six seven eight nine ten monday tuesday wednesday thursday friday saturday sunday""".split()),
    hook_stop=set("""a an the and or but of to in on at for with without from by as is are was be been
this that these those it its my your our their i you we they he she me us them how why what when where who
which do does did done get gets got make makes made can will would should could just really very so not no
all any some more most than then there here into about over out up down off""".split()),
    hook_generic={"ai", "video", "tool", "thing", "guide", "tip"},
    hook_verbs=set("become becomes stop stops start starts build builds use uses using learn learns".split()),
    percent="percent",
    spoken_same={"wanna": "want to", "gonna": "going to", "gotta": "got to", "kinda": "kind of",
                 "sorta": "sort of", "til": "till", "cuz": "because", "yall": "you all"},
    dangling={"and", "or", "but", "so", "the", "a", "an", "to", "of", "if", "with", "for", "that", "because", "like"},
)

DE = Pack(
    "de",
    hard_fillers={"äh", "ähm", "ähh", "ähmm", "äm", "öh", "öhm", "ehm", "hm", "hmm", "mhm", "mh", "mm", "em"},
    soft_fillers=["weißt du", "weißte", "sozusagen", "quasi", "irgendwie", "halt", "also", "genau"],
    loose_soft={"halt", "also", "genau", "quasi", "irgendwie", "sozusagen"},
    like_before={"und", "aber", "oder", "so", "äh", "ähm"},
    stop={"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "und", "oder",
          "aber", "so", "von", "zu", "zum", "zur", "in", "im", "an", "am", "auf", "für", "mit", "ist", "sind",
          "war", "es", "ich", "du", "er", "sie", "wir", "ihr", "man", "nicht", "dann", "da", "dass", "wenn",
          "wie", "was", "auch", "noch", "schon", "nur", "mal", "ja", "hier", "jetzt", "bei", "aus", "als",
          "euch", "dir", "mir", "mich", "dich", "uns"},
    meta=re.compile(r"\b(warte(?: mal)?|sorry|moment mal|stopp|(?:noch ?mal )?von vorne|"
                    r"ich (?:fang|fange) (?:noch ?mal )?(?:neu|von vorne) an|neu anfangen|noch ?mal neu|"
                    r"mist|scheiße|scheisse|verdammt|oh gott|nein nein|nee nee)\b"),
    filler_prompt="Ähm, äh, also, ja, halt, ähm, sozusagen, äh, warte, sorry, nochmal von vorne.",
    common=set("""der die das den dem des ein eine einen einem einer und oder aber so von zu zum zur in im an
am auf für mit ist sind war es ich du er sie wir ihr man nicht dann da dass wenn wie was heute hier jetzt
montag dienstag mittwoch donnerstag freitag samstag sonntag ja nein okay ok hallo hey""".split()),
    hook_stop=set("""der die das den dem des ein eine einen einem einer und oder aber so von zu zum zur in im
an am auf für mit ohne ist sind war waren wird werden es ich du er sie wir ihr man mein dein unser euer wie
warum was wann wo wer welche welcher dies diese dieser das mehr am meisten als dann da hier nicht kein keine
alle jede jeder jetzt heute""".split()),
    hook_generic={"ki", "ai", "video", "tool", "tools", "ding", "tipp", "tipps", "guide"},
    hook_verbs=set("werden wird machen macht bauen baut nutzen nutzt lernen lernt zeigen zeigt erklären "
                   "erklärt starten startet".split()),
    percent="prozent",
    spoken_same={"nen": "einen", "ner": "einer", "nem": "einem", "gibt's": "gibt es", "gibts": "gibt es",
                 "geht's": "geht es", "gehts": "geht es", "hab's": "habe es", "hab": "habe", "ham": "haben",
                 "haste": "hast du", "biste": "bist du", "kannste": "kannst du", "willste": "willst du",
                 "weißte": "weißt du", "isses": "ist es", "wie's": "wie es", "wär's": "wäre es"},
    dangling={"und", "oder", "aber", "der", "die", "das", "ein", "eine", "zu", "von", "mit", "für", "dass",
              "weil", "wenn", "also"},
)

# Hindi and Hinglish. Whisper writes Hindi in Devanagari and English words mostly in Latin letters, and the same word
# can come back in either script: every list holds both, and the cut compares words by key() (by sound).
def _space_phrases(*alts):
    """A restart cue as a regex over space-joined normalised words. \\b cannot bound Devanagari (a word ending in a
    vowel sign never ends for it), so the cue sits between spaces."""
    return re.compile(r"(?<!\S)(?:" + "|".join(alts) + r")(?!\S)")


_HI_STOP = set("""है हैं था थी थे का की के को में से पर और भी तो ही ये वो यह वह मैं हम आप तुम कि जो क्या नहीं ना एक
इस उस इसे उसे इसको उसको अपना अपनी अपने कर करो करना हो होता होती होते रहा रही रहे गया गई गए दिया किया लिया
hai hain tha thi the ka ki ke ko mein me se par aur bhi toh to hi ye yeh wo woh main mai hum aap tum jo kya nahi
nahin na ek is us ise use isko usko apna apni apne kar karo karna ho hota hoti hote raha rahi rahe gaya gayi gaye
diya kiya liya""".split()) | EN.stop
_HI_COMMON = set("""है हैं था थी थे का की के को में से पर और भी तो ही ये वो यह वह मैं हम आप तुम कि जो क्या नहीं ना
आज कल अब यहाँ वहाँ दोस्तों नमस्ते हाँ हां ठीक अच्छा पहला दूसरा तीसरा""".split()) | _HI_STOP | EN.common
_HI_DANGLING = set("""और लेकिन पर तो कि का की के को से में क्योंकि अगर जो जैसे aur lekin par toh ki ka ke ko se mein
kyunki agar jo jaise""".split()) | EN.dangling
_HI = dict(
    hard_fillers={"अम्म", "उम्म", "हम्म", "अं", "उं", "ऊं", "अ", "उह", "आं", "umm", "um", "uh", "uhh", "hmm", "mm",
                  "hm", "erm", "ummm"},
    soft_fillers=["मतलब", "matlab", "बेसिकली", "basically", "एक्चुअली", "actually", "यानी", "yaani", "you know",
                  "i mean", "like"],
    loose_soft={"मतलब", "matlab", "बेसिकली", "basically", "एक्चुअली", "actually", "यानी", "yaani", "like"},
    like_before={"और", "aur", "तो", "toh", "लेकिन", "lekin", "पर", "par", "उम्म", "umm", "अम्म", "um", "and", "so", "but"},
    stop=_HI_STOP,
    meta=_space_phrases("रुको", "रुकिए", "रुक जाओ", "एक सेकंड", "एक second", "ek second", "ek sec", "एक मिनट",
                        "ek minute", "फिर से", "phir se", "fir se", "दोबारा", "dobara", "dobaara", "सॉरी", "sorry",
                        "वेट", "wait", "नहीं नहीं", "nahi nahi", "गलत", "galat", "एक बार और", "ek baar aur",
                        "let me (?:start|say (?:that|it)|try)(?: again| over)?", "start again", "one more time",
                        "scratch that"),
    common=_HI_COMMON,
    hook_stop=_HI_STOP | EN.hook_stop,
    hook_generic={"वीडियो", "video", "ai", "एआई", "tool", "टूल", "चीज़", "चीज", "tips", "टिप्स", "guide"},
    hook_verbs=set("""बनाना बनाओ बनाएं सीखो सीखें शुरू इस्तेमाल use start build learn बदलो बदल""".split()),
    percent="percent",
    spoken_same={"परसेंट": "percent", "प्रतिशत": "percent", "pratishat": "percent"},
    dangling=_HI_DANGLING,
    whisper="hi",
    numbers="hi",
    dtw=True,
)
HI = Pack("hi", script="deva",
          filler_prompt="तो दोस्तों, अम्म, मतलब, हाँ तो, एक सेकंड, रुको, सॉरी, फिर से बोलता हूँ। आज हम एआई टूल्स के बारे में बात करेंगे।",
          **_HI)
HINGLISH = Pack("hinglish", script="latn",
                filler_prompt="तो दोस्तों, अम्म, मतलब, basically, हाँ तो, एक second, रुको, sorry, फिर से बोलता हूँ। "
                              "आज हम AI tools के बारे में बात करेंगे।",
                **_HI)

# What a sentence is doing, for a beat's motion graphic (edit route.py motion_kind, motion.py promote_type): regex
# phrases matched between spaces on lower-case words with the punctuation out, so they bound Devanagari too. A digit
# is a number in every language.
EN.motion = dict(
    versus=["before", "after", "instead", "versus", "vs", "used to", "compared", "better than", "worse than",
            "faster than"],
    number=["hundred", "thousand", "million", "billion", "percent", "half", "double", "twice", "times"],
    steps=["first", "second", "third", "then", "next", "finally", "step"],
    flow=["sends?", "goes to", "passes", "hands?", r"from \S+ to", "into", "pipeline", "workflow", "connects?"],
    ui=["drag", "click", "type", "upload", "render(?:s|ing)?", "cut(?:s|ting)?", "open", "install", "run(?:s|ning)?",
        "press"],
    and_or=["and", "or"],
)
DE.motion = dict(
    versus=["vorher", "nachher", "statt", "anstatt", "stattdessen", "früher", "im vergleich", "verglichen", "versus",
            "vs", r"(?:besser|schlechter|schneller|langsamer|günstiger|billiger|teurer) als"],
    number=["hundert", "tausend", "millionen?", "milliarden?", "prozent", "hälfte", "doppelt", "doppelte",
            r"\w+mal so"],
    steps=["erstens", "zweitens", "drittens", "zuerst", "als erstes", "dann", "danach", "als nächstes", "anschließend",
           "schließlich", "zum schluss", "schritt"],
    flow=["schickt", "schicken", "sendet", "geht an", "gibt (?:es )?weiter", "übergibt", "landet in", "pipeline",
          "workflow", "verbindet", "verbinden", r"von \S+ (?:zu|nach|in)"],
    ui=["klick(?:e|st|en)?", "zieh(?:e|st|en)?", "tipp(?:e|st|en)?", "hochladen", "lädst", "rendern", "schneiden",
        "öffne(?:st|n)?", "installier(?:e|st|en)?", "start(?:e|est|en)", "drück(?:e|st|en)?"],
    and_or=["und", "oder"],
)
HI.motion = HINGLISH.motion = dict(   # Hindi in either script, and the English that Hinglish mixes in
    versus=["की जगह", "के बजाय", "बनाम", "तुलना में", r"से (?:बेहतर|तेज़|तेज|सस्ता|अच्छा)", "ki jagah", "ke bajaye",
            "banaam", "tulna mein", r"se (?:behtar|tez|sasta|accha|achha|better|faster)", *EN.motion["versus"]],
    number=["सौ", "हज़ार", "हजार", "लाख", "करोड़", "करोड", "प्रतिशत", "परसेंट", "आधा", "दोगुना", "गुना", "sau", "hazaar",
            "hazar", "lakh", "crore", "karod", "pratishat", "aadha", "doguna", "guna", *EN.motion["number"]],
    steps=["पहला", "पहले", "दूसरा", "तीसरा", "फिर", "उसके बाद", "इसके बाद", "आखिर में", "आख़िर में", "कदम", "स्टेप", "pehla",
           "pehle", "doosra", "dusra", "teesra", "tisra", "phir", "fir", "uske baad", "iske baad", "aakhir mein",
           "kadam", *EN.motion["steps"]],
    flow=["भेजता", "भेजती", "भेजते", "भेजो", "पहुँचता", "पहुंचता", "जोड़ता", "जोड़ो", "bhejta", "bhejti", "bhejo",
          "pahunchta", "jodta", "jodo", *EN.motion["flow"]],
    ui=["क्लिक", "ड्रैग", "अपलोड", "इंस्टॉल", "खोलो", "खोलें", "दबाओ", "दबाएं", "टाइप", "kholo", "kholein", "dabao",
        "dabaye", *EN.motion["ui"]],
    and_or=["और", "या", "aur", "ya", *EN.motion["and_or"]],
)

PACKS = {"en": EN, "de": DE, "hi": HI, "hinglish": HINGLISH}
NAMES = {"en": "English", "de": "German", "hi": "Hindi", "hinglish": "Hinglish"}


def pack(code=None):
    """The pack for a language code ("de", "de-DE", "german", "hi", "hindi", "hinglish", "hi-Latn"); unknown
    languages get English's lists."""
    raw = (code or DEFAULT).lower().replace("_", "-")
    if raw in ("hinglish", "hi-latn", "hi-en", "hindi-english"):
        return HINGLISH
    c = raw.split("-")[0]
    c = {"german": "de", "deutsch": "de", "english": "en", "hindi": "hi"}.get(c, c)
    return PACKS.get(c, EN)


def key(w, code=None):
    """How two words are compared: by sound in Hindi and Hinglish (either script, most spellings), as written
    (lower case) in every other language."""
    return hindi.key(w) if pack(code).numbers == "hi" else str(w).lower()


def script_language(text):
    """The language a script is in when it is Hindi: "hi" (Devanagari) or "hinglish" (Hindi words in Roman letters,
    English mixed in), else None and the take's sound decides. A Hinglish take that opens in English is heard as
    English, and Whisper's "en" translates the Hindi after it: the script knows better. Roman Hindi words are counted
    only when they are not English or German words too ("to", "is", "mein" are)."""
    toks = re.findall(rf"[{WCH}']+", hindi.clean(text).lower())
    if len(toks) < 8:
        return None
    deva = sum(1 for t in toks if hindi.has_deva(t))
    if deva / len(toks) >= 0.3:
        return "hi"
    roman = ({v.lower() for v in hindi.COMMON.values()} | set(hindi.ROMAN) | {w for w in _HI_STOP | _HI_COMMON if re.fullmatch(r"[a-z]+", w)}
             | {x for v in HINGLISH.motion.values() for x in v if re.fullmatch(r"[a-z]+", x)}) - EN.common - EN.stop - DE.common - DE.stop
    hindi_words = deva + sum(1 for t in toks if t in roman)
    return "hinglish" if hindi_words / len(toks) >= 0.08 else None


def latin_share(words):
    """The share of a transcript's words written in Latin letters: English words in Hindi speech."""
    ws = [w for w in (x if isinstance(x, str) else x.get("text", "") for x in words) if re.search(r"\w", w)]
    lat = [w for w in ws if re.search(r"[A-Za-z]", w) and not hindi.has_deva(w)]
    return len(lat) / len(ws) if ws else 0.0


def meta_path(edit_dir):
    return Path(edit_dir) / "meta.json"


def get_meta(edit_dir):
    try:
        return json.loads(meta_path(edit_dir).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def set_meta(edit_dir, **kw):
    """Merge keys into <edit>/meta.json (the edit's language, the engine that heard it)."""
    m = get_meta(edit_dir)
    m.update({k: v for k, v in kw.items() if v is not None})
    p = meta_path(edit_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")
    return m


def asked(edit_dir):
    """The language the user picked for the take before it was heard (the studio's New video page writes meta.json's
    "lang_asked"), or None: transcribe.py uses it in place of detecting one."""
    got = get_meta(edit_dir).get("lang_asked") if edit_dir is not None else None
    return pack(got).code if got and got != "auto" else None


def of(edit_dir=None):
    """The language to read an edit with: MM_LANG, else meta.json's "lang", else DEFAULT."""
    env = os.environ.get("MM_LANG", "").strip()
    if env:
        return pack(env).code
    if edit_dir is not None:
        got = get_meta(edit_dir).get("lang")
        if got:
            return pack(got).code
    return DEFAULT


# --- German numbers -------------------------------------------------------------

DE_UNITS = {"null": 0, "ein": 1, "eins": 1, "eine": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "sechs": 6,
            "sieben": 7, "acht": 8, "neun": 9}
DE_TEENS = {"zehn": 10, "elf": 11, "zwölf": 12, "dreizehn": 13, "vierzehn": 14, "fünfzehn": 15, "sechzehn": 16,
            "siebzehn": 17, "achtzehn": 18, "neunzehn": 19}
DE_TENS = {"zwanzig": 20, "dreißig": 30, "dreissig": 30, "vierzig": 40, "fünfzig": 50, "sechzig": 60,
           "siebzig": 70, "achtzig": 80, "neunzig": 90}
DE_SCALES = {"million": 10**6, "millionen": 10**6, "mio": 10**6, "milliarde": 10**9, "milliarden": 10**9,
             "mrd": 10**9, "billion": 10**12, "billionen": 10**12}


def _de_lt100(w):
    if w in DE_UNITS:
        return DE_UNITS[w]
    if w in DE_TEENS:
        return DE_TEENS[w]
    if w in DE_TENS:
        return DE_TENS[w]
    if "und" in w:
        u, _, t = w.partition("und")
        if u in DE_UNITS and DE_UNITS[u] > 0 and t in DE_TENS:
            return DE_UNITS[u] + DE_TENS[t]
    return None


def _de_lt1000(w):
    if "hundert" in w:
        left, _, right = w.partition("hundert")
        lv = 1 if left in ("", "ein") else DE_UNITS.get(left)
        rv = 0 if right == "" else _de_lt100(right.removeprefix("und"))
        if lv is None or rv is None:
            return None
        return lv * 100 + rv
    return _de_lt100(w)


def fold_de(w):
    """One German number word (a compound) as an int, else None: "fünfundzwanzig" 25, "zweihundertfünfzig" 250,
    "dreitausendvierhundert" 3400, "hundert" 100, "tausend" 1000."""
    w = w.lower()
    if not w or not w.isalpha():
        return None
    if "tausend" in w:
        left, _, right = w.partition("tausend")
        lv = 1 if left in ("", "ein") else _de_lt1000(left)
        rv = 0 if right == "" else _de_lt1000(right.removeprefix("und"))
        if lv is None or rv is None:
            return None
        return lv * 1000 + rv
    return _de_lt1000(w)


# --- keyterms ---------------------------------------------------------------------

_FOREIGN = re.compile(r"(?i)c(?![hk])|(?<!s)ch(?=[aeiouy])|y|q(?!u)|^j(?=[^aeiouäöü])|[a-z]w$|ph")


def keyterms(text, code=None):
    """Distinctive words of a script, in order: names, products, jargon, numbers. English: capitalised or with a
    digit, not a common word. German: with a digit, an inner capital (ChatGPT), all caps (KI), or spelled the way
    German rarely spells (Claude, Cursor), not a common word."""
    P = pack(code)
    text = hindi.clean(text)
    # (word, starts a sentence): after . ? ! । or at a new line (a script's line is a sentence, full stop or not)
    toks = [(m.group(0), not text[:m.start()].rstrip() or text[:m.start()].rstrip().endswith(SENT_END)
             or "\n" in text[:m.start()][len(text[:m.start()].rstrip()):])
            for m in re.finditer(rf"[{WCH}][{WCH}.+#'-]*[{WCH}+#]|[{WCH}]", text)]
    # a Hinglish script in Roman letters: its Hindi words are Latin too, so a name is what English capitalises
    roman = P.numbers == "hi" and latin_share([w for w, _ in toks]) > 0.5
    mid_caps = {w.lower() for w, start in toks if not start and w[:1].isupper()}
    # a sentence's first word is a name when one follows it ("Claude Code se app banao"), unless it is a Hindi word
    # in Roman letters ("Phir Base44 par"): hindi.py's own spellings, the number words, the pack's cue words
    hindi_roman = {v.lower() for v in hindi.COMMON.values()} | set(hindi.ROMAN) | {
        x for v in getattr(P, "motion", {}).values() for x in v if re.fullmatch(r"[a-z]+", x)}
    mid_caps |= {w.lower() for (w, start), (nx, nst) in zip(toks, toks[1:])
                 if start and not nst and nx[:1].isupper() and w.lower() not in hindi_roman}
    out, seen = [], set()
    for w, start in toks:
        w = re.sub(r"'s$", "", w)
        low = w.lower()
        if len(w) < 2 or low in P.common or low in seen:
            continue
        digit = any(c.isdigit() for c in w)
        latin = bool(re.search(r"[A-Za-z]", w)) and not hindi.has_deva(w)
        if roman:
            # Doston, dikhaunga, Sirf are Hindi; AI, ChatGPT and a capital mid-sentence (Claude, Base44) are names;
            # I'll and I'm are not
            inner = any(c.isupper() for c in w[1:]) and not w.isupper()
            keep = digit or (latin and "'" not in w and (w.isupper() or inner or (w[0].isupper() and (not start or low in mid_caps))))
        elif P.numbers == "hi":
            # Hindi in Devanagari: a name, product or term is in Latin letters (English inside Hindi speech) or has a digit
            keep = digit or (latin and (w[0].isupper() or len(w) > 3))
        elif P.code == "de":
            inner = any(c.isupper() for c in w[1:]) and not w.isupper()
            caps = w.isupper() and len(w) >= 2 and w.isalpha()
            foreign = w[0].isupper() and bool(_FOREIGN.search(w))
            keep = digit or inner or caps or foreign
        else:
            keep = w[0].isupper() or digit
        if keep:
            seen.add(low)
            out.append(w)
    return out


def demo():
    import tempfile
    assert pack("de-DE").code == "de" and pack("german").code == "de" and pack("fr").code == "en"
    assert fold_de("fünfundzwanzig") == 25 and fold_de("zweihundertfünfzig") == 250
    assert fold_de("dreitausendvierhundert") == 3400 and fold_de("hundert") == 100 and fold_de("tausend") == 1000
    assert fold_de("einhundertundeins") == 101 and fold_de("zwölf") == 12 and fold_de("dreißig") == 30
    assert fold_de("hundertachtzig") == 180 and fold_de("neunzehnhundert") is None   # a year: left as a word
    assert fold_de("stunde") is None and fold_de("und") is None and fold_de("hund") is None
    assert DE.meta.search("ach mist, ich fang nochmal von vorne an") and DE.meta.search("warte mal")
    assert not DE.meta.search("das mache ich nochmal anders"), "nochmal alone is an ordinary word"
    assert "äh" in DE.hard_fillers and "eh" not in DE.hard_fillers
    k = keyterms("Heute zeige ich euch, wie ich mit Claude Code und ChatGPT in 15 Minuten eine App baue. "
                 "Die KI schreibt den Code, Cursor macht den Rest.", "de")
    assert k == ["Claude", "Code", "ChatGPT", "15", "KI", "Cursor"], k
    assert keyterms("Today I built it with Claude Code and GPT-4o.", "en") == ["Claude", "Code", "GPT-4o"]
    # Hindi and Hinglish: both scripts in every list, words compared by sound, terms are the Latin words
    assert pack("hi").code == "hi" and pack("hindi").code == "hi" and pack("hinglish").code == "hinglish"
    assert pack("hi-Latn").code == "hinglish" and pack("hi").whisper == pack("hinglish").whisper == "hi"
    assert pack("hi").script == "deva" and pack("hinglish").script == "latn" and pack("de").script == "latn"
    assert key("करना", "hi") == key("karna", "hinglish") and key("Karna", "en") == "karna"
    assert HINGLISH.meta.search("तो रुको फिर से बोलता हूँ") and HINGLISH.meta.search("sorry phir se")
    assert not HINGLISH.meta.search("रुकोगे"), "a cue is a whole word"
    assert "अम्म" in HI.hard_fillers and "umm" in HINGLISH.hard_fillers
    assert keyterms("आज मैं आपको Claude Code और ChatGPT से 15 मिनट में app बनाना दिखाऊँगा", "hinglish") == \
        ["Claude", "Code", "ChatGPT", "15"]
    assert abs(latin_share(["आज", "मैं", "AI", "assistant", "बनाऊँगा"]) - 0.4) < 1e-9 and latin_share([]) == 0.0
    assert re.sub(rf"[^{WCH}' ]+", " ", "नमस्ते, दोस्तों। आज?").split() == ["नमस्ते", "दोस्तों", "आज"]
    # a Hinglish script in Roman letters: the names, never its Hindi words (they would push Whisper to Latin letters)
    got = keyterms("Doston, aaj main aapko dikhaunga ki apna khud ka AI assistant kaise banayein. Sirf 5 easy steps "
                   "mein. Claude Code se app banao, ChatGPT ki zaroorat nahi. Phir Base44 par host karo.", "hinglish")
    assert got == ["AI", "Claude", "Code", "ChatGPT", "Base44"], got
    got = keyterms("Taaki tumhe docs na padhna padhe\nPehla rule: glass sirf floating cheezon pe.\nComment GLASS and I'll "
                   "send it to you. Ye Apple ki guidelines", "hinglish")
    assert got == ["Comment", "GLASS", "Apple"], got    # a line starts a sentence (Pehla), I'll is no name
    assert script_language("Toh maine pure 2 ghante laga ke Apple ki official design guidelines padhi. And I turned it "
                           "into a Claude skill. Taaki tumhe docs na padhna padhe") == "hinglish"
    assert script_language("आज हम Claude Code के बारे में बात करेंगे और देखेंगे कि ये कैसे काम करता है") == "hi"
    assert script_language("Today I will show you how to build your own assistant in five easy steps, it is easy") is None
    assert script_language("Heute zeige ich euch, wie ihr in fünf Schritten euren eigenen Assistenten baut, mein Tipp") is None
    with tempfile.TemporaryDirectory() as t:
        assert of(t) == "en"
        assert asked(t) is None
        set_meta(t, lang_asked="auto")
        assert asked(t) is None
        set_meta(t, lang_asked="hindi")
        assert asked(t) == "hi" and of(t) == "en"     # picked, not heard yet: the edit's language is set by transcribe
        set_meta(t, lang="de", engine="whispercpp")
        assert of(t) == "de" and get_meta(t)["engine"] == "whispercpp"
        os.environ["MM_LANG"] = "en"
        assert of(t) == "en"
        del os.environ["MM_LANG"]
    print("lang demo ok")


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["demo"]:
        demo()
