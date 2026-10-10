"""Conservative mappings: missing facts remain null; dates are never rolled forward."""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from html import unescape
from urllib.parse import quote, urlsplit, urlunsplit

from .db import DEPARTMENTS, digest, dumps, loads
from .policy import timestamp, validate_public_url

STATUSES = {'scheduled','rescheduled','postponed','cancelled','full','moved_online','unknown'}


def pointer(value, path):
    for part in path.split('/')[1:]:
        part = part.replace('~1','/').replace('~0','~')
        value = value[int(part)] if isinstance(value,list) else value[part]
    return value


def optional(value, path, default=None):
    try:
        return pointer(value,path)
    except (KeyError,IndexError,TypeError,ValueError):
        return default


def text(value):
    if isinstance(value,str):
        return value.strip() or None
    if isinstance(value,list):
        return text(value[0]) if value else None
    if isinstance(value,dict):
        for key in ('fr','@fr','en','@en','@value','value','label'):
            if key in value:
                return text(value[key])
    return None


def public_link(value):
    if not isinstance(value,str):
        return None
    try:
        validate_public_url(value.strip())
    except ValueError:
        return None
    return value.strip()


def assign_link(c, name, paths, skip=()):
    """First published public web link; an unusable or absent link stays null and never rejects the record."""
    for path in paths:
        link = public_link(optional(c.raw,path))
        if link and link not in skip:
            return c.assign(name,path,public_link)
    c.data[name] = None


def link_paths(raw, base):
    """JSON pointers to every `homepage` entry of a DATAtourisme contact list."""
    contacts = optional(raw,base)
    contacts = contacts if isinstance(contacts,list) else []
    result = []
    for i,contact in enumerate(contacts):
        pages = contact.get('homepage') if isinstance(contact,dict) else None
        if isinstance(pages,list):
            result += [f'{base}/{i}/homepage/{j}' for j in range(len(pages))]
        elif pages is not None:
            result.append(f'{base}/{i}/homepage')
    return result


def first_path(raw, base):
    return base+'/0' if isinstance(optional(raw,base),list) else base


@dataclass
class Candidate:
    kind: str
    provider: str
    external_id: str
    raw: dict
    locator: str
    method: str = 'api'
    data: dict = field(default_factory=dict)
    evidence: dict = field(default_factory=dict)
    issues: list = field(default_factory=list)

    def assign(self, name, path, transform=lambda x:x):
        raw_value = optional(self.raw,path)
        value = transform(raw_value) if raw_value is not None else None
        self.data[name] = value
        if value is not None:
            self.evidence[name] = {'locator':self.locator+path,'value':raw_value}
        return value

    def validate(self):
        if self.kind not in {'event','venue','educational_offer'}:
            raise ValueError('invalid_entity_kind')
        if not self.external_id or len(self.external_id)>1024:
            raise ValueError('missing_stable_id')
        if not isinstance(self.data.get('title'),str) or not self.data['title']:
            raise ValueError('missing_title')
        dept = self.data.get('department_code')
        if dept not in DEPARTMENTS:
            raise ValueError('unverified_location' if not dept else 'outside_occitanie')
        commune = self.data.get('commune_code')
        if commune and (not re.fullmatch(r'\d{5}',commune) or commune[:2]!=dept):
            raise ValueError('inconsistent_commune_department')
        for key,limit in [('latitude',90),('longitude',180)]:
            value = self.data.get(key)
            if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or abs(value)>limit):
                raise ValueError('invalid_coordinates')
        if self.data.get('canonical_url'):
            validate_public_url(self.data['canonical_url'])
        status = self.data.setdefault('status','unknown')
        if status not in STATUSES:
            raise ValueError('invalid_status')
        if self.data.get('source_updated_at'):
            self.data['source_updated_at'] = timestamp(self.data['source_updated_at'])
        if self.data.get('source_updated_date'):
            self.data['source_updated_date'] = date.fromisoformat(self.data['source_updated_date']).isoformat()
        for name in ('title','department_code','commune_code','latitude','longitude','status',
                     'source_updated_at','source_updated_date','description','canonical_url','school'):
            value = self.data.get(name)
            if value is not None and value!='unknown' and name not in self.evidence:
                raise ValueError('missing_field_evidence:'+name)
        if self.kind=='event' and not any(s.get('precision') in ('date','datetime') for s in self.data.get('occurrences') or []):
            self.issues.append('missing_occurrences')
        periods = {}
        for occurrence in self.data.get('occurrences') or []:
            fact = {k:v for k,v in occurrence.items() if k!='evidence_locator'}
            key = occurrence['slot_key']
            if key in periods and periods[key]!=fact:
                raise ValueError('conflicting_duplicate_occurrence')
            periods[key] = fact
        school = self.data.get('school') or {}
        if not isinstance(school,dict):
            raise ValueError('invalid_school_conditions')
        for field_name in ('min_age','max_age','min_group','max_group','duration_minutes','notice_days'):
            value = school.get(field_name)
            if value is not None and type(value) is not int:
                raise ValueError('school_number_must_be_integer:'+field_name)
        for field_name in ('grade_levels','languages'):
            values = school.get(field_name,[])
            if not isinstance(values,list) or any(not isinstance(v,str) for v in values):
                raise ValueError('school_list_invalid:'+field_name)
        if school.get('booking_url'):
            validate_public_url(school['booking_url'])
        if school.get('price_amount') is not None:
            try:
                amount = Decimal(str(school['price_amount']))
                if not amount.is_finite() or amount<0:
                    raise ValueError('invalid_price')
            except InvalidOperation as exc:
                raise ValueError('invalid_price') from exc
        if self.data.get('edition_year') is not None and (type(self.data['edition_year']) is not int or not 1900<=self.data['edition_year']<=2200):
            raise ValueError('invalid_edition_year')
        if school.get('school_groups','unknown')=='unknown':
            self.issues.append('school_group_conditions_unknown')
        if self.data.get('latitude') is None or self.data.get('longitude') is None:
            self.issues.append('coordinates_missing')
        return self


