export const HOS_CSS = `
  .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; } .grow { flex: 1; }
  .search { min-width: 240px; max-width: 360px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .kpi { padding: 14px 16px; } .kpi span { display: block; font-size: 12px; color: var(--text-dim); } .kpi strong { display: block; font-size: 24px; margin-top: 4px; font-variant-numeric: tabular-nums; } .kpi small { color: var(--text-dim); font-size: 11.5px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } @media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
  .three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; } @media (max-width: 1000px) { .three { grid-template-columns: 1fr; } }
  .dim { color: var(--text-dim); } .sm { font-size: 12px; } .mt { margin-top: 14px; } .num { text-align: end; font-variant-numeric: tabular-nums; }
  .chip.ok { background: var(--ok-soft); color: var(--ok); } .chip.bad { background: var(--bad-soft); color: var(--bad); } .chip.info { background: var(--primary-soft, var(--surface-3)); color: var(--primary); }
  .warnbox { background: var(--warn-soft); color: var(--warn); border-radius: 8px; padding: 10px 12px; margin: 10px 0; font-size: 13px; } .warnbox li { margin: 3px 0; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .link { cursor: pointer; color: var(--primary); }
  .bedgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .bed { border: 1px solid var(--border); border-radius: 10px; padding: 10px; background: var(--surface); } .bed b { display: block; }
  .bed.Occupied { border-color: var(--bad); background: var(--bad-soft); } .bed.Available { border-color: var(--ok); } .bed.Maintenance { opacity: .6; }
  .bars { display: flex; align-items: flex-end; gap: 10px; height: 120px; } .bars div { flex: 1; text-align: center; font-size: 11px; color: var(--text-dim); }
  .bars i { display: block; background: var(--primary); border-radius: 4px 4px 0 0; min-height: 2px; margin-bottom: 4px; }
  textarea { width: 100%; min-height: 70px; }
`;
export const flagClass = (f?: string) => !f ? '' : f.startsWith('Critical') ? 'bad' : f === 'Normal' ? 'ok' : 'warn';
