"""Create a portable, credential-free SQLite catalogue and matching UTF-8 CSVs.

The operational evidence database remains untouched. This is a deliberately
separate exchange schema: raw pages, API responses and private operational state
are not included. Source reuse flags are preserved, not promoted to permission.
"""
import argparse
import contextlib
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile

from .db import connect, dumps, now
from .export import records
from .language import NON_LATIN, french_title
from .policy import latest_review, timestamp
from .rail import RailIndex
from .search import plain

SCHEMA = {
    'sources': {
        'id':'TEXT PRIMARY KEY','name':'TEXT','category':'TEXT','scope':'TEXT',
        'role':'TEXT','entry_url':'TEXT','proposed_connector':'TEXT','priority':'TEXT',
        'verification_status':'TEXT','notes':'TEXT','evidence_url':'TEXT','checked_on':'TEXT',
        'authorization_review':'TEXT','enabled':'INTEGER','last_success_at':'TEXT',
        'facts_reuse_allowed':'INTEGER','description_reuse_allowed':'INTEGER',
        'review_expires_at':'TEXT','license':'TEXT','attribution':'TEXT'},
    'activities': {
        'id':'TEXT PRIMARY KEY','kind':'TEXT','provider':'TEXT','external_id':'TEXT',
        'source_id':'TEXT REFERENCES sources(id)','title':'TEXT','title_note':'TEXT',
        'description':'TEXT','canonical_url':'TEXT','official_url':'TEXT','booking_url':'TEXT',
        'venue_url':'TEXT','department_code':'TEXT',
        'commune_code':'TEXT','city':'TEXT','address':'TEXT','location_name':'TEXT',
        'latitude':'REAL','longitude':'REAL','status':'TEXT','edition_year':'INTEGER',
        'theme':'TEXT','source_active':'INTEGER','observed_at':'TEXT','source_updated_at':'TEXT',
        'evidence_url':'TEXT','evidence_sha256':'TEXT','attribution':'TEXT','license':'TEXT',
        'planning_status':'TEXT'},
    'occurrences': {
        'id':'INTEGER PRIMARY KEY','activity_id':'TEXT REFERENCES activities(id)',
        'start_at':'TEXT','end_at':'TEXT','start_date':'TEXT','end_date':'TEXT',
        'timezone':'TEXT','precision':'TEXT','status':'TEXT','recurrence_rule':'TEXT',
        'exceptions_json':'TEXT'},
    'school_conditions': {
        'activity_id':'TEXT PRIMARY KEY REFERENCES activities(id)',
        'grade_levels_json':'TEXT','min_age':'INTEGER','max_age':'INTEGER',
        'min_group':'INTEGER','max_group':'INTEGER','duration_minutes':'INTEGER',
        'languages_json':'TEXT','school_groups':'TEXT','booking_required':'TEXT',
        'booking_url':'TEXT','price_amount':'REAL','price_currency':'TEXT','price_unit':'TEXT'},
    'stations': {
        'id':'TEXT PRIMARY KEY','dataset_id':'TEXT','name':'TEXT','latitude':'REAL',
        'longitude':'REAL','department_code':'TEXT','commune':'TEXT','modes_json':'TEXT'},
    'walking_assessments': {
        'activity_id':'TEXT PRIMARY KEY REFERENCES activities(id)','status':'TEXT',
        'reason':'TEXT','station_id':'TEXT REFERENCES stations(id)','station_name':'TEXT',
        'walking_seconds':'INTEGER','walking_metres':'REAL','checked_at':'TEXT',
        'valid_until':'TEXT','provider':'TEXT','evidence_url':'TEXT'},
}


def csv_value(value):
    if value is None:
        return ''
    # Do not interpret source-supplied strings as spreadsheet formulas. Numeric
    # values remain numeric (including negative longitude). IDs remain text.
    if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@','\t','\r')):
        return "'"+value
    return value


