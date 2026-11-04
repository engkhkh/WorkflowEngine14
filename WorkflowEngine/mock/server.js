// Mock API + static host for UI tests: node server.js <distDir> <port>
const http=require('http'),fs=require('fs'),path=require('path');
const dist=process.argv[2],port=+process.argv[3]||4200;
let seq=1; const db={ tenant:{id:'t1',name:'',plan:'starter',maxUsers:25,maxCompanies:1,maxBranches:10,users:1,companies:1,branches:1,setupDone:true},companies:[],branches:[],users:[] };
const ALL=['web.view','web.edit','web.publish','web.orders.manage','pos.view','dashboard.view','org.manage','admin.users','tasks.act','reports.view','assistant.use'];
const mk=u=>({id:u.id,token:'tok-'+u.id,username:u.username,displayName:u.displayName,role:u.role,permissions:u.role==='admin'?ALL:['dashboard.view'],tenantId:'t1',tenantName:db.tenant.name,branches:u.branches||null});
const tokens={}; db.sites=[]; db.subs=[];
const slug=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'site'; // invite token -> user
const send=(res,c,b)=>{res.writeHead(c,{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'});res.end(b===undefined?'':JSON.stringify(b));};
const dto=u=>({...u,permissions:null,effectivePermissions:u.role==='admin'?ALL:['dashboard.view'],invitePending:!u.password,inviteToken:u._tok||null,isActive:true,email:u.email||''});
const api=http.createServer((req,res)=>{ if(req.method==='OPTIONS')return send(res,204);
 let sm=req.url.match(/^\/s\/([^/?]+)/); if(sm){ const s=db.sites.find(x=>x.slug===sm[1]&&x.published); if(!s){res.writeHead(404);return res.end();} res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"sandbox allow-scripts allow-forms allow-popups; default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src *"}); return res.end(s.html); }
 let body='';req.on('data',d=>body+=d);req.on('end',()=>{ const b=body?JSON.parse(body):{}; const url=new URL(req.url,'http://x'); const p=url.pathname.replace(/^\/api/,''); const m=req.method;
  if(p==='/tenants/signup'){ db.tenant.name=b.workspaceName; db.tenant.setupDone=false; db.companies=[{code:'C1',name:b.workspaceName,nameAr:'',currency:b.currency,taxNo:b.taxNo,country:b.country}]; db.branches=[{code:'HQ',company:'C1',name:b.branchName||'Head Office',nameAr:'',warehouse:''}];
    const u={id:'u1',username:b.username,displayName:b.displayName,role:'admin',password:b.password,email:b.email}; db.users=[u]; return send(res,200,mk(u)); }
  if(p==='/auth/login'){ const u=db.users.find(x=>x.username===b.username&&x.password===b.password); return u?send(res,200,mk(u)):send(res,401,'bad'); }
  if(p==='/auth/invite'){ const u=tokens[url.searchParams.get('token')]; return u?send(res,200,{username:u.username,displayName:u.displayName,workspace:db.tenant.name}):send(res,400,'invalid'); }
  if(p==='/auth/accept-invite'){ const u=tokens[b.token]; if(!u)return send(res,400,'invalid'); u.password=b.password; u._tok=null; delete tokens[b.token]; return send(res,200,mk(u)); }
  if(p==='/org'&&m==='GET'){ db.tenant.companies=db.companies.length;db.tenant.branches=db.branches.length;db.tenant.users=db.users.length; return send(res,200,{tenant:db.tenant,companies:db.companies,branches:db.branches}); }
  if(p==='/org/setup/complete'){ db.tenant.setupDone=true; return send(res,204); }
  let r; if((r=p.match(/^\/org\/companies\/(.+)$/))&&m==='PUT'){ db.companies=db.companies.map(c=>c.code===r[1]?{...c,...b}:c); return send(res,200,b); }
  if(p==='/org/branches'&&m==='POST'){ db.branches.push(b); return send(res,200,b); }
  if((r=p.match(/^\/org\/branches\/(.+)$/))&&m==='DELETE'){ db.branches=db.branches.filter(x=>x.code!==r[1]); return send(res,204); }
  if(p==='/users/permissions')return send(res,200,{groups:[{group:'dashboard',keys:['dashboard.view']}],roleDefaults:{admin:ALL,employee:['dashboard.view']},roles:['admin','employee']});
  if(p==='/users/admin'&&m==='GET')return send(res,200,db.users.map(dto));
  if(p==='/users/admin'&&m==='POST'){ const u={id:'u'+(++seq),username:b.username,displayName:b.displayName,role:b.role,email:b.email,branches:b.branches||null,password:b.invite?'':b.password}; if(b.invite){u._tok='inv'+seq;tokens[u._tok]=u;} db.users.push(u); return send(res,200,dto(u)); }
  if(p==='/billing/summary'){ const n=db.users.length,u=n>100?3:5; return send(res,200,{users:n,unitPrice:u,estimate:n*u,currency:'USD',lines:[{branch:'*',branchName:'All branches',users:n,amount:n*u}],pricePerUser:5,volumePrice:3,volumeFrom:100,sarPerUsd:3.75,balance:db.inv?db.inv.status==='open'?db.inv.total:0:0,openInvoices:db.inv&&db.inv.status==='open'?1:0,provider:'sandbox',nextInvoice:'2026-11-01T00:00:00Z'}); }
  if(p==='/billing/invoices'&&m==='GET'){ const n=db.users.length,u=n>100?3:5; if(!db.inv) db.inv={id:'i1',number:'INV-202610-0001',period:'2026-10',issuedAt:new Date().toISOString(),dueAt:new Date(Date.now()+6048e5).toISOString(),status:'open',overdue:false,currency:'USD',users:n,unitPrice:u,total:n*u,sarPerUsd:3.75,totalSar:n*u*3.75,companyName:db.tenant.name,lines:[{branch:'*',branchName:'All branches',users:n,amount:n*u}]}; return send(res,200,[db.inv]); }
  if(p==='/billing/invoices/i1/pay')return send(res,200,{url:'',provider:'sandbox'});
  if(p==='/billing/invoices/i1/sandbox-pay'){ db.inv.status='paid'; db.inv.method='test'; return send(res,200,db.inv); }
  if(p==='/billing/invoices/i1/confirm')return send(res,200,db.inv);
  let w;
  if(p==='/website/sites'&&m==='GET')return send(res,200,db.sites.map(({design,html,products,...r})=>r));
  if(p==='/website/sites'&&m==='POST'){ const r={id:'s'+(++seq),name:b.name,slug:slug(b.name),published:false,updatedAt:new Date().toISOString(),currency:b.currency||'SAR',design:b.design}; db.sites.push(r); return send(res,200,{id:r.id,name:r.name,slug:r.slug,published:false,updatedAt:r.updatedAt,currency:r.currency}); }
  if((w=p.match(/^\/website\/sites\/([^/]+)$/))){ const s=db.sites.find(x=>x.id===w[1]); if(!s)return send(res,404,'x'); if(m==='GET')return send(res,200,s); if(m==='PUT'){ s.design=b.design; s.name=b.name; s.updatedAt=new Date().toISOString(); return send(res,200,{id:s.id,name:s.name,slug:s.slug,published:s.published,updatedAt:s.updatedAt,currency:s.currency}); } }
  if((w=p.match(/^\/website\/sites\/([^/]+)\/publish$/))){ const s=db.sites.find(x=>x.id===w[1]); s.html=b.html; s.products=b.products; s.published=true; s.publishedAt=new Date().toISOString(); return send(res,200,{id:s.id,name:s.name,slug:s.slug,published:true,updatedAt:s.updatedAt,currency:s.currency}); }
  if(p==='/website/submissions')return send(res,200,db.subs);
  if((w=p.match(/^\/public\/sites\/([^/]+)\/orders$/))){ const s=db.sites.find(x=>x.slug===w[1]&&x.published); if(!s)return send(res,404,'x'); let t=0; const lines=b.lines.map(l=>{const pr=s.products.find(x=>x.sku===l.sku); t+=pr.price*l.qty; return {sku:l.sku,name:pr.name,qty:l.qty,price:pr.price}}); const n='WO-'+(db.subs.length+1); db.subs.push({id:'o'+n,siteId:s.id,kind:'order',number:n,name:b.name,phone:b.phone,lines,total:t,currency:s.currency,status:'new',createdAt:new Date().toISOString()}); return send(res,200,{number:n,total:t}); }
  if((w=p.match(/^\/public\/sites\/([^/]+)\/messages$/))){ db.subs.push({id:'m'+db.subs.length,siteId:'x',kind:'message',number:'MSG-'+db.subs.length,name:b.name,note:b.message,lines:[],total:0,currency:'SAR',status:'new',createdAt:new Date().toISOString()}); return send(res,200,{ok:true}); }
  if(p==='/pos/records/product')return send(res,200,[{id:'p1',kind:'product',code:'SKU1',data:{name:'Coffee Beans',price:45,category:'Food'}},{id:'p2',kind:'product',code:'SKU2',data:{name:'Mug',price:20.5,category:'Home'}}]);
  if(p==='/users/me')return send(res,200,{role:'admin',displayName:'Sara Admin',effectivePermissions:ALL,branches:null});
  return send(res,200,p.match(/s$|tasks|list/)?[]:{}); }); }).listen(5000);
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'};
http.createServer((req,res)=>{ let f=path.join(dist,decodeURIComponent(req.url.split('?')[0])); if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(dist,'index.html'); res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res); }).listen(port);
