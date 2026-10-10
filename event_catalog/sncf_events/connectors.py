"""Reviewed API contracts; no universal crawl or automated source activation."""
from __future__ import annotations

import json
import math
import os
import re
from datetime import date
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from .db import DEPARTMENTS, audit, dumps, loads, now
from .http import Client, FetchError
from .html_rules import FABRE_URL, HTML_CONNECTORS
from .ingest import finish_run, ingest_page, snapshot, start_run
from .policy import require_read_permission, strip_secrets_from_url, timestamp, validate_public_url

CONNECTORS = {'datatourisme_events','datatourisme_places','openagenda_events','openagenda_agendas','jsonld','occitanie_region_events','fabre_school_offers'}
REGION_DATASET = 'https://data.laregion.fr/api/explore/v2.1/catalog/datasets/agendas-participatif-des-sorties-en-occitanie'


def install_default_endpoints(conn):
    defaults = [('datatourisme-events','S001','datatourisme_events',{}),
                ('datatourisme-places','S001','datatourisme_places',{}),
                ('openagenda-occitanie','S002','openagenda_agendas',{'search':'Occitanie'}),
                ('openagenda-science','S002','openagenda_agendas',{'search':'Fête de la science'}),
                ('openagenda-patrimoine','S002','openagenda_agendas',{'search':'Journées européennes du patrimoine'}),
                ('occitanie-region','S007','occitanie_region_events',{})]
    for eid,sid,name,config in defaults:
        if not conn.execute('SELECT 1 FROM endpoints WHERE id=?',(eid,)).fetchone():
            configure_endpoint(conn,eid,sid,name,config)


def configure_endpoint(conn, endpoint_id, source_id, connector, config):
    if not isinstance(config,dict):
        raise ValueError('endpoint_configuration_must_be_object')
    config = dict(config)
    if connector not in CONNECTORS:
        raise ValueError('connector_not_implemented')
    allowed = ({'from_date'} if connector=='occitanie_region_events' else
               {'url'} if connector in HTML_CONNECTORS else
               {'agenda_uid','search','updated_since','starts_after'} if connector=='openagenda_events' else
               {'search','updated_since'})
    if set(config)-allowed:
        raise ValueError('unknown_endpoint_configuration')
    if connector=='fabre_school_offers':
        if source_id!='S097' or config.get('url',FABRE_URL)!=FABRE_URL:
            raise ValueError('fabre_requires_reviewed_source_and_path')
        url = FABRE_URL
    elif connector=='occitanie_region_events':
        if source_id!='S007':
            raise ValueError('region_dataset_source_must_be_S007')
        if 'from_date' in config:
            if not isinstance(config['from_date'],str):
                raise ValueError('from_date_must_be_ISO_date_text')
            config['from_date'] = date.fromisoformat(config['from_date']).isoformat()
        url = REGION_DATASET+'/records'
    elif connector.startswith('datatourisme_'):
        if source_id!='S001':
            raise ValueError('datatourisme_source_must_be_S001')
        url = 'https://api.datatourisme.fr/v1/'+('entertainmentAndEvent' if connector.endswith('events') else 'placeOfInterest')
    elif connector.startswith('openagenda_'):
        if source_id!='S002':
            raise ValueError('openagenda_source_must_be_S002')
        url = 'https://api.openagenda.com/v2/agendas'
        if connector=='openagenda_events':
            uid = str(config.get('agenda_uid',''))
            if not re.fullmatch(r'\d{1,20}',uid):
                raise ValueError('agenda_uid_required')
            url += '/'+uid+'/events'
    else:
        url = config.get('url','')
        p = validate_public_url(url,https_only=True)
        source = conn.execute('SELECT entry_url FROM sources WHERE id=?',(source_id,)).fetchone()
        if not source or p.hostname!=urlsplit(source[0]).hostname:
            raise ValueError('html_endpoint_must_match_registered_host')
        if p.query or p.fragment:
            raise ValueError('html_endpoint_requires_exact_path_without_query')
    if config.get('updated_since'):
        config['updated_since'] = timestamp(config['updated_since'])
    if 'starts_after' in config:
        config['starts_after'] = timestamp(config['starts_after'])
    if config.get('search') and (not isinstance(config['search'],str) or len(config['search'])>200):
        raise ValueError('invalid_search')
    with conn:
        # Editing an endpoint disables it and never rewrites previous run evidence.
        conn.execute('INSERT INTO endpoints(id,source_id,connector,url,config_json) VALUES (?,?,?,?,?) '
                     'ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,connector=excluded.connector,url=excluded.url,config_json=excluded.config_json,enabled=0',
                     (endpoint_id,source_id,connector,url,dumps(config)))
        audit(conn,'configure_endpoint',endpoint_id,{'connector':connector,'config':config})