def write_package(conn, destination):
    destination = Path(destination).resolve()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('share destination already exists')
    destination.parent.mkdir(parents=True,exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.catalogue-',dir=destination.parent))
    try:
        result = _build(conn,staging)
        os.rename(staging,destination)
        return result
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def _build(conn, directory):
    generated_at = now()
    database = directory/'catalogue.sqlite3'
    out = sqlite3.connect(database)
    out.row_factory = sqlite3.Row
    out.execute('PRAGMA foreign_keys=ON')
    counts = {name:0 for name in SCHEMA}
    def insert(table, row):
        columns = SCHEMA[table]
        values = []
        for name,kind in columns.items():
            value = row.get(name)
            if isinstance(value,(dict,list)):
                value = dumps(value)
            if isinstance(value,str) and NON_LATIN.search(value):
                raise ValueError('non_english_french_text:'+table+'.'+name)
            if kind.startswith('INTEGER') and isinstance(value,bool):
                value=int(value)
            values.append(value)
        out.execute('INSERT INTO '+table+' VALUES ('+','.join('?' for _ in values)+')',values)
        counts[table]+=1
    try:
        for table, columns in SCHEMA.items():
            out.execute('CREATE TABLE '+table+' ('+','.join(k+' '+v for k,v in columns.items())+')')
        reviews={}
        for source in conn.execute('SELECT * FROM sources ORDER BY id'):
            row=dict(source);review=latest_review(conn,row['id'])
            valid=bool(review and timestamp(review['expires_at'])>generated_at)
            reviews[row['id']]=review if valid else None
            row.update(facts_reuse_allowed=int(bool(valid and review['facts_reuse_allowed'])),
                       description_reuse_allowed=int(bool(valid and review['description_reuse_allowed'])),
                       review_expires_at=review['expires_at'] if review else None,
                       license=review['license_name'] if review else 'unreviewed',
                       attribution=review['attribution'] if review else None)
            insert('sources',row)
        for station in conn.execute('SELECT s.* FROM rail_stations s JOIN rail_datasets d ON d.id=s.dataset_id WHERE d.active=1 ORDER BY s.id'):
            insert('stations',dict(station))
        rail=RailIndex(conn)
        for record in records(conn,limit=10000):
            row=dict(record)
            row['title']=french_title(row['title'])
            row['title_note']='French subtitle retained from multilingual source title' if NON_LATIN.search(record['title']) else None
            review=reviews[row['source_id']]
            row['description']=plain(row.get('description')) if review and review['description_reuse_allowed'] else None
            row['evidence_url']=row['evidence']['url']
            row['evidence_sha256']=row['evidence']['sha256']
            insert('activities',row)
            for occurrence in record['occurrences']:
                insert('occurrences',dict(occurrence,activity_id=record['id']))
            school=record.get('school_conditions')
            if school:
                school=dict(school,activity_id=record['id'])
                for key in ('grade_levels','languages'):
                    school[key+'_json']=school.get(key,[])
                insert('school_conditions',school)
            insert('walking_assessments',dict(rail.assess(record),activity_id=record['id']))
        expected=conn.execute('SELECT count(*) FROM current_records').fetchone()[0]
        if expected!=counts['activities']:
            raise ValueError('share_would_truncate_records')
        out.execute('CREATE INDEX occurrences_activity ON occurrences(activity_id)')
        out.execute('CREATE INDEX activities_location ON activities(department_code,city)')
        for name,kind in [('events','event'),('educational_offers','educational_offer'),('venues','venue')]:
            out.execute(f"CREATE VIEW {name} AS SELECT * FROM activities WHERE kind='{kind}'")
        metadata={'schema_version':1,'generated_at':generated_at,'languages':['en','fr'],
                  'record_counts':counts,'kind_counts':dict(out.execute('SELECT kind,count(*) FROM activities GROUP BY kind')),
                  'walking_limit_seconds':1200,'timezone':'Europe/Paris',
                  'database_role':'Portable exchange snapshot; not an operational crawler database',
                  'reuse_notice':'Source-specific rights apply. A false reuse flag remains pending review; publication does not grant reuse permission. Descriptions are omitted unless their reuse review allows them.',
                  'excluded':['credentials','raw source responses','contact lists','quarantine payloads','private operational history'],
                  'station_datasets':[json.loads(r[0]) for r in conn.execute('SELECT manifest_json FROM rail_datasets WHERE active=1')]}
        out.execute('CREATE TABLE metadata (key TEXT PRIMARY KEY,value_json TEXT NOT NULL)')
        out.executemany('INSERT INTO metadata VALUES (?,?)',[(k,dumps(v)) for k,v in metadata.items()])
        out.commit()
        if out.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or out.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('share_database_integrity')
        csvdir=directory/'csv';csvdir.mkdir()
        for table,columns in SCHEMA.items():
            with (csvdir/(table+'.csv')).open('w',encoding='utf-8-sig',newline='') as stream:
                writer=csv.writer(stream,lineterminator='\r\n');writer.writerow(columns)
                for row in out.execute('SELECT * FROM '+table+' ORDER BY 1'):
                    writer.writerow([csv_value(v) for v in row])
        (directory/'schema.json').write_text(json.dumps(SCHEMA,indent=2)+'\n',encoding='utf-8')
        files={str(p.relative_to(directory)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
               for p in sorted(directory.rglob('*')) if p.is_file()}
        metadata['files']=files
        (directory/'manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return metadata
    finally:
        out.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    with contextlib.closing(connect(args.db,readonly=True)) as conn:
        # One SQLite read transaction gives every exported table the same view.
        conn.execute('BEGIN')
        result=write_package(conn,args.output)
    print(json.dumps({'output':args.output,'counts':result['record_counts'],'kinds':result['kind_counts']}))


if __name__=='__main__':
    main()