def slot(begin, end, status, locator, timezone=None, rule=None, exceptions=None):
    result = dict(start_at=None,end_at=None,start_date=None,end_date=None,timezone=timezone,
                  precision='unknown',status=status,evidence_locator=locator,
                  recurrence_rule=rule,exceptions=exceptions or [])
    if begin:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(begin)):
            result.update(start_date=date.fromisoformat(begin).isoformat(),precision='date')
            if end:
                result['end_date'] = date.fromisoformat(end).isoformat()
                if result['end_date']<result['start_date']:
                    raise ValueError('end_before_start')
        else:
            result.update(start_at=timestamp(begin),precision='datetime')
            if end:
                result['end_at'] = timestamp(end)
                if result['end_at']<result['start_at']:
                    raise ValueError('end_before_start')
    elif end:
        raise ValueError('end_without_start')
    result['slot_key'] = digest(dumps([begin,end,rule,exceptions]))[:24]
    return result


def infer_department(value):
    if isinstance(value,str) and re.fullmatch(r'\d{5}',value):
        return value[:2]
    return None


def region_event(raw, locator='/results/0'):
    """The Region's dataset publishes date ranges, not bookable time slots."""
    def clean_url(value):
        if not text(value):
            return None
        p = urlsplit(unescape(text(value)))
        return urlunsplit((p.scheme,p.netloc,quote(p.path,safe="/%:@-._~!$&'()*+,;="),p.query,p.fragment))
    url = clean_url(raw.get('url'))
    p = validate_public_url(url or '',https_only=True)
    if p.hostname not in {'www.laregion.fr','laregion.fr'} or not p.path.strip('/') or p.query or p.fragment:
        raise ValueError('invalid_region_event_url')
    c = Candidate('event','occitanie-region',url,raw,locator)
    clean = lambda v:unescape(text(v)) if text(v) else None
    c.assign('title','/titre',clean)
    c.assign('description','/description',clean)
    c.assign('canonical_url','/url',clean_url)
    c.assign('commune_code','/code_insee',text)
    c.assign('department_code','/code_insee',infer_department)
    c.assign('address','/adresse',clean)
    c.assign('city','/commune',clean)
    c.assign('latitude','/geo_point_2d/lat')
    c.assign('longitude','/geo_point_2d/lon')
    c.assign('theme','/thematique',clean)
    c.assign('source_calendar','/type',clean)
    c.assign('schedule_text','/date',clean)
    c.data['status'] = 'unknown'
    for key in ('date_debut','date_fin'):
        if raw.get(key) is not None and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(raw[key])):
            raise ValueError('dataset_expected_date_precision')
    period = slot(raw.get('date_debut'),raw.get('date_fin'),'unknown',locator+'/date_debut')
    c.assign('occurrences','/date_debut',lambda _: [period])
    c.assign('published_end_date','/date_fin')
    c.data['schedule_semantics'] = 'published_date_range'
    c.issues.extend(['exact_hours_unknown','status_not_published','record_update_time_unknown'])
    if period['start_date'] and period['end_date'] and period['start_date']!=period['end_date']:
        c.issues.append('date_range_not_daily_availability')
    if '…' in (c.data.get('description') or '') or '(...)' in (c.data.get('description') or ''):
        c.issues.append('source_description_is_excerpt')
    # A valid global coordinate can still be a bad geocode; never use it for rail claims.
    lat,lon = c.data.get('latitude'),c.data.get('longitude')
    if isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and not (42<=lat<=45.2 and -0.5<=lon<=5):
        c.issues.append('coordinates_outside_region_envelope')
    return c


