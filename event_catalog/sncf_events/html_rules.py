"""Small reviewed HTML adapters; no script execution or inferred booking slots."""
import re
from html.parser import HTMLParser

from .db import digest
from .normalize import Candidate

FABRE_URL = 'https://www.museefabre.fr/offre-de-visites-et-ateliers'
HTML_CONNECTORS = {'jsonld', 'fabre_school_offers'}


class TextBlocks(HTMLParser):
    """Deterministic visible text blocks, shared by extraction and evidence audit."""
    boundaries = {'p','div','section','article','li','br','h1','h2','h3','h4','h5','h6'}
    voids = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    ignored = {'script','style','noscript','template','head','nav','form'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.parts, self.stack = [], [], []

    def flush(self):
        value = ' '.join(''.join(self.parts).split())
        self.parts = []
        if value:
            if len(self.blocks)>=20000:
                raise ValueError('html_block_budget_exceeded')
            tag = next((tag for tag,hidden in reversed(self.stack) if re.fullmatch(r'h[1-6]',tag)), 'text')
            self.blocks.append({'tag':tag,'text':value})

    def handle_starttag(self,tag,attrs):
        if tag in self.boundaries:
            self.flush()
        attrs = dict(attrs)
        hidden = (bool(self.stack and self.stack[-1][1]) or tag in self.ignored
                  or 'hidden' in attrs or attrs.get('aria-hidden')=='true'
                  or bool(re.search(r'(display\s*:\s*none|visibility\s*:\s*hidden)',attrs.get('style',''),re.I)))
        if tag not in self.voids:
            self.stack.append((tag,hidden))
            if len(self.stack)>256:
                raise ValueError('html_nesting_budget_exceeded')

    def handle_endtag(self,tag):
        if tag in self.boundaries:
            self.flush()
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                del self.stack[i:]
                break

    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if tag not in self.voids:
            self.handle_endtag(tag)

    def handle_data(self,value):
        if not (self.stack and self.stack[-1][1]):
            self.parts.append(value)


def html_blocks(body):
    parser = TextBlocks()
    parser.feed(body)
    parser.flush()
    return parser.blocks


def html_evidence(blocks,locator):
    match = re.fullmatch(r'html-block\[(\d+)\]',locator)
    if match:
        return blocks[int(match[1])]['text']
    match = re.fullmatch(r'html-range\[(\d+):(\d+)\]',locator)
    if not match:
        raise ValueError('invalid_html_locator')
    start,end = map(int,match.groups())
    if not 0<=start<end<=len(blocks):
        raise ValueError('invalid_html_range')
    return [b['text'] for b in blocks[start:end]]


def fabre_offers(body,source_id):
    if source_id!='S097':
        raise ValueError('fabre_source_must_be_S097')
    blocks = html_blocks(body)
    texts = [b['text'] for b in blocks]
    def find_exact(value):
        try:
            return texts.index(value)
        except ValueError as exc:
            raise ValueError('school_page_structure_changed') from exc
    city = find_exact('34000 Montpellier - France')
    school_heading = find_exact('Offre à destination des publics scolaires')
    booking = next((i for i,v in enumerate(texts) if v.startswith('Pour toute visite libre ou guidée,') and 'formulaire de réservation' in v),None)
    if booking is None:
        raise ValueError('school_booking_evidence_missing')
    sections = [i for i,b in enumerate(blocks) if b['tag']=='h3' and b['text'].startswith('Exposition :')]
    grade = re.compile(r'^(?:Maternelles|Du (?:CP|CM1) à la 6ème|Cycle [1-4](?: |$)|Cycles [1-4] et [1-4])')
    formats = {'Visite guidée','Visites guidées','Visite atelier','Visite-atelier'}
    count = 0
    for start in sections:
        end = next((i for i in range(start+1,len(blocks)) if blocks[i]['tag'] in {'h2','h3'}),len(blocks))
        stop = next((i for i in range(start+1,end) if texts[i].startswith(('RENDEZ-VOUS ENSEIGNANTS','RESSOURCES PEDAGOGIQUES'))),end)
        # Reviewed exhibition-to-building binding. New exhibitions require review.
        section = texts[start]
        if section=='Exposition : Le design selon Pierre Paulin':
            address = find_exact('Boulevard Bonne Nouvelle')
            location = find_exact('Musée Fabre')
        elif section=="Exposition : Chine, Chefs d'oeuvre du musée Guimet":
            address = find_exact('6 bis rue Montpelliéret')
            location = find_exact('Hôtel Sabatier')
            if not any("l'hôtel de Cabrières Sabatier D'Espeyran" in t for t in texts[start:stop]):
                raise ValueError('school_venue_evidence_missing')
        else:
            raise ValueError('school_exhibition_requires_review')
        grades = [i for i in range(start+1,stop) if grade.match(texts[i])]
        if not grades:
            raise ValueError('school_offers_missing')
        for n,g in enumerate(grades):
            last = grades[n+1] if n+1<len(grades) else stop
            title_index = next((i for i in range(g+1,last) if texts[i] not in formats),None)
            if title_index is None:
                raise ValueError('school_offer_title_missing')
            title = texts[title_index].removeprefix('→').strip()
            if not title or len(title)>250 or 'Durée' in title:
                raise ValueError('school_offer_title_invalid')
            durations = [(i,re.fullmatch(r'[∗*]?\s*Durée\s*:\s*(\d{1,2})h(\d{2})',texts[i])) for i in range(title_index+1,last)]
            durations = [(i,m) for i,m in durations if m]
            if len(durations)>1 or (durations and int(durations[0][1][2])>=60):
                raise ValueError('school_duration_ambiguous')
            description = [i for i in range(title_index+1,last) if texts[i] not in formats and not texts[i].startswith(('∗','*','⇢','Durée'))]
            if not description:
                raise ValueError('school_description_missing')
            c = Candidate('educational_offer','html:S097',digest(section+'|'+title),{},f'html-range[{g}:{last}]',method='html_rule')
            def assign(name,index,value=None):
                c.data[name] = texts[index] if value is None else value
                c.evidence[name] = {'locator':f'html-block[{index}]','value':texts[index]}
            assign('title',title_index,title)
            assign('city',city,'Montpellier')
            # Fixed reviewed municipality mapping, never infer an INSEE from a postcode.
            assign('department_code',city,'34')
            assign('address',address)
            assign('location_name',location)
            assign('theme',start)
            assign('description',description[0])
            c.data['school'] = {'school_groups':'confirmed','grade_levels':[texts[g]],'booking_required':'yes'}
            c.evidence['school'] = {'locator':c.locator,'value':html_evidence(blocks,c.locator)}
            c.evidence['school.school_groups'] = {'locator':f'html-block[{school_heading}]','value':texts[school_heading]}
            c.evidence['school.booking_required'] = {'locator':f'html-block[{booking}]','value':texts[booking]}
            if durations:
                i,m = durations[0]
                c.data['school']['duration_minutes'] = int(m[1])*60+int(m[2])
                c.evidence['school.duration_minutes'] = {'locator':f'html-block[{i}]','value':texts[i]}
            c.data.update(status='unknown',occurrences=[],schedule_semantics='on_request_no_published_slots',
                          conditions_text=' '.join(texts[title_index+1:last]))
            c.evidence['conditions_text'] = {'locator':c.locator,'value':html_evidence(blocks,c.locator)}
            c.issues.extend(['offer_validity_unconfirmed','group_capacity_unknown','booking_slots_unpublished'])
            count += 1
            yield c.locator,{'title':title,'block_start':g},lambda c=c:c
    if not count:
        raise ValueError('school_offers_missing')
