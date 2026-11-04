import json,re
rows=[l.rstrip('\n').split(' || ') for l in open('/home/claude/we/hr-i18n/table.txt',encoding='utf8') if l.strip()]
for r in rows: assert len(r)==8,(len(r),r[0])
q=lambda s:json.dumps(s,ensure_ascii=False)
keys=[r[0] for r in rows]
d=open('dictionary.ts',encoding='utf8').read()
d=re.sub(r'\n\};\s*$','',d)
d+="\n  // ---- HR module ----\n"+"".join(f'  {q(r[0])}: {{ en: {q(r[1])}, ar: {q(r[2])} }},\n' for r in rows)+"};\n"
open('dictionary.ts','w',encoding='utf8').write(d)
for i,l in enumerate(['fr','es','ur','de','it']):
    f=f'lang-{l}.ts'; s=open(f,encoding='utf8').read()
    s=re.sub(r'\n\};\s*$','',s)
    s+="\n  // ---- HR module ----\n"+"".join(f'  {q(r[0])}: {q(r[3+i])},\n' for r in rows)+"};\n"
    open(f,'w',encoding='utf8').write(s)
print(len(rows))