def oa_event(raw, locator='/events/0'):
    if raw.get('state') != 2:
        raise ValueError('not_explicitly_published')
    if not re.fullmatch(r'\d{1,20}',str(raw.get('uid') or '')):
        raise ValueError('missing_stable_id')
    c = Candidate('event','openagenda',str(raw.get('uid') or ''),raw,locator)
    c.assign('title','/title',text)
    c.assign('description','/description',text)
    c.assign('canonical_url','/canonicalUrl',text)
    c.assign('source_updated_at','/updatedAt')
    c.assign('commune_code','/location/insee',text)
    c.assign('department_code','/location/insee',infer_department)
    if not c.data['department_code']:
        c.assign('department_code','/location/department',lambda v: next((k for k,n in DEPARTMENTS.items() if v in (k,n)),None))
    c.assign('latitude','/location/latitude')
    c.assign('longitude','/location/longitude')
    c.assign('address','/location/address',text)
    c.assign('city','/location/city',text)
    c.assign('location_name','/location/name',text)
    assign_link(c,'venue_url',['/location/website'])
    entries = raw.get('registration') if isinstance(raw.get('registration'),list) else []
    assign_link(c,'booking_url',[f'/registration/{i}/value' for i,r in enumerate(entries)
                                 if isinstance(r,dict) and r.get('type')=='link'])
    c.assign('status','/status',lambda v:{1:'scheduled',2:'rescheduled',3:'moved_online',4:'postponed',5:'full',6:'cancelled'}.get(v,'unknown'))
    c.data['status'] = c.data.get('status') or 'unknown'
    c.assign('attendance_mode','/attendanceMode')
    c.assign('conditions_text','/conditions',text)
    c.assign('age','/age')
    c.assign('occurrences','/timings',lambda timings:[
        slot(t.get('begin'),t.get('end'),c.data['status'],locator+f'/timings/{i}',raw.get('timezone'))
        for i,t in enumerate(timings)])
    c.assign('upstream_identifiers','/extIds')
    c.assign('venue_external_id','/location/uid',str)
    return c


def datatourisme(raw, kind, locator='/objects/0'):
    c = Candidate(kind,'datatourisme',str(raw.get('uuid') or ''),raw,locator)
    loc = first_path(raw,'/isLocatedAt')
    address = first_path(raw,loc+'/address')
    city = first_path(raw,address+'/hasAddressCity')
    dept = first_path(raw,city+'/isPartOfDepartment')
    desc = first_path(raw,'/hasDescription')
    c.assign('title','/label',text)
    c.assign('description',desc+'/description',text)
    c.assign('canonical_url','/uri',text)
    c.assign('source_updated_at','/lastUpdate')
    # API lastUpdate can be a date only. Keep its original precision, never invent midnight.
    if c.data.get('source_updated_at') and re.fullmatch(r'\d{4}-\d{2}-\d{2}',c.data['source_updated_at']):
        c.assign('source_updated_date','/lastUpdate')
        c.data['source_updated_at'] = None
    c.assign('commune_code',city+'/insee',text)
    c.assign('department_code',dept+'/insee',text)
    if not c.data['department_code']:
        c.assign('department_code',city+'/insee',infer_department)
    c.assign('latitude',loc+'/geo/latitude')
    c.assign('longitude',loc+'/geo/longitude')
    c.assign('address',address+'/streetAddress',text)
    c.assign('city',address+'/addressLocality',text)
    c.assign('producer','/hasBeenCreatedBy')
    assign_link(c,'booking_url',link_paths(raw,'/hasBookingContact'))
    # Contact pages repeat the ticketing link; the organiser page is the first one that is not ticketing.
    assign_link(c,'official_url',link_paths(raw,'/hasContact'),
                {public_link(optional(raw,p)) for p in link_paths(raw,'/hasBookingContact')})
    c.assign('provider_types','/type')
    c.data['status'] = 'unknown'
    if kind=='event':
        c.assign('schedule_periods','/takesPlaceAt')
        periods = raw.get('takesPlaceAt',[])
        if isinstance(periods,dict):
            periods = [periods]
        times = []
        for i,p in enumerate(periods):
            ploc = '/takesPlaceAt/'+str(i) if isinstance(raw.get('takesPlaceAt'),list) else '/takesPlaceAt'
            times.append(slot(p.get('startDate'),p.get('endDate'),'unknown',locator+ploc,
                              rule=dumps(p) if p.get('appliesOnDay') or p.get('openingHours') else None))
            if p.get('startTime') or p.get('endTime') or p.get('appliesOnDay'):
                c.issues.append('period_requires_schedule_review')
        c.assign('occurrences','/takesPlaceAt',lambda _:times)
    else:
        c.assign('public_opening_information',loc+'/openingHoursSpecification')
        c.issues.append('educational_suitability_unreviewed')
    return c


class JSONLDScripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts = []
        self.active = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower()=='script':
            self.active = dict(attrs).get('type','').lower().split(';')[0].strip()=='application/ld+json'
            self.parts = []

    def handle_data(self,data):
        if self.active:
            self.parts.append(data)

    def handle_endtag(self,tag):
        if tag.lower()=='script' and self.active:
            self.scripts.append(''.join(self.parts))
            self.active = False


def jsonld_nodes(html):
    parser = JSONLDScripts()
    parser.feed(html)
    for i,script in enumerate(parser.scripts):
        try:
            root = loads(script)
        except (ValueError,RecursionError):
            yield f'script[{i}]',None
            continue
        stack = [(root,f'script[{i}]')]
        visited = 0
        while stack:
            value,path = stack.pop()
            visited += 1
            if visited>10000:
                raise ValueError('jsonld_graph_too_large')
            if isinstance(value,list):
                stack.extend((v,path+'/'+str(j)) for j,v in reversed(list(enumerate(value))))
            elif isinstance(value,dict):
                types = value.get('@type',[])
                types = [types] if isinstance(types,str) else types
                if any(t.split('/')[-1] in {'Event','EducationEvent','ChildrensEvent','ExhibitionEvent','Festival','TheaterEvent','MusicEvent'} for t in types if isinstance(t,str)):
                    yield path,value
                for key in ('@graph','itemListElement','item','mainEntity'):
                    if key in value:
                        stack.append((value[key],path+'/'+key))


def jsonld_event(raw, source_id, locator):
    identifier = raw.get('@id') or raw.get('url')
    # Page-local stable identity when no publisher ID exists; require manual review.
    fallback = digest(dumps([raw.get('name'),raw.get('startDate'),raw.get('location')]))
    c = Candidate('event','jsonld:'+source_id,str(identifier or fallback),raw,locator,'jsonld')
    if not identifier:
        c.issues.append('publisher_id_missing')
    c.assign('title','/name',text)
    c.assign('description','/description',text)
    c.assign('canonical_url','/url',text)
    c.assign('source_updated_at','/dateModified')
    if c.data.get('source_updated_at') and re.fullmatch(r'\d{4}-\d{2}-\d{2}',c.data['source_updated_at']):
        c.assign('source_updated_date','/dateModified')
        c.data['source_updated_at'] = None
    c.assign('department_code','/location/address/addressRegion',lambda v: next((k for k,n in DEPARTMENTS.items() if v in (k,n)),None))
    c.assign('commune_code','/location/address/insee',text)
    if not c.data.get('department_code'):
        c.assign('department_code','/location/address/insee',infer_department)
    c.assign('latitude','/location/geo/latitude')
    c.assign('longitude','/location/geo/longitude')
    c.assign('address','/location/address/streetAddress',text)
    c.assign('city','/location/address/addressLocality',text)
    c.assign('location_name','/location/name',text)
    c.assign('status','/eventStatus',lambda v:{'EventScheduled':'scheduled','EventCancelled':'cancelled',
        'EventPostponed':'postponed','EventRescheduled':'rescheduled','EventMovedOnline':'moved_online'}.get(str(v).split('/')[-1],'unknown'))
    c.data['status'] = c.data.get('status') or 'unknown'
    if raw.get('startDate'):
        c.data['occurrences'] = [slot(raw['startDate'],raw.get('endDate'),c.data['status'],locator+'/startDate')]
        c.evidence['occurrences'] = {'locator':locator+'/startDate','value':raw['startDate']}
        if raw.get('endDate'):
            c.evidence['occurrences.end'] = {'locator':locator+'/endDate','value':raw['endDate']}
    return c


def manual_record(raw, source_id, locator='/records/0'):
    # This adapter is for attributed organizer exports, NOT free-form model assertions.
    c = Candidate(raw['kind'],'manual:'+source_id,str(raw.get('external_id') or ''),raw,locator,'manual')
    allowed = {'title','description','canonical_url','department_code','commune_code','latitude','longitude',
               'address','city','location_name','status','source_updated_at','edition_year','school',
               'public_opening_information','learning_topics','booking_conditions'}
    for key in allowed:
        c.assign(key,'/'+key)
    c.data['status'] = c.data.get('status') or 'unknown'
    if 'occurrences' in raw:
        c.assign('occurrences','/occurrences',lambda values:[
            slot(t.get('begin'),t.get('end'),t.get('status',c.data['status']),locator+f'/occurrences/{i}',
                 t.get('timezone'),t.get('recurrence_rule'),t.get('exceptions')) for i,t in enumerate(values)])
    if c.kind!='event' and c.data.get('occurrences'):
        raise ValueError('only_events_have_occurrences')
    return c
