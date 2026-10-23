"""Hindi and Hinglish: Devanagari read as Roman letters, words compared by sound, number words. Stdlib only.

    from mm import hindi
    hindi.romanize("दोस्तों, आज मैं आपको दिखाऊँगा")   # "doston, aaj main aapko dikhaunga": Hinglish caption spelling
    hindi.key("करना") == hindi.key("karna")              # True: one key for the same word in either script
    hindi.number("पच्चीस"), hindi.number("pachchees")    # 25, 25
    python3 hindi.py demo

Whisper writes Hindi speech in Devanagari and keeps the English words of Hinglish in Latin letters ("अपना AI
assistant कैसे बनाएं"), but not every time: the same word can come back in either script in two takes. romanize()
writes Devanagari the way Hinglish captions spell it (aaj, karna, nahi, doston): consonants and vowel signs, the
silent "a" Hindi drops (करना is karna, not karana), long vowels doubled only in a word's first syllable (aaj, kaam,
but dikhana), the commonest words and English loanwords from a word list (नहीं nahi, असिस्टेंट assistant).
key() folds what spellings disagree on (aa/a, ee/i, oo/u, w/v, z/j, ph/f, a final h, doubled letters), so a
retake matches its first try whatever script and spelling each came back in.
"""
import re
import unicodedata

VIRAMA, NUKTA, ANUSVARA, CANDRA, VISARGA = "्", "़", "ं", "ँ", "ः"
ZW = re.compile("[​‌‍﻿]")
DEVA = re.compile("[ऀ-ॿ]")

CONS = {"क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
        "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
        "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
        "श": "sh", "ष": "sh", "स": "s", "ह": "h"}
# a nukta under a consonant: the Persian and English sounds (क़ q, ख़ kh, ग़ g, ज़ z, फ़ f), and ड़ ढ़ as Hinglish writes
# them, d and dh (kapde, padhi, ladka; "r" read as kapre, parhi)
NUKTA_CONS = {"क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "d", "ढ": "dh", "फ": "f", "य": "y"}
VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o",
          "औ": "au", "ऑ": "o", "ऍ": "e", "ॲ": "e"}
SIGNS = {"ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e",
         "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e", "ॆ": "e", "ॊ": "o"}
LABIAL = set("पफबभम")
DIGITS = {chr(0x966 + i): str(i) for i in range(10)}

