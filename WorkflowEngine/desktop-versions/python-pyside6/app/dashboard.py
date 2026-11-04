"""Dashboard (KPIs, six-stage flow, trend, queue, recent documents) and Reports & Analytics, computed client-side from the workflow instances
exactly like the portal does (see bi.py)."""
import csv

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFileDialog, QFrame, QGridLayout, QHBoxLayout, QLabel, QScrollArea, QVBoxLayout, QWidget

from . import bi, i18n
from .api import api
from .charts import FlowStrip, HBars, KpiCard, TrendChart, money
from .i18n import t
from .pages import Page, _safe, visible_modules
from .report import ReportDialog
from .ui import button, fill_table, label, make_table, run_async

STATUS_KEY = dict(pending='filter.pending', approved='filter.approved', rejected='filter.rejected', canceled='filter.rejected')


def cur_of(docs):
    return next((d['currency'] for d in docs if d['currency']), '')


def doc_rows(docs):
    return [[d['number'], t('doc.' + d['type']) if d['type'] else d['title'], d['party'], d['date'].strftime('%Y-%m-%d'), money(d['total']) if d['total'] is not None else '',
             t('stage.' + d['stage']), t(STATUS_KEY[d['status']]) if d['status'] in STATUS_KEY else d['status'], d['step']] for d in docs]


DOC_HEADERS = ['col.number', 'col.type', 'col.party', 'col.date', 'col.amount', 'col.stage', 'col.status', 'col.step']


def card(title, widget, extra=None):
    f = QFrame(); f.setProperty('card', True)
    l = QVBoxLayout(f)
    h = QHBoxLayout(); h.addWidget(label(title, 'title'), 1)
    if extra is not None:
        h.addWidget(extra)
    l.addLayout(h); l.addWidget(widget)
    return f


class ScrollPage(Page):
    def __init__(self):
        super().__init__()
        self.inner = QWidget()
        self.il = QVBoxLayout(self.inner)
        self.il.setContentsMargins(0, 0, 0, 0)
        sc = QScrollArea(); sc.setWidgetResizable(True); sc.setFrameShape(QFrame.NoFrame); sc.setWidget(self.inner)
        self.lay.addWidget(sc)