def enable_endpoint(conn, endpoint_id):
    row = conn.execute('SELECT * FROM endpoints WHERE id=?',(endpoint_id,)).fetchone()
    if not row:
        raise ValueError('unknown_endpoint')
    require_read_permission(conn,row['source_id'])
    with conn:
        conn.execute('UPDATE endpoints SET enabled=1 WHERE id=?',(endpoint_id,))
        audit(conn,'enable_endpoint',endpoint_id,{})


def initial_url(endpoint):
    name = endpoint['connector']
    config = json.loads(endpoint['config_json'])
    params = []
    if name=='occitanie_region_events':
        params = [('limit','50'),('offset','0'),('order_by','date_debut ASC, url ASC')]
        where = []
        if config.get('from_date'):
            where.append("date_fin >= date'"+config['from_date']+"'")
        if config.get('to_date'):
            where.append("date_debut <= date'"+config['to_date']+"'")
        if where:
            params.append(('where',' AND '.join(where)))
    elif name.startswith('datatourisme_'):
        filters = 'isLocatedAt.address.hasAddressCity.isPartOfDepartment.insee[in]='+','.join(DEPARTMENTS)
        if config.get('updated_since'):
            filters += ' AND lastUpdate[gte]='+config['updated_since']
        if config.get('from_date'):
            filters += (' AND takesPlaceAt.startDate[lte]='+config['to_date']+
                        ' AND (takesPlaceAt.endDate[gte]='+config['from_date']+
                        ' OR takesPlaceAt.startDate[gte]='+config['from_date']+')')
        fields = 'uuid,uri,label,type,isLocatedAt.address,isLocatedAt.geo,isLocatedAt.openingHoursSpecification,hasDescription,lastUpdate,hasBeenCreatedBy.legalName,takesPlaceAt'
        params = [('page_size','50'),('lang','fr'),('fields',fields),('filters',filters)]
    elif name.startswith('openagenda_'):
        params = [('size','50')]
        if name=='openagenda_events':
            params += [('removed','null'),('sort','updatedAt.asc')]
            fields = ['uid','title','description','canonicalUrl','state','status','removed','updatedAt',
                      'timings','timezone','location.uid','location.insee','location.department',
                      'location.latitude','location.longitude','location.address','location.city',
                      'location.name','conditions','age','attendanceMode','extIds']
            params += [('includeFields[]',field) for field in fields]
        if config.get('updated_since'):
            params.append(('updatedAt[gte]' if name.endswith('events') else 'updatedAt.gte',config['updated_since']))
        if config.get('starts_after'):
            params.append(('timings[gte]',config['starts_after']))
        if config.get('ends_before'):
            params.append(('timings[lte]',config['ends_before']))
    if config.get('search'):
        params.append(('search',config['search']))
    return endpoint['url']+('?' + urlencode(params) if params else '')