# How Hinglish writes its commonest words, and English words Whisper wrote in Devanagari.
COMMON = {
    "नहीं": "nahi", "नही": "nahi", "है": "hai", "हैं": "hain", "मैं": "main", "में": "mein", "क्या": "kya",
    "क्यों": "kyun", "क्यूं": "kyun", "और": "aur", "भी": "bhi", "तो": "toh", "वो": "wo", "यह": "yeh", "वह": "woh",
    "ये": "ye", "हम": "hum", "तुम": "tum", "आप": "aap", "कि": "ki", "की": "ki", "के": "ke", "का": "ka", "को": "ko",
    "से": "se", "पर": "par", "था": "tha", "थी": "thi", "थे": "the", "हो": "ho", "कर": "kar", "करो": "karo",
    "करना": "karna", "करें": "karein", "दोस्तों": "doston", "अपना": "apna", "अपनी": "apni", "अपने": "apne",
    "सिर्फ": "sirf", "सिर्फ़": "sirf", "बहुत": "bahut", "अच्छा": "achha", "मतलब": "matlab", "लेकिन": "lekin",
    "अगर": "agar", "जब": "jab", "तब": "tab", "सब": "sab", "कुछ": "kuch", "कैसे": "kaise", "कहाँ": "kahan",
    "कहां": "kahan", "यहाँ": "yahan", "यहां": "yahan", "वहाँ": "wahan", "वहां": "wahan", "अभी": "abhi", "फिर": "phir",
    "एक": "ek", "पहला": "pehla", "पहले": "pehle", "पहली": "pehli", "उसे": "use", "इसे": "ise", "उसको": "usko",
    "इसको": "isko", "हमें": "hamein", "आपको": "aapko", "मुझे": "mujhe", "तुम्हें": "tumhe", "ज़रूरत": "zaroorat",
    "जरूरत": "zaroorat", "हाँ": "haan", "हां": "haan", "ना": "na", "न": "na", "वाला": "wala", "वाली": "wali",
    "वाले": "wale", "रहा": "raha", "रही": "rahi", "रहे": "rahe", "गया": "gaya", "गई": "gayi", "गए": "gaye",
    "दिया": "diya", "किया": "kiya", "लिया": "liya", "चाहिए": "chahiye", "सकते": "sakte", "सकता": "sakta",
    "सकती": "sakti", "बनाएं": "banayein", "बनाए": "banaye", "दिखाऊँगा": "dikhaunga", "दिखाएंगा": "dikhaunga",
    "दिखाऊंगा": "dikhaunga", "बताऊँगा": "bataunga", "बताऊंगा": "bataunga", "ठीक": "theek", "खुद": "khud",
    "ख़ुद": "khud", "उम्म": "umm", "अम्म": "umm", "हम्म": "hmm", "अं": "um",
}
ENGLISH = {
    "असिस्टेंट": "assistant", "असिस्टंट": "assistant", "क्लाउड": "cloud", "सर्वर": "server", "सॉर्वर": "server",
    "लैपटॉप": "laptop", "स्टेप": "step", "स्टेप्स": "steps", "वीडियो": "video", "विडियो": "video", "चैनल": "channel",
    "सब्सक्राइब": "subscribe", "लाइक": "like", "कमेंट": "comment", "शेयर": "share", "ऐप": "app", "एप": "app",
    "फोन": "phone", "फ़ोन": "phone", "कंप्यूटर": "computer", "इंटरनेट": "internet", "ऑनलाइन": "online", "डेटा": "data",
    "डाटा": "data", "एआई": "AI", "चैटजीपीटी": "ChatGPT", "क्लॉड": "Claude", "गूगल": "Google", "यूट्यूब": "YouTube",
    "इंस्टाग्राम": "Instagram", "व्हाट्सएप": "WhatsApp", "व्हाट्सऐप": "WhatsApp", "ईमेल": "email", "टूल": "tool",
    "टूल्स": "tools", "सॉफ्टवेयर": "software", "कोड": "code", "प्रॉम्प्ट": "prompt", "मॉडल": "model", "बिजनेस": "business",
    "बिज़नेस": "business", "प्रोडक्ट": "product", "मार्केटिंग": "marketing", "ऑटोमेशन": "automation",
    "वेबसाइट": "website", "लिंक": "link", "फ्री": "free", "प्लान": "plan", "सेटअप": "setup", "होस्ट": "host",
    "होस्त": "host", "आइडिया": "idea", "टिप": "tip", "टिप्स": "tips", "बेसिकली": "basically", "एक्चुअली": "actually",
    "सॉरी": "sorry", "वेट": "wait", "ओके": "okay", "ओक": "okay", "सेकंड": "second", "मिनट": "minute", "मैसेज": "message",
    "सर्च": "search", "क्लिक": "click", "बटन": "button", "स्क्रीन": "screen", "कंटेंट": "content", "क्रिएटर": "creator",
    "रील": "reel", "रील्स": "reels", "पोस्ट": "post", "ट्रेंड": "trend", "ऑडियंस": "audience", "फॉलो": "follow",
    "फॉलोअर्स": "followers", "एजेंट": "agent", "एजेंट्स": "agents", "डैशबोर्ड": "dashboard", "ईज़ी": "easy", "इजी": "easy",
    "फाइव": "five", "फाइब": "five", "वन": "one", "टू": "two", "थ्री": "three",
}


def clean(s):
    """NFC, no zero-width joiners, Devanagari digits as 0-9 (Whisper writes both)."""
    s = ZW.sub("", unicodedata.normalize("NFC", str(s)))
    return "".join(DIGITS.get(c, c) for c in s)


def has_deva(s):
    return bool(DEVA.search(s))


def _aksharas(w):
    """A Devanagari word as syllable parts: [(kind, roman, vowel_or_None)]. kind: "c" a consonant (vowel: its sign,
    "" for the inherent a, None after a virama), "v" an independent vowel, "n" a nasal sign, "h" a visarga."""
    out, i = [], 0
    while i < len(w):
        ch = w[i]
        if ch in CONS:
            rom = CONS[ch]
            if i + 1 < len(w) and w[i + 1] == NUKTA:
                rom = NUKTA_CONS.get(ch, rom)
                i += 1
            vowel = ""
            if i + 1 < len(w) and w[i + 1] in SIGNS:
                vowel = SIGNS[w[i + 1]]
                i += 1
            elif i + 1 < len(w) and w[i + 1] == VIRAMA:
                vowel = None
                i += 1
            out.append(("c", rom, vowel))
        elif ch in VOWELS:
            out.append(("v", VOWELS[ch], None))
        elif ch in (ANUSVARA, CANDRA):
            out.append(("n", "n", None))
        elif ch == VISARGA:
            out.append(("h", "h", None))
        elif ch == NUKTA or ch == VIRAMA:
            pass
        else:
            out.append(("x", ch, None))
        i += 1
    return out


SHORT = {"aa": "a", "ee": "i", "oo": "u"}


