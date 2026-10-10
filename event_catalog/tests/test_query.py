from urllib.parse import parse_qs,urlsplit

from sncf_events.connectors import configure_endpoint,initial_url
from sncf_events.db import dumps
from sncf_events.export import records
from sncf_events.ingest import finish_run,ingest_page,start_run
from tests.helpers import DatabaseCase,event


class QueryTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        run=start_run(self.conn,'S002')
        rows=[event(1,title={'fr':'TEST Musée éducation'},timings=[{'begin':'2026-10-10','end':'2026-10-12'}]),
              event(2,title={'fr':'TEST nuit'},timings=[{'begin':'2026-10-25T23:30:00Z','end':'2026-10-26T00:30:00Z'}]),
              event(3,title={'fr':'TEST unknown'},timings=[])]
        ingest_page(self.conn,run,'S002','https://api.openagenda.com/v2/agendas/1/events',dumps({'events':rows}),'openagenda_events')
        finish_run(self.conn,run,'complete')

    def test_date_range_overlap_and_unknown_dates(self):
        rows=list(records(self.conn,from_date='2026-10-11',to_date='2026-10-11'))
        self.assertEqual([r['external_id'] for r in rows],['1'])
        self.assertEqual(list(records(self.conn,from_date='2026-10-13',to_date='2026-10-24')),[])

    def test_datetime_filter_uses_paris_calendar_after_dst_change(self):
        self.assertEqual(list(records(self.conn,from_date='2026-10-25',to_date='2026-10-25')),[])
        rows=list(records(self.conn,from_date='2026-10-26',to_date='2026-10-26'))
        self.assertEqual([r['external_id'] for r in rows],['2'])

    def test_french_search_ignores_accents_and_case(self):
        self.assertEqual([r['external_id'] for r in records(self.conn,text='MUSEE EDUCATION')],['1'])
        self.assertEqual(len(list(records(self.conn,text='TOULOUSE',limit=2))),2)
        self.assertEqual(list(records(self.conn,text="' OR 1=1 --")),[])

    def test_invalid_date_and_inverted_filter_fail(self):
        for args in ({'from_date':'2026-02-30'},{'from_date':'2026-10-12','to_date':'2026-10-11'},{'text':'x'*201}):
            with self.assertRaises(ValueError): list(records(self.conn,**args))

    def test_upcoming_api_filter_is_distinct_from_update_filter(self):
        configure_endpoint(self.conn,'upcoming','S002','openagenda_events',{'agenda_uid':123,'starts_after':'2026-10-10T00:00:00+02:00'})
        e=self.conn.execute("SELECT * FROM endpoints WHERE id='upcoming'").fetchone()
        query=parse_qs(urlsplit(initial_url(e)).query)
        self.assertEqual(query['timings[gte]'],['2026-10-09T22:00:00+00:00'])
        self.assertNotIn('updatedAt[gte]',query)
        with self.assertRaises(ValueError):
            configure_endpoint(self.conn,'bad','S002','openagenda_events',{'agenda_uid':123,'starts_after':'2026-10-10'})