def next_url(endpoint, current_url, document):
    name = endpoint['connector']
    if name=='occitanie_region_events':
        total,rows = document.get('total_count'),document.get('results')
        if type(total) is not int or total<0 or not isinstance(rows,list):
            raise ValueError('invalid_pagination_metadata')
        p = urlsplit(current_url)
        params = dict(parse_qsl(p.query))
        offset,limit = int(params.get('offset',0)),int(params.get('limit',50))
        if offset<0 or not 1<=limit<=100 or len(rows)>limit:
            raise ValueError('invalid_page_size')
        if not rows and offset<total:
            raise ValueError('unexpected_empty_page')
        if offset+len(rows)>=total:
            return None
        if len(rows)<limit:
            raise ValueError('inconsistent_total_count')
        # Explore API offset paging is bounded, not an unlimited export endpoint.
        if offset+limit>=10000:
            raise ValueError('dataset_offset_limit_reached')
        params['offset'] = str(offset+len(rows))
        return urlunsplit((p.scheme,p.netloc,p.path,urlencode(params),''))
    if name.startswith('datatourisme_'):
        meta = document.get('meta')
        if not isinstance(meta,dict) or 'next' not in meta:
            raise ValueError('missing_pagination_metadata')
        target = meta['next']
        if target is None:
            return None
        if not isinstance(target,str) or not target:
            raise ValueError('invalid_next_link')
        # Official docs show both HTTP and relative next links; always retain TLS.
        target = strip_secrets_from_url(urljoin(current_url,target))
        p = urlsplit(target)
        if p.hostname!='api.datatourisme.fr' or p.path not in {'/v1/catalog',urlsplit(endpoint['url']).path}:
            raise ValueError('pagination_left_approved_scope')
        target = urlunsplit(('https',p.netloc,p.path,p.query,''))
        validate_public_url(target,https_only=True)
        # A catalog next link must retain the event/place selection as delivered by the API.
        if p.path=='/v1/catalog' and not any(k in ('filters','type') for k,v in parse_qsl(p.query)):
            raise ValueError('catalog_next_missing_scope_filter')
        return target
    if name.startswith('openagenda_'):
        if 'after' not in document:
            raise ValueError('missing_pagination_metadata')
        after = document['after']
        if after is None:
            return None
        if not isinstance(after,list) or not after or len(after)>20 or any(
                type(x) not in (str,int,float) or (type(x) is float and not math.isfinite(x)) for x in after):
            raise ValueError('invalid_after_cursor')
        p = urlsplit(initial_url(endpoint))
        params = parse_qsl(p.query)+[('after[]',str(x)) for x in after]
        return urlunsplit((p.scheme,p.netloc,p.path,urlencode(params),''))
    return None


def sanitize_payload(body, secret):
    # Remove the active credential and authentication query parameters from pagination.
    if secret:
        body = body.replace(secret,'[REDACTED]').replace(json.dumps(secret)[1:-1],'[REDACTED]')
    try:
        doc = loads(body)
    except (ValueError,RecursionError):
        # Preserve malformed response evidence; ingest_page quarantines the envelope.
        return body
    if isinstance(doc,dict) and isinstance(doc.get('meta'),dict):
        for key in ('next','previous'):
            if isinstance(doc['meta'].get(key),str):
                doc['meta'][key] = strip_secrets_from_url(doc['meta'][key])
    return dumps(doc)


def scoped_endpoint(endpoint, window_dates=None, delta_since=None):
    """Job-local scope; never edits an operator's enabled endpoint configuration."""
    endpoint = dict(endpoint)
    config = json.loads(endpoint['config_json'])
    if window_dates:
        from datetime import datetime, timedelta
        from .search import window
        first,last = window_dates
        lo,hi = window(first,last)
        config.pop('updated_since',None)
        if endpoint['connector']=='openagenda_events':
            config.update(starts_after=lo,ends_before=(datetime.fromisoformat(hi)-timedelta(microseconds=1)).isoformat())
        elif endpoint['connector'] in ('datatourisme_events','occitanie_region_events'):
            config.update(from_date=first,to_date=last)
        else:
            raise ValueError('endpoint_does_not_support_date_window')
    if delta_since:
        if endpoint['connector']!='openagenda_events' or window_dates:
            raise ValueError('invalid_delta_scope')
        config.pop('starts_after',None)
        config.pop('ends_before',None)
        config['updated_since'] = timestamp(delta_since)
    endpoint['config_json'] = dumps(config)
    return endpoint