def _long(v, first, final):
    """A long vowel as Hinglish spells it: doubled in a word's first syllable (aaj, kaam, teen), single elsewhere
    (dikhana, nahi), and single at the very end."""
    if v in SHORT:
        return v if first and not final else SHORT[v]
    return v


def _edges(w):
    """(lead, core, trail): punctuation and symbols around a word. Vowel signs are part of the word (Python's \\W
    takes them for punctuation)."""
    a, b = 0, len(w)
    while a < b and unicodedata.category(w[a])[0] in "PSZ":
        a += 1
    while b > a and unicodedata.category(w[b - 1])[0] in "PSZ":
        b -= 1
    return w[:a], w[a:b], w[b:]


def romanize_word(w):
    """One Devanagari word in Hinglish spelling. Latin and other text comes back as it was."""
    w = clean(w)
    if not has_deva(w):
        return w
    lead, core, trail = _edges(w)
    if core in COMMON:
        return lead + COMMON[core] + trail
    if core in ENGLISH:
        return lead + ENGLISH[core] + trail
    ak = _aksharas(core)
    n = len(ak)
    # the silent a: dropped at the end of a word after a single consonant, and inside a word between a vowel and a
    # consonant that is said with its vowel (ka-ra-naa -> kar-naa, sa-ma-jha-naa -> sa-majh-naa)
    silent = set()
    voiced = lambda k: ak[k][0] == "v" or (ak[k][0] == "c" and ak[k][2] is not None)   # noqa: E731
    for k in range(n - 1, -1, -1):
        kind, _, vow = ak[k]
        if kind != "c" or vow != "":
            continue
        last_cons = all(ak[j][0] in ("n", "h", "x") for j in range(k + 1, n))
        if last_cons:
            conj = k > 0 and ak[k - 1][0] == "c" and ak[k - 1][2] is None
            if k > 0 and not conj:
                silent.add(k)
            continue
        prev_vowel = k > 0 and voiced(k - 1) and (k - 1) not in silent
        nxt = k + 1
        while nxt < n and ak[nxt][0] in ("n", "h"):
            nxt += 1
        next_cv = nxt < n and ak[nxt][0] == "c" and ak[nxt][2] is not None and nxt not in silent
        if prev_vowel and next_cv:
            silent.add(k)
    out, syll = [], 0
    for k, (kind, rom, vow) in enumerate(ak):
        final = all(ak[j][0] in ("n", "h", "x") for j in range(k + 1, n))
        if kind == "c":
            out.append(rom)
            if vow is None:
                continue
            if vow == "":
                if k not in silent:
                    out.append("a")
                    syll += 1
            else:
                out.append(_long(vow, syll == 0, final))
                syll += 1
        elif kind == "v":
            # a vowel after a vowel is said with a y between them in Hinglish spelling (banaye, gaye)
            if out and out[-1][-1:] in "aeiou" and rom in ("e", "ai"):
                out.append("y")
            out.append(_long(rom, syll == 0, final))
            syll += 1
        elif kind == "n":
            nxt = next((ak[j][1] for j in range(k + 1, n) if ak[j][0] == "c"), "")
            # before n or m the nasal is that letter's own (मैंने maine, not mainne)
            out.append("" if nxt[:1] in ("n", "m") and k + 1 < n and ak[k + 1][0] == "c"
                       else "m" if nxt[:1] in ("p", "b") and nxt != "ph" else "n")
        elif kind == "h":
            out.append("h")
        else:
            out.append(rom)
    s = "".join(out)
    s = re.sub(r"en$", "ein", s) if core.endswith("ें") else s      # में mein, करें karein
    return lead + s + trail


def romanize(text):
    """A transcript line in Hinglish spelling, word by word; Latin words untouched."""
    return " ".join(romanize_word(w) for w in clean(text).split(" "))


FOLD = [(r"rh", "dh"), (r"ph", "f"), (r"w", "v"), (r"z", "j"), (r"q", "k"), (r"x", "ks"), (r"ck", "k"), (r"c(?!h)", "k"),
        (r"aa+", "a"), (r"ee+|ii+", "i"), (r"oo+|uu+", "u"), (r"ei", "e"), (r"ou", "o"),
        (r"(?<=[aeiou])y(?=[aeiou])", ""), (r"(?<=[aeiou])h$", ""), (r"(?<=[aeiou])n$", ""), (r"(.)\1+", r"\1")]


def key(w):
    """A word's sound, the same in either script and in most spellings: करना / karna / karnaa -> "karna"."""
    w = clean(w).lower()
    w = romanize_word(w).lower() if has_deva(w) else w
    w = re.sub(r"[^a-z0-9]", "", w)
    for a, b in FOLD:
        w = re.sub(a, b, w)
    return w


