"""English/French presentation without modifying original source evidence."""
import html
import re

NON_LATIN = re.compile(r'[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]')


def french_title(value):
    # The publisher supplies a French subtitle for this multilingual exhibition.
    # Keep that supplied subtitle; do not machine-invent a replacement title.
    text = html.unescape(value or '')
    text = text.replace('\u6728\u3068\u98a8 Bois et Vent', 'Bois et Vent')
    if NON_LATIN.search(text):
        raise ValueError('title_requires_english_or_french_review')
    return text