def run_endpoint(conn, endpoint_id, *, max_pages=3, resume=None, client_factory=Client, window_dates=None, delta_since=None, on_run=None):
    if not 1<=max_pages<=10:
        raise ValueError('max_pages_must_be_1_to_10')
    endpoint = conn.execute('SELECT * FROM endpoints WHERE id=?',(endpoint_id,)).fetchone()
    if not endpoint or not endpoint['enabled']:
        raise ValueError('endpoint_disabled')
    require_read_permission(conn,endpoint['source_id'])
    endpoint = scoped_endpoint(endpoint,window_dates,delta_since)
    name = endpoint['connector']
    secret = ''
    headers = {}
    if name.startswith('datatourisme_'):
        secret = os.environ.get('DATATOURISME_API_KEY','')
        if not secret:
            raise ValueError('DATATOURISME_API_KEY_missing')
        headers['X-API-Key'] = secret
    if name.startswith('openagenda_'):
        secret = os.environ.get('OPENAGENDA_PUBLIC_KEY','')
        if not secret.startswith('oa_pk_'):
            raise ValueError('OPENAGENDA_PUBLIC_KEY_must_be_a_public_oa_pk_key')
        headers['key'] = secret
    url = initial_url(endpoint)
    if resume:
        old = conn.execute('SELECT * FROM crawl_runs WHERE id=?',(resume,)).fetchone()
        if not old or old['endpoint_id']!=endpoint_id or old['status'] not in ('partial','failed','interrupted') or not old['cursor_json']:
            raise ValueError('run_not_resumable')
        cursor = json.loads(old['cursor_json'])
        if cursor.get('initial_url')!=initial_url(endpoint):
            raise ValueError('endpoint_config_changed_since_run')
        url = cursor['next_url']
    paths = {urlsplit(endpoint['url']).path}
    if name.startswith('datatourisme_'):
        paths.add('/v1/catalog')
    if name in HTML_CONNECTORS:
        paths.add('/robots.txt')
    client = client_factory(endpoint['url'],paths,headers=headers,max_requests=max_pages+1)
    run = start_run(conn,endpoint['source_id'],endpoint_id)
    seen = set()
    rejected = 0
    try:
        if on_run:
            on_run(run)
        if name in HTML_CONNECTORS:
            robots = client.check_robots(url)
            with conn:
                snapshot(conn,run,endpoint['source_id'],robots.url,robots.body,robots.content_type)
        for _ in range(max_pages):
            require_read_permission(conn,endpoint['source_id'])
            if url in seen:
                raise ValueError('pagination_cycle')
            seen.add(url)
            response = client.get(url)
            body = response.body if name in HTML_CONNECTORS else sanitize_payload(response.body,secret)
            result = ingest_page(conn,run,endpoint['source_id'],url,body,name,sanitized=body!=response.body)
            rejected += result['quarantined']
            following = next_url(endpoint,url,json.loads(body)) if name not in HTML_CONNECTORS else None
            if not following:
                finish_run(conn,run,'partial' if rejected else 'complete','quarantined_records' if rejected else None)
                return dict(conn.execute('SELECT * FROM crawl_runs WHERE id=?',(run,)).fetchone())
            url = following
            with conn:
                conn.execute('UPDATE crawl_runs SET cursor_json=? WHERE id=?',
                             (dumps({'next_url':url,'initial_url':initial_url(endpoint)}),run))
        finish_run(conn,run,'partial','page_budget_reached',{'next_url':url,'initial_url':initial_url(endpoint)})
    except (KeyboardInterrupt,SystemExit):
        finish_run(conn,run,'interrupted','execution_interrupted',{'next_url':url,'initial_url':initial_url(endpoint)})
        raise
    except Exception as exc:
        code = str(exc) if isinstance(exc,FetchError) else 'connector_validation_or_ingestion_failed'
        finish_run(conn,run,'failed',code,{'next_url':url,'initial_url':initial_url(endpoint)})
    return dict(conn.execute('SELECT * FROM crawl_runs WHERE id=?',(run,)).fetchone())