class DashboardPage(ScrollPage):
    def __init__(self, go_page, open_kind):
        super().__init__()
        self.go_page, self.open_kind = go_page, open_kind
        self.docs, self.tasks, self.stage = [], [], ''
        self.hello = label('', 'title')
        top = QHBoxLayout(); top.addWidget(self.hello, 1); top.addWidget(button(t('common.refresh'), self.reload, 'ghost'))
        self.il.addLayout(top)
        grid = QGridLayout()
        specs = [('kpi.sales', '#0ea5e9', 4), ('kpi.purchases', '#8b5cf6', 4), ('kpi.receivables', '#10b981', 4), ('kpi.payables', '#f59e0b', 4), ('kpi.myApprovals', '#ef4444', 1), ('kpi.cycle', '#64748b', 3)]
        self.k = {}
        for i, (key, col, pg) in enumerate(specs):
            c = KpiCard(t(key), '–', '', col)
            c.clicked.connect(lambda pg=pg: self.go_page(pg))
            self.k[key] = c
            grid.addWidget(c, i // 3, i % 3)
        self.il.addLayout(grid)
        self.flow = FlowStrip(); self.flow.picked.connect(self.pick_stage)
        self.stage_tbl = make_table([t(h) for h in DOC_HEADERS]); self.stage_tbl.setMaximumHeight(200); self.stage_tbl.hide()
        fw = QWidget(); fl = QVBoxLayout(fw); fl.setContentsMargins(0, 0, 0, 0); fl.addWidget(label(t('dash.flowSub'), 'dim')); fl.addWidget(self.flow); fl.addWidget(self.stage_tbl)
        self.il.addWidget(card(t('dash.flow'), fw))
        self.trend = TrendChart(t('module.sales'), t('chart.purchases'))
        self.mods = HBars()
        row = QHBoxLayout(); row.addWidget(card(t('dash.trend'), self.trend), 3); row.addWidget(card(t('dash.byModule'), self.mods), 2)
        self.il.addLayout(row)
        self.queue = make_table([t('col.step'), t('col.number'), t('col.party'), t('col.priority')]); self.queue.setMaximumHeight(210)
        self.recent = make_table([t(h) for h in DOC_HEADERS]); self.recent.setMinimumHeight(250)
        self.il.addWidget(card(t('dash.myQueue'), self.queue, button(t('dash.viewAll'), lambda: self.go_page(1), 'ghost')))
        self.il.addWidget(card(t('dash.recent'), self.recent, button(t('dash.viewAll'), lambda: self.go_page(2), 'ghost')))
        self.il.addWidget(label(t('home.modules'), 'title'))
        mg = QGridLayout()
        for i, m in enumerate(visible_modules()):
            mg.addWidget(button(i18n.name(m), lambda m=m: self.open_kind(m['id'], None), 'ghost'), i // 4, i % 4)
        self.il.addLayout(mg)
        self.il.addStretch()

    def reload(self):
        self.hello.setText(t('dash.hello') + ', ' + (api.session.display_name or ''))
        run_async(lambda: (_safe(api.instances), _safe(api.tasks)), self.fill)

    def fill(self, r):
        inst, self.tasks = r
        self.docs = bi.docs_of(inst)
        K = bi.kpis(self.docs, len(self.tasks)); c = cur_of(self.docs)
        m = lambda v: money(v, c)
        self.k['kpi.sales'].set(m(K['salesMonth']), t('kpi.pipeline') + ': ' + m(K['pipeline']))
        self.k['kpi.purchases'].set(m(K['purchasesMonth']), t('kpi.committed') + ': ' + m(K['committed']))
        self.k['kpi.receivables'].set(m(K['receivables']))
        self.k['kpi.payables'].set(m(K['payables']), t('kpi.expenses') + ': ' + m(K['expensesMonth']))
        self.k['kpi.myApprovals'].set(str(K['myApprovals']))
        self.k['kpi.cycle'].set('%.1f %s' % (K['avgCycleDays'], t('kpi.days')), '%s: %d · %s: %d%%' % (t('kpi.openDocs'), K['openDocs'], t('kpi.rejectRate'), round(K['rejectRate'] * 100)))
        sc = bi.stage_counts(self.docs)
        self.flow.set([(s, t('stage.' + s), sc[s]['count'], money(sc[s]['value'])) for s in bi.STAGES])
        self.trend.set(bi.monthly_trend(self.docs))
        pend = [d for d in self.docs if d['status'] == 'pending']
        rows = [(t('module.' + mk), sum(1 for d in pend if d['module'] == mk), bi.COLORS.get(mk, '#64748b'), '') for mk in bi.COLORS]
        self.mods.set([(a, b, c2, str(b)) for a, b, c2, _ in rows if b])
        byid = {d['id']: d for d in self.docs}
        qrows = []
        for tk in self.tasks[:6]:
            d = byid.get(tk.get('instanceId')) or {}
            qrows.append([tk.get('nodeName', ''), d.get('number', ''), d.get('party', ''), tk.get('priority') or 'Normal'])
        fill_table(self.queue, qrows, self.tasks[:6])
        self.queue.doubleClicked.connect(lambda *_: self.go_page(1)) if not getattr(self, '_q', False) else None
        self._q = True
        fill_table(self.recent, doc_rows(self.docs[:8]), self.docs[:8])
        self.pick_stage(self.stage)

    def pick_stage(self, s):
        self.stage = s
        if not s:
            self.stage_tbl.hide(); return
        sel = [d for d in self.docs if d['status'] == 'pending' and d['stage'] == s] if s != 'reporting' else [d for d in self.docs if d['status'] == 'approved']
        fill_table(self.stage_tbl, doc_rows(sel[:50]), sel[:50]); self.stage_tbl.show()


class ReportsPage(ScrollPage):
    def __init__(self):
        super().__init__()
        self.docs = []
        top = QHBoxLayout(); top.addWidget(label(t('rep.title'), 'title'), 1)
        top.addWidget(button(t('common.refresh'), self.reload, 'ghost'))
        top.addWidget(button('🖨 ' + t('collab.rep.print'), self.designer, 'ghost'))
        top.addWidget(button(t('rep.export'), self.export))
        self.il.addLayout(top)
        self.il.addWidget(label(t('rep.sub'), 'dim'))
        hd = lambda mod: [t(x) for x in (mod, 'col.count', 'filter.pending', 'filter.approved', 'filter.rejected', 'col.avgDays', 'col.value')]
        self.t_mod, self.t_br = make_table(hd('col.module')), make_table(hd('col.branch'))
        for tb in (self.t_mod, self.t_br):
            tb.setMaximumHeight(210)
        self.il.addWidget(card(t('rep.byModule'), self.t_mod)); self.il.addWidget(card(t('rep.byBranch'), self.t_br))
        self.bott, self.turn = HBars(), HBars()
        row = QHBoxLayout(); row.addWidget(card(t('rep.bottleneck'), self.bott)); row.addWidget(card(t('rep.turnaround'), self.turn)); self.il.addLayout(row)
        self.cust, self.vend = HBars(), HBars()
        row = QHBoxLayout(); row.addWidget(card(t('rep.topParties') + ' · ' + t('party.customer'), self.cust)); row.addWidget(card(t('rep.topParties') + ' · ' + t('party.vendor'), self.vend)); self.il.addLayout(row)
        self.il.addStretch()

    def reload(self):
        run_async(lambda: _safe(api.instances), self.fill)

    def group_rows(self, key):
        out = []
        for g in bi.group_by(self.docs, key):
            k = t('module.' + g['key']) if key == 'module' else g['key']
            out.append([k, str(g['count']), str(g['pending']), str(g['approved']), str(g['rejected']), '%.1f' % g['avgDays'], money(g['value'])])
        return out

    def fill(self, inst):
        self.docs = bi.docs_of(inst)
        self.mod_rows, self.br_rows = self.group_rows('module'), self.group_rows('branch')
        fill_table(self.t_mod, self.mod_rows, []); fill_table(self.t_br, self.br_rows, [])
        self.bott.set([(s['step'], s['count'], '#f59e0b', str(s['count'])) for s in bi.bottleneck(self.docs)[:8]])
        self.turn.set([(s['step'], s['avgHours'], '#dc2626' if s['avgHours'] > 24 else '#10b981', '%.1f %s' % (s['avgHours'], t('rep.hours'))) for s in bi.step_turnaround(self.docs)[:8]])
        self.cust.set([(p['party'], p['value'], '#0ea5e9', money(p['value'])) for p in bi.top_parties(self.docs, ['SO'])])
        self.vend.set([(p['party'], p['value'], '#8b5cf6', money(p['value'])) for p in bi.top_parties(self.docs, ['PR', 'PV'])])

    def export(self):
        path, _ = QFileDialog.getSaveFileName(self, t('rep.export'), 'report.csv', 'CSV (*.csv)')
        if not path:
            return
        with open(path, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow([t('rep.byModule')]); w.writerow([t('col.module'), t('col.count'), t('filter.pending'), t('filter.approved'), t('filter.rejected'), t('col.avgDays'), t('col.value')]); w.writerows(self.mod_rows)
            w.writerow([]); w.writerow([t('rep.byBranch')]); w.writerows(self.br_rows)
            w.writerow([]); w.writerow([t('rep.turnaround')])
            for s in bi.step_turnaround(self.docs):
                w.writerow([s['step'], '%.1f' % s['avgHours'], s['count']])

    def designer(self):
        cols = [dict(key=k.split('.')[1], label=t(k), numeric=k == 'col.amount') for k in DOC_HEADERS]
        rows = []
        for d, r in zip(self.docs, doc_rows(self.docs)):
            row = {c['key']: r[i] for i, c in enumerate(cols)}; row['amount#'] = d['total'] or 0; rows.append(row)
        ReportDialog(self, 'reports:documents', t('rep.title'), cols, rows, api.session.display_name).exec()