# --- numbers: Hindi number words say every number from 1 to 99 differently --------------------------------
NUMBERS = """एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस
इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस
सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास
इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ
उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी
चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे
निन्यानवे""".split()
EXTRA = {"शून्य": 0, "ज़ीरो": 0, "जीरो": 0, "पांच": 5, "छः": 6, "छे": 6, "छ": 6, "पन्द्रह": 15, "सौ": 100,
         "पाँचवाँ": None}
SCALES = {"सौ": 100, "हज़ार": 1000, "हजार": 1000, "लाख": 100000, "करोड़": 10**7, "करोड": 10**7, "अरब": 10**9}
ROMAN = {"ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "chhah": 6,
         "che": 6, "saat": 7, "sat": 7, "aath": 8, "ath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12,
         "terah": 13, "chaudah": 14, "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18, "unnees": 19, "bees": 20,
         "pachchees": 25, "pachees": 25, "tees": 30, "chalees": 40, "chalis": 40, "pachas": 50, "saath": 60,
         "sattar": 70, "assi": 80, "nabbe": 90, "sau": 100}
ROMAN_SCALES = {"sau": 100, "hazaar": 1000, "hazar": 1000, "lakh": 100000, "crore": 10**7, "karod": 10**7,
                "arab": 10**9}
_BY_KEY = {}
for _i, _w in enumerate(NUMBERS, 1):
    _BY_KEY.setdefault(key(_w), _i)
for _w, _v in EXTRA.items():
    if _v is not None:
        _BY_KEY.setdefault(key(_w), _v)
for _w, _v in ROMAN.items():
    _BY_KEY.setdefault(key(_w), _v)
_SCALE_KEY = {key(w): v for w, v in {**SCALES, **ROMAN_SCALES}.items()}


def number(w):
    """One Hindi number word (Devanagari or Roman) as an int, else None. A scale word on its own is its value."""
    k = key(w)
    if not k:
        return None
    if k in _BY_KEY:
        return _BY_KEY[k]
    return _SCALE_KEY.get(k)


def scale(w):
    """सौ, हज़ार, लाख, करोड़ (or sau, hazaar, lakh, crore) as a multiplier, else None."""
    return _SCALE_KEY.get(key(w))


def demo():
    assert clean("नमस्ते‍") == "नमस्ते" and clean("२५") == "25"
    cases = {"आज": "aaj", "आप": "aap", "काम": "kaam", "करना": "karna", "समझना": "samajhna", "अपना": "apna",
             "दोस्तों": "doston", "घर": "ghar", "कदम": "kadam", "मैं": "main", "में": "mein", "नहीं": "nahi",
             "खुद": "khud", "कैसे": "kaise", "बनाए": "banaye", "दिखाऊँगा": "dikhaunga", "दिखाना": "dikhana",
             "तीन": "teen", "जाना": "jaana", "कमरा": "kamra", "असिस्टेंट": "assistant", "मित्र": "mitra",
             "हिंदी": "hindi", "संबंध": "sambandh", "ज़रूरत": "zaroorat", "बात": "baat", "पहला": "pehla",
             "क्लाउड": "cloud", "सिर्फ": "sirf"}
    got = {w: romanize_word(w) for w in cases}
    bad = {w: (g, cases[w]) for w, g in got.items() if g != cases[w]}
    assert not bad, bad
    assert romanize("दोस्तों, आज मैं आपको AI assistant दिखाऊँगा।") == "doston, aaj main aapko AI assistant dikhaunga।"
    # the same word in either script, and the spellings Hinglish uses for it, share one key
    for a, b in (("करना", "karna"), ("आज", "aaj"), ("आज", "aj"), ("नहीं", "nahi"), ("नहीं", "nahin"),
                 ("मैं", "main"), ("मैं", "mai"), ("तो", "to"), ("तो", "toh"), ("वो", "woh"), ("ज़रूरत", "zarurat"),
                 ("ज़रूरत", "jarurat"), ("फिर", "fir"), ("दोस्तों", "dosto"), ("असिस्टेंट", "assistant"),
                 ("बनाए", "banae"), ("कैसे", "kaise")):
        assert key(a) == key(b), (a, b, key(a), key(b))
    for a, b in (("क्या", "किया"), ("है", "हूँ"), ("एक", "दो"), ("कर", "घर")):
        assert key(a) != key(b), (a, b)
    assert number("पच्चीस") == 25 and number("pachchees") == 25 and number("पाँच") == number("पांच") == 5
    assert number("निन्यानवे") == 99 and number("सौ") == 100 and number("लाख") == 100000 and number("करोड़") == 10**7
    assert number("बात") is None and number("ghar") is None and scale("हज़ार") == 1000 and scale("एक") is None
    print("hindi demo ok")


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["demo"]:
        demo()
