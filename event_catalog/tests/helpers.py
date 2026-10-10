"""Synthetic fixtures only; all data is intentionally unrelated to real events."""
import tempfile
import unittest
from pathlib import Path

from sncf_events.db import ROOT, connect, import_registry, migrate
from sncf_events.policy import review_source, set_source_enabled


def event(uid=1001, **changes):
    result = {
        'uid':uid,'state':2,'status':1,'title':{'fr':'TEST ONLY — atelier scientifique'},
        'description':{'fr':'Synthetic fixture, do not publish.'},
        'updatedAt':'2026-10-01T10:00:00Z','timezone':'Europe/Paris',
        'location':{'insee':'31555','department':'Haute-Garonne','city':'Toulouse',
                    'name':'TEST ONLY','latitude':43.6,'longitude':1.44},
        'timings':[{'begin':'2026-10-12T10:00:00+02:00','end':'2026-10-12T11:00:00+02:00'}],
    }
    result.update(changes)
    return result


def allow_source(conn,sid,*,reuse=True,description=False):
    review_source(conn,sid,{'read_allowed':True,'facts_reuse_allowed':reuse,
        'description_reuse_allowed':description,'license_name':'TEST ONLY',
        'evidence_url':'https://example.org/terms','attribution':'TEST ONLY attribution',
        'reviewer':'test','expires_at':'2099-01-01T00:00:00Z','notes':'synthetic permission for unit tests'})
    set_source_enabled(conn,sid,True)


class DatabaseCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'test.sqlite3'
        self.conn = connect(self.path)
        self.addCleanup(self.conn.close)
        migrate(self.conn)
        self.seed = ROOT/'data/seeds/sources-2026-10-10.json'
        import_registry(self.conn,self.seed)

    def scalar(self,sql,args=()):
        return self.conn.execute(sql,args).fetchone()[0]
